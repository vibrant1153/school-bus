-- ==============================================================================
-- Migration: 20261023000001_step7_trips_workflow.sql
-- Step 7: Trip Lifecycle, Transitions, Daily Generation & Metrics
-- 
-- 1. generate_daily_trips: Creates trips from active route_schedules & bus_assignments
--    using school local date (Africa/Addis_Ababa). Idempotent on unique constraint.
-- 2. start_trip: Transitions 'scheduled' -> 'in_progress', asserts driver assignment,
--    asserts trip_date = school_today, audits to audit_log, emits tripStarted alert.
-- 3. end_trip: Transitions 'in_progress' -> 'completed', asserts driver assignment or
--    school manager, calculates trip_summaries reliability metrics, audits to audit_log.
-- 4. cancel_trip: Transitions 'scheduled' or 'in_progress' -> 'cancelled' with mandatory
--    reason, asserts driver assignment or school manager, audits to audit_log.
-- 5. report_delay: Emits delay alert on 'in_progress' trip, enforces rate limit of
--    at most 1 report per 10 minutes, audits to audit_log.
--
-- Security: SECURITY DEFINER, SET search_path = '', REVOKE from PUBLIC/anon.
-- ==============================================================================

-- 1. generate_daily_trips (Manager for own school, Owner for any school)
CREATE OR REPLACE FUNCTION public.generate_daily_trips(
    p_school_id uuid DEFAULT NULL,
    p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id uuid := (SELECT auth.uid());
    v_caller record;
    v_school record;
    v_sched record;
    v_target_date date;
    v_dow smallint;
    v_sched_start timestamptz;
    v_created_count integer := 0;
    v_schools_processed integer := 0;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT id, school_id, role, is_active
    INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR NOT v_caller.is_active THEN
        RAISE EXCEPTION 'Access Denied: Inactive or missing profile' USING ERRCODE = '42501';
    END IF;

    IF v_caller.role NOT IN ('manager', 'owner') THEN
        RAISE EXCEPTION 'Access Denied: Only managers and owners can generate daily trips' USING ERRCODE = '42501';
    END IF;

    -- Managers can only generate trips for their own school
    IF v_caller.role = 'manager' THEN
        IF p_school_id IS NOT NULL AND p_school_id IS DISTINCT FROM v_caller.school_id THEN
            RAISE EXCEPTION 'Cross-tenant violation: Manager cannot generate trips for another school' USING ERRCODE = '42501';
        END IF;
        p_school_id := v_caller.school_id;
    END IF;

    FOR v_school IN
        SELECT s.id, s.timezone
        FROM public.schools s
        WHERE (p_school_id IS NULL OR s.id = p_school_id)
    LOOP
        v_target_date := COALESCE(p_date, (SELECT app_security.school_today(v_school.id)));
        v_dow := EXTRACT(ISODOW FROM v_target_date)::smallint;

        FOR v_sched IN
            SELECT 
                rs.school_id,
                rs.route_id,
                rs.direction,
                rs.departure_time,
                ba.bus_id,
                ba.driver_profile_id
            FROM public.route_schedules rs
            JOIN public.routes r ON r.id = rs.route_id AND r.is_active = true
            JOIN public.bus_assignments ba ON ba.route_id = rs.route_id AND ba.is_active = true AND ba.school_id = v_school.id
            WHERE rs.school_id = v_school.id
              AND rs.day_of_week = v_dow
        LOOP
            v_sched_start := (v_target_date::text || ' ' || v_sched.departure_time::text)::timestamp AT TIME ZONE v_school.timezone;

            INSERT INTO public.trips (
                school_id,
                bus_id,
                route_id,
                driver_profile_id,
                trip_date,
                direction,
                status,
                scheduled_start
            ) VALUES (
                v_school.id,
                v_sched.bus_id,
                v_sched.route_id,
                v_sched.driver_profile_id,
                v_target_date,
                v_sched.direction,
                'scheduled',
                v_sched_start
            )
            ON CONFLICT (school_id, bus_id, direction, trip_date) DO NOTHING;

            IF FOUND THEN
                v_created_count := v_created_count + 1;
            END IF;
        END LOOP;

        INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
        VALUES (
            v_school.id,
            v_caller_id,
            'GENERATE_DAILY_TRIPS',
            jsonb_build_object(
                'trip_date', v_target_date,
                'day_of_week', v_dow,
                'created_trips', v_created_count
            )
        );

        v_schools_processed := v_schools_processed + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'status', 'success',
        'schools_processed', v_schools_processed,
        'created_trips', v_created_count,
        'target_date', v_target_date
    );
