-- ==============================================================================
-- SchoolBus Connect - Phase 2, Step 3: Review Hardening & Security Corrections
-- Migration: 20261020000001_step3_corrections.sql
--
-- Applies on top of 20261019000001_rls_policies_and_security.sql (commit 8a0f35a)
-- 1. profiles.is_active column and app_security.can_cancel_absence role enforcement.
-- 2. Safe realtime policy exception handling without redundant GRANTs.
-- 3. Ingest location physical plausibility, deduplication (5s), and freshness [-60s, +10s].
-- 4. Audited public.create_school RPC restricted to role 'owner'.
-- 5. Dead code removal in create_alert_event & purge_expired_location_history with SQL privilege revocation.
-- 6. search_path = '' on safe_uuid; triggers protecting guardians.is_primary & relationship.
-- 7. Scalar subqueries in get_school_health_metrics & column-level UPDATE on profiles.
-- ==============================================================================

BEGIN;

-- 1. Profiles Active State & Audit Log School Nullability
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
ALTER TABLE public.audit_log ALTER COLUMN school_id DROP NOT NULL;

-- 2. Safe UUID parse helper (search_path hardening)
CREATE OR REPLACE FUNCTION app_security.safe_uuid(p_val text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE 
        WHEN p_val ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' 
        THEN p_val::uuid 
        ELSE NULL 
    END;
$$;

-- 3. Current authenticated user role (returns NULL if inactive)
CREATE OR REPLACE FUNCTION app_security.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_active = true;
$$;

-- 4. Current authenticated user school_id (returns NULL if inactive)
CREATE OR REPLACE FUNCTION app_security.current_user_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT school_id FROM public.profiles WHERE id = (SELECT auth.uid()) AND is_active = true;
$$;

-- 5. School local date helper (handles NULL gracefully)
CREATE OR REPLACE FUNCTION app_security.school_today(p_school_id uuid)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_tz text;
BEGIN
    IF p_school_id IS NULL THEN
        RETURN CURRENT_DATE;
    END IF;
    SELECT timezone INTO v_tz FROM public.schools WHERE id = p_school_id;
    IF v_tz IS NULL THEN
        RETURN CURRENT_DATE;
    END IF;
    RETURN (now() AT TIME ZONE v_tz)::date;
END;
$$;

-- 6. can_cancel_absence (enforces active role so deactivated users cannot cancel anything)
CREATE OR REPLACE FUNCTION app_security.can_cancel_absence(p_absence_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := (SELECT auth.uid());
    v_user_role text;
    v_rec record;
    v_school_today date;
BEGIN
    IF v_user_id IS NULL OR p_absence_id IS NULL THEN
        RETURN false;
    END IF;

    SELECT a.id, a.school_id, a.student_id, a.reported_by, a.trip_date, a.direction
    INTO v_rec
    FROM public.absences a
    WHERE a.id = p_absence_id;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    -- Use app_security.current_user_role() so deactivated (is_active=false) users cannot cancel anything
    v_user_role := (SELECT app_security.current_user_role());
    IF v_user_role IS NULL THEN
        RETURN false;
    END IF;

    -- Managers can cancel within their school
    IF v_user_role = 'manager' THEN
        RETURN (SELECT app_security.current_user_school_id()) = v_rec.school_id;
    END IF;

    -- Parents can cancel only if they reported it
    IF v_user_role = 'parent' AND v_rec.reported_by = v_user_id THEN
        v_school_today := app_security.school_today(v_rec.school_id);

        -- Future dates are always cancellable
        IF v_rec.trip_date > v_school_today THEN
            RETURN true;
        END IF;

        -- Past dates cannot be cancelled directly
        IF v_rec.trip_date < v_school_today THEN
            RETURN false;
        END IF;

        -- Same day (trip_date = v_school_today): direction-based trip state checks
        IF v_rec.direction = 'morning' THEN
            RETURN NOT EXISTS (
                SELECT 1 FROM public.trips t
                JOIN public.stops s ON s.route_id = t.route_id
                JOIN public.student_stops ss ON ss.stop_id = s.id AND ss.direction = t.direction
                WHERE ss.student_id = v_rec.student_id
                  AND t.school_id = v_rec.school_id
                  AND t.trip_date = v_school_today
                  AND t.direction = 'morning'
                  AND t.status IN ('in_progress', 'completed')
            );
        ELSIF v_rec.direction = 'afternoon' THEN
            RETURN NOT EXISTS (
                SELECT 1 FROM public.trips t
                JOIN public.stops s ON s.route_id = t.route_id
                JOIN public.student_stops ss ON ss.stop_id = s.id AND ss.direction = t.direction
                WHERE ss.student_id = v_rec.student_id
                  AND t.school_id = v_rec.school_id
                  AND t.trip_date = v_school_today
                  AND t.direction = 'afternoon'
                  AND t.status IN ('in_progress', 'completed')
            );
        ELSIF v_rec.direction = 'both' THEN
            -- 'both' cancellation allowed only if NEITHER trip has started
            RETURN NOT EXISTS (
                SELECT 1 FROM public.trips t
                JOIN public.stops s ON s.route_id = t.route_id
                JOIN public.student_stops ss ON ss.stop_id = s.id AND ss.direction = t.direction
                WHERE ss.student_id = v_rec.student_id
                  AND t.school_id = v_rec.school_id
                  AND t.trip_date = v_school_today
                  AND t.direction = 'morning'
                  AND t.status IN ('in_progress', 'completed')
            ) AND NOT EXISTS (
                SELECT 1 FROM public.trips t
                JOIN public.stops s ON s.route_id = t.route_id
                JOIN public.student_stops ss ON ss.stop_id = s.id AND ss.direction = t.direction
                WHERE ss.student_id = v_rec.student_id
                  AND t.school_id = v_rec.school_id
                  AND t.trip_date = v_school_today
                  AND t.direction = 'afternoon'
                  AND t.status IN ('in_progress', 'completed')
            );
        END IF;
    END IF;

    RETURN false;
END;
$$;

-- 7. Profile immutability trigger (allows service_role provisioning when auth.uid() IS NULL)
CREATE OR REPLACE FUNCTION app_security.trg_profiles_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        IF NEW.role IS DISTINCT FROM OLD.role THEN
            RAISE EXCEPTION 'Immutable field violation: profiles.role cannot be updated directly' USING ERRCODE = '42501';
        END IF;
        IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
            RAISE EXCEPTION 'Immutable field violation: profiles.school_id cannot be updated directly' USING ERRCODE = '42501';
        END IF;
        IF NEW.id IS DISTINCT FROM OLD.id THEN
            RAISE EXCEPTION 'Immutable field violation: profiles.id cannot be updated directly' USING ERRCODE = '42501';
        END IF;
        IF NEW.phone IS DISTINCT FROM OLD.phone THEN
            RAISE EXCEPTION 'Immutable field violation: profiles.phone cannot be updated directly' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 8. Guardians immutability & manager protection for is_primary/relationship
CREATE OR REPLACE FUNCTION app_security.trg_guardians_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.student_id IS DISTINCT FROM OLD.student_id THEN
        RAISE EXCEPTION 'Immutable field violation: guardians.student_id cannot be updated directly' USING ERRCODE = '42501';
    END IF;
    IF NEW.profile_id IS DISTINCT FROM OLD.profile_id THEN
        RAISE EXCEPTION 'Immutable field violation: guardians.profile_id cannot be updated directly' USING ERRCODE = '42501';
    END IF;
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
        RAISE EXCEPTION 'Immutable field violation: guardians.school_id cannot be updated directly' USING ERRCODE = '42501';
    END IF;
    -- Only managers can change guardians.is_primary and relationship
    IF (NEW.is_primary IS DISTINCT FROM OLD.is_primary OR NEW.relationship IS DISTINCT FROM OLD.relationship) THEN
        IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'manager' THEN
            RAISE EXCEPTION 'Access Denied: Only managers can change guardians.is_primary and relationship' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

-- 9. Auto-fill manager school_id (supports absence_reasons parent lookup)
CREATE OR REPLACE FUNCTION app_security.fill_manager_school_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT app_security.current_user_role()) = 'manager' THEN
        NEW.school_id := (SELECT app_security.current_user_school_id());
    ELSIF TG_TABLE_NAME = 'absence_reasons' AND NEW.school_id IS NULL THEN
        SELECT a.school_id INTO NEW.school_id FROM public.absences a WHERE a.id = NEW.absence_id;
    END IF;
    RETURN NEW;
END;
$$;

-- 10. Audit manager mutations (safe PK handling, never logs absence_reasons.reason)
CREATE OR REPLACE FUNCTION app_security.trg_audit_manager_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := (SELECT auth.uid());
    v_school_id uuid;
    v_action text;
    v_details jsonb;
    v_pk_id uuid;
    v_changed_cols text[];
    v_old_json jsonb;
    v_new_json jsonb;
    v_row_json jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'DELETE' THEN
        v_old_json := to_jsonb(OLD);
        v_row_json := v_old_json;
    ELSIF TG_OP = 'UPDATE' THEN
        v_old_json := to_jsonb(OLD);
        v_new_json := to_jsonb(NEW);
        v_row_json := v_new_json;
    ELSE -- INSERT
        v_new_json := to_jsonb(NEW);
        v_row_json := v_new_json;
    END IF;

    -- Dynamically extract primary key regardless of whether table uses id, bus_id, or absence_id
    v_pk_id := (COALESCE(
        v_row_json ->> 'id',
        v_row_json ->> 'bus_id',
        v_row_json ->> 'absence_id'
    ))::uuid;

    v_school_id := (v_row_json ->> 'school_id')::uuid;
    v_action := TG_OP || '_' || upper(TG_TABLE_NAME);

    -- For sensitive tables: never log absence_reasons.reason, log only metadata and changed column names
    IF TG_TABLE_NAME IN ('students', 'absence_reasons', 'guardians') THEN
        IF TG_OP = 'UPDATE' THEN
            SELECT array_agg(key) INTO v_changed_cols
            FROM jsonb_each(v_new_json)
            WHERE v_new_json -> key IS DISTINCT FROM v_old_json -> key;

            v_details := jsonb_build_object(
                'record_id', v_pk_id,
                'school_id', v_school_id,
                'operation', TG_OP,
                'changed_columns', COALESCE(v_changed_cols, ARRAY[]::text[])
            );
        ELSE
            v_details := jsonb_build_object(
                'record_id', v_pk_id,
                'school_id', v_school_id,
                'operation', TG_OP
            );
        END IF;
    ELSE
        IF TG_OP = 'INSERT' THEN
            v_details := jsonb_build_object('row', v_new_json);
        ELSIF TG_OP = 'UPDATE' THEN
            v_details := jsonb_build_object('old', v_old_json, 'new', v_new_json);
        ELSE
            v_details := jsonb_build_object('old', v_old_json);
        END IF;
    END IF;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (v_school_id, v_user_id, v_action, v_details);

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- 11. is_student_absent (tight school isolation lookup, uses driver_profile_id and trip_date)
CREATE OR REPLACE FUNCTION public.is_student_absent(
    p_student_id uuid,
    p_trip_date date,
    p_direction text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role text := (SELECT app_security.current_user_role());
    v_user_school_id uuid := (SELECT app_security.current_user_school_id());
    v_user_id uuid := (SELECT auth.uid());
    v_student_school_id uuid;
    v_is_absent boolean;
BEGIN
    IF v_user_role IS DISTINCT FROM 'manager' AND v_user_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only managers and drivers may query student absence status' USING ERRCODE = '42501';
    END IF;

    SELECT s.school_id INTO v_student_school_id 
    FROM public.students s 
    WHERE s.id = p_student_id AND s.school_id = v_user_school_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_user_role = 'driver' THEN
        SELECT EXISTS (
            SELECT 1 
            FROM public.trips t
            JOIN public.bus_assignments ba ON ba.bus_id = t.bus_id AND ba.driver_profile_id = v_user_id AND ba.is_active = true
            JOIN public.student_stops ss ON ss.direction = t.direction AND ss.school_id = t.school_id
            JOIN public.stops st ON st.id = ss.stop_id AND st.route_id = t.route_id
            WHERE t.school_id = v_user_school_id
              AND t.trip_date = p_trip_date
              AND t.direction = p_direction
              AND ss.student_id = p_student_id
        ) INTO v_is_absent;

        IF NOT v_is_absent THEN
            RAISE EXCEPTION 'Access Denied: Driver not assigned to active trip for student' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 
        FROM public.absences a
        WHERE a.school_id = v_user_school_id
          AND a.student_id = p_student_id
          AND a.trip_date = p_trip_date
          AND a.direction = p_direction
    ) INTO v_is_absent;

    RETURN v_is_absent;
END;
$$;

-- 12. get_school_health_metrics (scalar subqueries without cross-table joins)
CREATE OR REPLACE FUNCTION public.get_school_health_metrics()
RETURNS TABLE (
    school_id uuid,
    school_name text,
    total_buses bigint,
    total_routes bigint,
    total_students bigint,
    active_trips_today bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role text := (SELECT app_security.current_user_role());
    v_user_school_id uuid := (SELECT app_security.current_user_school_id());
BEGIN
    IF v_user_role IS DISTINCT FROM 'owner' AND v_user_role IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Access Denied: Only platform owner and school managers can view health metrics' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        s.id AS school_id,
        s.name AS school_name,
        (SELECT count(*) FROM public.buses b WHERE b.school_id = s.id AND b.is_active = true) AS total_buses,
        (SELECT count(*) FROM public.routes r WHERE r.school_id = s.id AND r.is_active = true) AS total_routes,
        (SELECT count(*) FROM public.students st WHERE st.school_id = s.id AND st.is_active = true) AS total_students,
        (SELECT count(*) FROM public.trips t WHERE t.school_id = s.id AND t.trip_date = app_security.school_today(s.id) AND t.status = 'in_progress') AS active_trips_today
    FROM public.schools s
    WHERE (v_user_role = 'owner') OR (v_user_role = 'manager' AND s.id = v_user_school_id)
    ORDER BY s.name;
END;
$$;

-- 13. start_trip (asserts trip_date = school_today)
CREATE OR REPLACE FUNCTION public.start_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_driver_id uuid := (SELECT auth.uid());
    v_trip record;
BEGIN
    IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only assigned drivers can start trips' USING ERRCODE = '42501';
    END IF;

    SELECT t.*, s.timezone INTO v_trip
    FROM public.trips t
    JOIN public.schools s ON s.id = t.school_id
    WHERE t.id = p_trip_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT app_security.driver_is_assigned_to_trip(p_trip_id) THEN
        RAISE EXCEPTION 'Access Denied: Driver is not assigned to this bus' USING ERRCODE = '42501';
    END IF;

    IF v_trip.status IS DISTINCT FROM 'scheduled' THEN
        RAISE EXCEPTION 'Trip state error: Cannot start trip with status %', v_trip.status USING ERRCODE = '22000';
    END IF;

    IF v_trip.trip_date IS DISTINCT FROM app_security.school_today(v_trip.school_id) THEN
        RAISE EXCEPTION 'Trip state error: Cannot start trip for date % (today is %)', v_trip.trip_date, app_security.school_today(v_trip.school_id) USING ERRCODE = '22000';
    END IF;

    UPDATE public.trips
    SET status = 'in_progress',
        started_at = now(),
        updated_at = now()
    WHERE id = p_trip_id;

    RETURN jsonb_build_object('trip_id', p_trip_id, 'status', 'in_progress', 'started_at', now());
END;
$$;

-- 14. purge_location_history (Manager purge of finished/cancelled/stale trips before start of today)
CREATE OR REPLACE FUNCTION public.purge_location_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := (SELECT auth.uid());
    v_school_id uuid := (SELECT app_security.current_user_school_id());
    v_user_role text := (SELECT app_security.current_user_role());
    v_today_start timestamptz;
    v_deleted integer;
BEGIN
    IF v_user_role IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Access Denied: Only school managers may purge location history' USING ERRCODE = '42501';
    END IF;

    SELECT date_trunc('day', now() AT TIME ZONE s.timezone) AT TIME ZONE s.timezone
    INTO v_today_start
    FROM public.schools s
    WHERE s.id = v_school_id;

    WITH deleted AS (
        DELETE FROM public.bus_location_history blh
        USING public.trips t
        WHERE blh.trip_id = t.id
          AND blh.school_id = v_school_id
          AND (
              t.status IN ('completed', 'cancelled')
              OR (t.status = 'in_progress' AND t.trip_date < (now() AT TIME ZONE (SELECT timezone FROM public.schools WHERE id = v_school_id))::date)
          )
          AND blh.recorded_at < v_today_start
        RETURNING blh.id
    )
    SELECT count(*) INTO v_deleted FROM deleted;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (v_school_id, v_user_id, 'PURGE_LOCATION_HISTORY', jsonb_build_object('deleted_points', v_deleted, 'before_timestamp', v_today_start));

    RETURN v_deleted;
END;
$$;

-- 15. app_security.purge_expired_location_history (automated retention purge)
CREATE OR REPLACE FUNCTION app_security.purge_expired_location_history(p_hours integer DEFAULT 72, p_summary_days integer DEFAULT 90)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_cutoff timestamptz;
    v_summary_cutoff timestamptz;
    v_deleted integer;
    v_deleted_summaries integer;
BEGIN
    v_cutoff := now() - (p_hours || ' hours')::interval;
    v_summary_cutoff := now() - (p_summary_days || ' days')::interval;

    WITH deleted AS (
        DELETE FROM public.bus_location_history
        WHERE recorded_at < v_cutoff
        RETURNING id
    )
    SELECT count(*) INTO v_deleted FROM deleted;

    WITH deleted_sum AS (
        DELETE FROM public.trip_summaries
        WHERE created_at < v_summary_cutoff
        RETURNING id
    )
    SELECT count(*) INTO v_deleted_summaries FROM deleted_sum;

    INSERT INTO public.audit_log (performed_by, action, details_json)
    VALUES (
        NULL,
        'SYSTEM_PURGE_EXPIRED_LOCATION_HISTORY',
        jsonb_build_object(
            'deleted_points', v_deleted, 
            'cutoff', v_cutoff, 
            'retention_hours', p_hours,
            'deleted_summaries', v_deleted_summaries,
            'summary_retention_days', p_summary_days
        )
    );

    RETURN v_deleted;
END;
$$;

-- 16. create_alert_event (locked down to service_role, exact parameter signature from 8a0f35a)
CREATE OR REPLACE FUNCTION public.create_alert_event(
    p_school_id uuid,
    p_trip_id uuid,
    p_student_id uuid,
    p_stop_id uuid,
    p_event_type text,
    p_dedupe_key text,
    p_payload jsonb DEFAULT '{}'::jsonb,
    p_radius_meters integer DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_id uuid;
BEGIN
    IF p_event_type NOT IN ('tripStarted', 'nearStop', 'delayed', 'tripCompleted', 'tripCancelled') THEN
        RAISE EXCEPTION 'Invalid Input: event_type % is not recognized', p_event_type USING ERRCODE = '22023';
    END IF;

    IF p_radius_meters IS NOT NULL AND p_radius_meters NOT IN (200, 500, 1000) THEN
        RAISE EXCEPTION 'Invalid Input: radius_meters must be 200, 500, or 1000' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.alert_events (
        school_id, trip_id, student_id, stop_id, event_type, radius_meters, dedupe_key, payload_json
    )
    VALUES (
        p_school_id, p_trip_id, p_student_id, p_stop_id, p_event_type, p_radius_meters, p_dedupe_key, COALESCE(p_payload, '{}'::jsonb)
    )
    ON CONFLICT (school_id, trip_id, dedupe_key) DO NOTHING
    RETURNING id INTO v_id;

    RETURN v_id;
END;
$$;

-- 17. ingest_location (speed in m/s <= 45, window [-60s, +10s], interval >= 5s, jump check)
CREATE OR REPLACE FUNCTION public.ingest_location(
    p_trip_id uuid,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_speed double precision,
    p_accuracy double precision,
    p_recorded_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_driver_id uuid := (SELECT auth.uid());
    v_role text := (SELECT app_security.current_user_role());
    v_trip record;
    v_last_loc record;
    v_time_diff double precision;
    v_dist_meters double precision;
BEGIN
    IF v_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only drivers may ingest GPS telemetry' USING ERRCODE = '42501';
    END IF;

    IF p_lat IS NULL OR p_lng IS NULL OR p_accuracy IS NULL OR p_recorded_at IS NULL THEN
        RAISE EXCEPTION 'Invalid Input: lat, lng, accuracy, and recorded_at cannot be null' USING ERRCODE = '22023';
    END IF;

    IF p_lat < -90.0 OR p_lat > 90.0 OR p_lng < -180.0 OR p_lng > 180.0 THEN
        RAISE EXCEPTION 'Invalid Input: Coordinates out of bounds' USING ERRCODE = '22023';
    END IF;

    IF p_accuracy < 0.0 OR p_accuracy > 1000.0 THEN
        RAISE EXCEPTION 'Invalid Input: Accuracy out of plausible range' USING ERRCODE = '22023';
    END IF;

    IF p_heading IS NOT NULL AND (p_heading < 0.0 OR p_heading > 360.0) THEN
        RAISE EXCEPTION 'Invalid Input: Heading must be between 0 and 360' USING ERRCODE = '22023';
    END IF;

    -- Speed check: p_speed is in meters per second (m/s). 45 m/s is ~162 km/h.
    IF p_speed IS NOT NULL AND (p_speed < 0.0 OR p_speed > 45.0) THEN
        RAISE EXCEPTION 'Invalid Input: Speed out of plausible range (unit: m/s, max: 45 m/s)' USING ERRCODE = '22023';
    END IF;

    -- Freshness window: about 60 s back / 10 s forward
    IF p_recorded_at < (now() - interval '60 seconds') OR p_recorded_at > (now() + interval '10 seconds') THEN
        RAISE EXCEPTION 'Invalid Input: Timestamp outside freshness window' USING ERRCODE = '22023';
    END IF;

    SELECT t.id, t.school_id, t.bus_id, t.status INTO v_trip
    FROM public.trips t
    WHERE t.id = p_trip_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT app_security.driver_is_assigned_to_trip(p_trip_id) THEN
        RAISE EXCEPTION 'Access Denied: Driver not assigned to this trip' USING ERRCODE = '42501';
    END IF;

    IF v_trip.status IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'Trip state error: Trip is not in progress' USING ERRCODE = '22000';
    END IF;

    -- Fetch the previous location for this bus
    SELECT lat, lng, accuracy, recorded_at INTO v_last_loc
    FROM public.bus_locations_latest
    WHERE bus_id = v_trip.bus_id;

    IF v_last_loc.recorded_at IS NOT NULL THEN
        -- Out-of-order check: if incoming point is older than or equal to last recorded, ignore
        IF p_recorded_at <= v_last_loc.recorded_at THEN
            RETURN;
        END IF;

        -- Minimum interval between stored points: about 5 s (we send every 12 s)
        IF p_recorded_at < (v_last_loc.recorded_at + interval '5 seconds') THEN
            RETURN;
        END IF;

        -- Reject implausible jumps between consecutive points
        v_time_diff := EXTRACT(EPOCH FROM (p_recorded_at - v_last_loc.recorded_at));
        IF v_time_diff > 0 THEN
            -- Approximate Euclidean distance in meters on WGS84
            v_dist_meters := sqrt(
                power((p_lat - v_last_loc.lat) * 111320.0, 2) +
                power((p_lng - v_last_loc.lng) * 111320.0 * cos(radians((p_lat + v_last_loc.lat) / 2.0)), 2)
            );

            -- Max plausible distance allowing 45 m/s plus combined GPS accuracy buffer
            IF v_dist_meters > (45.0 * v_time_diff + COALESCE(p_accuracy, 0.0) + COALESCE(v_last_loc.accuracy, 0.0) + 50.0) THEN
                RAISE EXCEPTION 'Invalid Input: Implausible location jump detected' USING ERRCODE = '22023';
            END IF;
        END IF;
    END IF;

    INSERT INTO public.bus_locations_latest (
        bus_id, school_id, trip_id, lat, lng, heading, speed, accuracy, recorded_at, updated_at
    )
    VALUES (
        v_trip.bus_id, v_trip.school_id, p_trip_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, p_recorded_at, now()
    )
    ON CONFLICT (bus_id) DO UPDATE SET
        school_id = EXCLUDED.school_id,
        trip_id = EXCLUDED.trip_id,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        heading = EXCLUDED.heading,
        speed = EXCLUDED.speed,
        accuracy = EXCLUDED.accuracy,
        recorded_at = EXCLUDED.recorded_at,
        updated_at = now()
    WHERE EXCLUDED.recorded_at > bus_locations_latest.recorded_at;

    INSERT INTO public.bus_location_history (
        school_id, trip_id, bus_id, lat, lng, heading, speed, accuracy, recorded_at
    )
    VALUES (
        v_trip.school_id, p_trip_id, v_trip.bus_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, p_recorded_at
    );
END;
$$;

-- 18. Audited public.create_school RPC (role 'owner' only)
CREATE OR REPLACE FUNCTION public.create_school(
    name text,
    code text,
    timezone text,
    phone text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id uuid := (SELECT auth.uid());
    v_role text := (SELECT app_security.current_user_role());
    v_code text;
    v_school_id uuid;
BEGIN
    IF v_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'Access Denied: Only platform owner can create schools' USING ERRCODE = '42501';
    END IF;

    IF name IS NULL OR length(trim(name)) < 2 THEN
        RAISE EXCEPTION 'Validation Error: School name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;

    IF code IS NULL OR length(trim(code)) < 2 THEN
        RAISE EXCEPTION 'Validation Error: School code must be at least 2 characters' USING ERRCODE = '22023';
    END IF;

    v_code := upper(trim(code));

    IF EXISTS (SELECT 1 FROM public.schools s WHERE s.code = v_code) THEN
        RAISE EXCEPTION 'Unique violation: School code % already exists', v_code USING ERRCODE = '23505';
    END IF;

    IF timezone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE pg_timezone_names.name = trim(timezone)) THEN
        RAISE EXCEPTION 'Invalid Input: Timezone % does not exist in pg_timezone_names', timezone USING ERRCODE = '22023';
    END IF;

    IF phone IS NOT NULL AND trim(phone) <> '' AND trim(phone) !~ '^\+[1-9][0-9]{7,14}$' THEN
        RAISE EXCEPTION 'Validation Error: Invalid contact phone number format (E.164 required)' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.schools (name, code, timezone, contact_phone)
    VALUES (trim(name), v_code, trim(timezone), NULLIF(trim(phone), ''))
    RETURNING id INTO v_school_id;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_school_id,
        NULL,
        'CREATE_SCHOOL',
        jsonb_build_object(
            'actor_id', v_owner_id,
            'actor_role', 'owner',
            'school_id', v_school_id,
            'name', trim(name),
            'code', v_code,
            'timezone', trim(timezone),
            'contact_phone', NULLIF(trim(phone), '')
        )
    );

    RETURN v_school_id;
END;
$$;

-- 19. Privilege Hardening: Column-level grants, Function executions & Revocations
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, language_pref) ON public.profiles TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_school(text, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.create_alert_event(uuid, uuid, uuid, uuid, text, text, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_alert_event(uuid, uuid, uuid, uuid, text, text, jsonb, integer) TO service_role;

REVOKE ALL ON FUNCTION app_security.purge_expired_location_history(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.purge_expired_location_history(integer, integer) TO service_role;

-- 20. Realtime Trip Broadcast Policy (Wrapped safely, no redundant GRANTs)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages'
    ) THEN
        BEGIN
            DROP POLICY IF EXISTS realtime_trip_broadcast_policy ON realtime.messages;

            CREATE POLICY realtime_trip_broadcast_policy ON realtime.messages
                FOR SELECT TO authenticated
                USING (
                    extension = 'broadcast'
                    AND realtime.topic() LIKE 'trip:%'
                    AND app_security.safe_uuid(substring(realtime.topic() FROM 6)) IS NOT NULL
                    AND (
                        -- Managers of the trip's school
                        ((SELECT app_security.current_user_role()) = 'manager' AND (
                            SELECT t.school_id 
                            FROM public.trips t 
                            WHERE t.id = app_security.safe_uuid(substring(realtime.topic() FROM 6))
                        ) = (SELECT app_security.current_user_school_id()))
                        OR
                        -- Parents whose child is on this trip
                        ((SELECT app_security.current_user_role()) = 'parent' AND (
                            SELECT app_security.parent_has_child_on_trip(app_security.safe_uuid(substring(realtime.topic() FROM 6)))
                        ))
                    )
                );
        EXCEPTION
            WHEN insufficient_privilege THEN
                RAISE WARNING 'realtime_trip_broadcast_policy could not be created due to insufficient_privilege; skipping.';
            WHEN OTHERS THEN
                RAISE WARNING 'realtime_trip_broadcast_policy creation skipped: %', SQLERRM;
        END;
    END IF;
END $$;

-- 21. Final Execution Privilege Lockdown: Revoke from PUBLIC and anon across public and app_security
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA app_security FROM PUBLIC, anon;

-- Re-grant required application RPCs to authenticated
GRANT EXECUTE ON FUNCTION public.get_trip_location_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_student_absent(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_settings(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_health_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_location_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_school(text, text, text, text) TO authenticated;

-- Re-grant required RLS helpers to authenticated
GRANT EXECUTE ON FUNCTION app_security.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.current_user_school_id() TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.school_today(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.can_cancel_absence(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.driver_is_assigned_to_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.parent_has_child_on_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.driver_can_access_stop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.parent_can_access_stop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.driver_can_access_student_stop(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_security.safe_uuid(text) TO authenticated;

COMMIT;
