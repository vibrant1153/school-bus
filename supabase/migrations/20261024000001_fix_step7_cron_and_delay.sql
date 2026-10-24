-- ==============================================================================
-- Migration: 20261024000001_fix_step7_cron_and_delay.sql
-- Fix Step 7: System-level trip generation for pg_cron and delay reason choices
--
-- 1. app_security.generate_daily_trips_system:
--    System-level generation function callable by postgres / service_role without JWT.
--    Creates trips for each school's local date AND tomorrow's date.
--    Revoked from PUBLIC, anon, authenticated.
-- 2. public.generate_daily_trips:
--    Public wrapper for managers and owners. Enforces active profile and tenant isolation.
-- 3. public.report_delay:
--    Enforces reason choices ('traffic', 'breakdown', 'other').
-- ==============================================================================

-- 1. app_security.generate_daily_trips_system
CREATE OR REPLACE FUNCTION app_security.generate_daily_trips_system(
    p_school_id uuid DEFAULT NULL,
    p_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_school record;
    v_sched record;
    v_target_date date;
    v_dow smallint;
    v_sched_start timestamptz;
    v_created_count integer := 0;
    v_schools_processed integer := 0;
    v_today date;
    v_tomorrow date;
    v_dates date[];
    v_d date;
BEGIN
    FOR v_school IN
        SELECT s.id, s.timezone
        FROM public.schools s
        WHERE (p_school_id IS NULL OR s.id = p_school_id)
    LOOP
        IF p_date IS NOT NULL THEN
            v_dates := ARRAY[p_date];
        ELSE
            v_today := (SELECT app_security.school_today(v_school.id));
            v_tomorrow := v_today + 1;
            v_dates := ARRAY[v_today, v_tomorrow];
        END IF;

        FOREACH v_d IN ARRAY v_dates
        LOOP
            v_target_date := v_d;
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

            -- Audited with performed_by = NULL (system execution)
            INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
            VALUES (
                v_school.id,
                NULL,
                'GENERATE_DAILY_TRIPS_SYSTEM',
                jsonb_build_object(
                    'target_date', v_target_date,
                    'day_of_week', v_dow,
                    'created_trips', v_created_count,
                    'source', 'pg_cron_or_service_role'
                )
            );
        END LOOP;

        v_schools_processed := v_schools_processed + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'status', 'success',
        'schools_processed', v_schools_processed,
        'created_trips', v_created_count
    );
END;
$$;

-- 2. public.generate_daily_trips (Managers for own school, Owners for any)
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
    v_res jsonb;
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

    v_res := app_security.generate_daily_trips_system(p_school_id, p_date);

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        COALESCE(p_school_id, v_caller.school_id),
        v_caller_id,
        'GENERATE_DAILY_TRIPS',
        jsonb_build_object(
            'school_id', p_school_id,
            'target_date', p_date,
            'result', v_res
        )
    );

    RETURN v_res;
END;
$$;

-- 3. public.report_delay (Enforces choices: traffic, breakdown, other)
CREATE OR REPLACE FUNCTION public.report_delay(
    p_trip_id uuid,
    p_delay_minutes integer DEFAULT 15,
    p_reason text DEFAULT 'traffic'
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
    v_norm_reason text;
    v_now timestamptz := now();
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF p_delay_minutes IS NULL OR p_delay_minutes <= 0 THEN
        RAISE EXCEPTION 'Invalid Input: delay_minutes must be positive' USING ERRCODE = '22023';
    END IF;

    v_norm_reason := lower(trim(COALESCE(p_reason, 'traffic')));
    IF v_norm_reason NOT IN ('traffic', 'breakdown', 'other') THEN
        RAISE EXCEPTION 'Invalid Input: delay reason must be one of: traffic, breakdown, other' USING ERRCODE = '22023';
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
            'reason', v_norm_reason,
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
            'reason', v_norm_reason,
            'reported_at', v_now
        )
    );

    RETURN jsonb_build_object(
        'trip_id', p_trip_id,
        'event_type', 'delayed',
        'delay_minutes', p_delay_minutes,
        'reason', v_norm_reason,
        'reported_at', v_now
    );
END;
$$;

-- ==============================================================================
-- PRIVILEGES & GRANTS
-- ==============================================================================
-- System generator: callable only by postgres and service_role
REVOKE ALL ON FUNCTION app_security.generate_daily_trips_system(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.generate_daily_trips_system(uuid, date) TO postgres, service_role;

-- Public generator: callable by authenticated managers/owners
REVOKE ALL ON FUNCTION public.generate_daily_trips(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_daily_trips(uuid, date) TO authenticated;

-- Report delay: callable by authenticated drivers/managers
REVOKE ALL ON FUNCTION public.report_delay(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_delay(uuid, integer, text) TO authenticated;