END;
$$;

-- 2. start_trip (Driver starts scheduled trip on today's local date)
CREATE OR REPLACE FUNCTION public.start_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_driver_id uuid := (SELECT auth.uid());
    v_caller record;
    v_trip record;
BEGIN
    IF v_driver_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT id, school_id, role, is_active
    INTO v_caller
    FROM public.profiles
    WHERE id = v_driver_id;

    IF NOT FOUND OR NOT v_caller.is_active THEN
        RAISE EXCEPTION 'Access Denied: Inactive or missing profile' USING ERRCODE = '42501';
    END IF;

    IF v_caller.role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only assigned drivers can start trips' USING ERRCODE = '42501';
    END IF;

    SELECT t.*, s.timezone INTO v_trip
    FROM public.trips t
    JOIN public.schools s ON s.id = t.school_id
    WHERE t.id = p_trip_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (SELECT app_security.driver_is_assigned_to_trip(p_trip_id)) THEN
        RAISE EXCEPTION 'Access Denied: Driver is not assigned to this bus' USING ERRCODE = '42501';
    END IF;

    IF v_trip.status IS DISTINCT FROM 'scheduled' THEN
        RAISE EXCEPTION 'Trip state error: Cannot start trip with status %', v_trip.status USING ERRCODE = '22000';
    END IF;

    IF v_trip.trip_date IS DISTINCT FROM (SELECT app_security.school_today(v_trip.school_id)) THEN
        RAISE EXCEPTION 'Trip state error: Cannot start trip for date % (today is %)', 
            v_trip.trip_date, (SELECT app_security.school_today(v_trip.school_id)) USING ERRCODE = '22000';
    END IF;

    UPDATE public.trips
    SET status = 'in_progress',
        started_at = now(),
        driver_profile_id = v_driver_id,
        updated_at = now()
    WHERE id = p_trip_id;

    INSERT INTO public.alert_events (
        school_id, trip_id, event_type, dedupe_key, payload_json
    ) VALUES (
        v_trip.school_id, p_trip_id, 'tripStarted', 'started_' || p_trip_id::text,
        jsonb_build_object('started_at', now(), 'driver_id', v_driver_id)
    )
    ON CONFLICT (school_id, trip_id, dedupe_key) DO NOTHING;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_trip.school_id,
        v_driver_id,
        'START_TRIP',
        jsonb_build_object('trip_id', p_trip_id, 'started_at', now())
    );

    RETURN jsonb_build_object('trip_id', p_trip_id, 'status', 'in_progress', 'started_at', now());
END;
$$;

-- 3. end_trip (Driver or Manager transitions 'in_progress' -> 'completed', computes trip_summaries)
CREATE OR REPLACE FUNCTION public.end_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id uuid := (SELECT auth.uid());
    v_caller record;
    v_trip record;
    v_total_pings integer := 0;
    v_longest_gap integer := 0;
    v_avg_acc double precision := NULL;
    v_now timestamptz := now();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated' USING ERRCODE = '42501';
    END IF;

    SELECT id, school_id, role, is_active
    INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR NOT v_caller.is_active THEN
        RAISE EXCEPTION 'Access Denied: Inactive or missing profile' USING ERRCODE = '42501';
    END IF;

    IF v_caller.role NOT IN ('driver', 'manager') THEN
        RAISE EXCEPTION 'Access Denied: Only assigned drivers or school managers can end trips' USING ERRCODE = '42501';
    END IF;

    SELECT t.*, s.timezone INTO v_trip
    FROM public.trips t
    JOIN public.schools s ON s.id = t.school_id
    WHERE t.id = p_trip_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    -- Tenant isolation and driver assignment checks
    IF v_caller.role = 'driver' THEN
        IF NOT (SELECT app_security.driver_is_assigned_to_trip(p_trip_id)) THEN
            RAISE EXCEPTION 'Access Denied: Driver is not assigned to this bus' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller.role = 'manager' THEN
        IF v_caller.school_id IS DISTINCT FROM v_trip.school_id THEN
            RAISE EXCEPTION 'Cross-tenant violation: Cannot end trip for another school' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Strict state transition: only in_progress -> completed
    IF v_trip.status IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'Trip state error: Cannot end trip with status %', v_trip.status USING ERRCODE = '22000';
    END IF;

    UPDATE public.trips
    SET status = 'completed',
        ended_at = v_now,
        updated_at = v_now
    WHERE id = p_trip_id;

    -- Compute reliability metrics from bus_location_history (NO coordinates stored in summary)
    SELECT 
        count(*)::integer,
        COALESCE(avg(accuracy), 0.0)
    INTO v_total_pings, v_avg_acc
    FROM public.bus_location_history
    WHERE trip_id = p_trip_id;

    WITH gaps AS (
        SELECT EXTRACT(EPOCH FROM (recorded_at - lag(recorded_at) OVER (ORDER BY recorded_at)))::integer AS gap
        FROM public.bus_location_history
        WHERE trip_id = p_trip_id
    )
    SELECT COALESCE(MAX(gap), 0) INTO v_longest_gap
    FROM gaps
    WHERE gap IS NOT NULL;

    INSERT INTO public.trip_summaries (
        school_id,
        trip_id,
        total_pings,
        longest_gap_seconds,
        avg_accuracy_meters,
        started_at,
        ended_at
    ) VALUES (
        v_trip.school_id,
        p_trip_id,
        v_total_pings,
        v_longest_gap,
        v_avg_acc,
        v_trip.started_at,
        v_now
    )
    ON CONFLICT (trip_id) DO UPDATE SET
        total_pings = EXCLUDED.total_pings,
        longest_gap_seconds = EXCLUDED.longest_gap_seconds,
        avg_accuracy_meters = EXCLUDED.avg_accuracy_meters,
        ended_at = EXCLUDED.ended_at;

    INSERT INTO public.alert_events (
        school_id, trip_id, event_type, dedupe_key, payload_json
    ) VALUES (
        v_trip.school_id, p_trip_id, 'tripCompleted', 'completed_' || p_trip_id::text,
        jsonb_build_object('ended_at', v_now, 'total_pings', v_total_pings)
    )
    ON CONFLICT (school_id, trip_id, dedupe_key) DO NOTHING;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_trip.school_id,
        v_caller_id,
        'END_TRIP',
        jsonb_build_object(
            'trip_id', p_trip_id,
            'ended_at', v_now,
            'total_pings', v_total_pings,
            'longest_gap_seconds', v_longest_gap,
            'avg_accuracy_meters', v_avg_acc
        )
    );

    RETURN jsonb_build_object(
        'trip_id', p_trip_id,
        'status', 'completed',
        'ended_at', v_now,
        'total_pings', v_total_pings,
        'longest_gap_seconds', v_longest_gap,
        'avg_accuracy_meters', v_avg_acc
    );
END;
$$;

-- 4. cancel_trip (Driver or Manager transitions 'scheduled' or 'in_progress' -> 'cancelled' with mandatory reason)
CREATE OR REPLACE FUNCTION public.cancel_trip(
    p_trip_id uuid,
    p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id uuid := (SELECT auth.uid());
    v_caller record;
    v_trip record;
    v_now timestamptz := now();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Invalid Input: Cancellation reason is required' USING ERRCODE = '22023';
    END IF;

    SELECT id, school_id, role, is_active
    INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR NOT v_caller.is_active THEN
        RAISE EXCEPTION 'Access Denied: Inactive or missing profile' USING ERRCODE = '42501';
    END IF;

    IF v_caller.role NOT IN ('driver', 'manager') THEN
        RAISE EXCEPTION 'Access Denied: Only assigned drivers or school managers can cancel trips' USING ERRCODE = '42501';
    END IF;

    SELECT t.*, s.timezone INTO v_trip
    FROM public.trips t
    JOIN public.schools s ON s.id = t.school_id
    WHERE t.id = p_trip_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    -- Tenant isolation and assignment checks
    IF v_caller.role = 'driver' THEN
        IF NOT (SELECT app_security.driver_is_assigned_to_trip(p_trip_id)) THEN
            RAISE EXCEPTION 'Access Denied: Driver is not assigned to this bus' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller.role = 'manager' THEN
        IF v_caller.school_id IS DISTINCT FROM v_trip.school_id THEN
            RAISE EXCEPTION 'Cross-tenant violation: Cannot cancel trip for another school' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Enforce valid transition: only scheduled or in_progress -> cancelled
    IF v_trip.status NOT IN ('scheduled', 'in_progress') THEN
        RAISE EXCEPTION 'Trip state error: Cannot cancel trip with status %', v_trip.status USING ERRCODE = '22000';
    END IF;

    UPDATE public.trips
    SET status = 'cancelled',
        ended_at = v_now,
        updated_at = v_now
    WHERE id = p_trip_id;

    INSERT INTO public.alert_events (
        school_id, trip_id, event_type, dedupe_key, payload_json
    ) VALUES (
        v_trip.school_id, p_trip_id, 'tripCancelled', 'cancelled_' || p_trip_id::text,
        jsonb_build_object(
            'reason', trim(p_reason),
            'previous_status', v_trip.status,
            'cancelled_at', v_now
        )
    )
    ON CONFLICT (school_id, trip_id, dedupe_key) DO NOTHING;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_trip.school_id,
        v_caller_id,
        'CANCEL_TRIP',
        jsonb_build_object(
            'trip_id', p_trip_id,
            'reason', trim(p_reason),
            'previous_status', v_trip.status,
            'cancelled_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'trip_id', p_trip_id,
        'status', 'cancelled',
        'reason', trim(p_reason),
        'ended_at', v_now
    );
END;
$$;

-- 5. report_delay (Driver or Manager reports delay, enforced limit 1 per 10 minutes)
CREATE OR REPLACE FUNCTION public.report_delay(
    p_trip_id uuid,
    p_delay_minutes integer DEFAULT 15,
    p_reason text DEFAULT 'Traffic delay'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id uuid := (SELECT auth.uid());
    v_caller record;
    v_trip record;
    v_dedupe_key text;
    v_now timestamptz := now();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_delay_minutes IS NULL OR p_delay_minutes <= 0 THEN
        RAISE EXCEPTION 'Invalid Input: delay_minutes must be positive' USING ERRCODE = '22023';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        p_reason := 'Traffic delay';
    END IF;

    SELECT id, school_id, role, is_active
    INTO v_caller
    FROM public.profiles
    WHERE id = v_caller_id;

    IF NOT FOUND OR NOT v_caller.is_active THEN
        RAISE EXCEPTION 'Access Denied: Inactive or missing profile' USING ERRCODE = '42501';
    END IF;

    IF v_caller.role NOT IN ('driver', 'manager') THEN
        RAISE EXCEPTION 'Access Denied: Only assigned drivers or school managers can report trip delays' USING ERRCODE = '42501';
    END IF;

    SELECT t.*, s.timezone INTO v_trip
    FROM public.trips t
    JOIN public.schools s ON s.id = t.school_id
    WHERE t.id = p_trip_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    -- Tenant isolation and assignment checks
    IF v_caller.role = 'driver' THEN
        IF NOT (SELECT app_security.driver_is_assigned_to_trip(p_trip_id)) THEN
            RAISE EXCEPTION 'Access Denied: Driver is not assigned to this bus' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller.role = 'manager' THEN
        IF v_caller.school_id IS DISTINCT FROM v_trip.school_id THEN
            RAISE EXCEPTION 'Cross-tenant violation: Cannot report delay for another school' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Enforce transition: delays can only be reported during active trips
    IF v_trip.status IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'Trip state error: Cannot report delay on trip with status %', v_trip.status USING ERRCODE = '22000';
    END IF;

    -- Enforce rate limit: maximum one delay report per 10 minutes per trip
    IF EXISTS (
        SELECT 1 FROM public.alert_events
        WHERE trip_id = p_trip_id
          AND event_type = 'delayed'
          AND created_at >= (v_now - interval '10 minutes')
    ) THEN
        RAISE EXCEPTION 'Rate limit exceeded: Delay already reported within the last 10 minutes' USING ERRCODE = '22000';
    END IF;

    v_dedupe_key := 'delayed_' || p_trip_id::text || '_' || to_char(v_now, 'YYYYMMDD_HH24MI');

    INSERT INTO public.alert_events (
        school_id, trip_id, event_type, dedupe_key, payload_json
    ) VALUES (
        v_trip.school_id, p_trip_id, 'delayed', v_dedupe_key,
        jsonb_build_object(
            'delay_minutes', p_delay_minutes,
            'reason', trim(p_reason),
            'reported_at', v_now
        )
    )
    ON CONFLICT (school_id, trip_id, dedupe_key) DO NOTHING;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_trip.school_id,
        v_caller_id,
        'REPORT_DELAY',
        jsonb_build_object(
            'trip_id', p_trip_id,
            'delay_minutes', p_delay_minutes,
            'reason', trim(p_reason),
            'reported_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'trip_id', p_trip_id,
        'event_type', 'delayed',
        'delay_minutes', p_delay_minutes,
        'reason', trim(p_reason),
        'reported_at', v_now
    );
END;
$$;

-- ==============================================================================
-- PRIVILEGES & GRANTS (REVOKE from PUBLIC/anon, GRANT to authenticated)
-- ==============================================================================
REVOKE ALL ON FUNCTION public.generate_daily_trips(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_daily_trips(uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION public.start_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_trip(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.end_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_trip(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.cancel_trip(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_trip(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.report_delay(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_delay(uuid, integer, text) TO authenticated;
