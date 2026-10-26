-- ==============================================================================
-- Step 8b Follow-up: Ingest Location Resilience, Jump Recovery & Cleanup Migration
-- Migration: 20261025000003_step8b_ingest_resilience_and_recovery.sql
--
-- Enhancements:
-- 1. Bus Locations Latest: add last_rejected_* columns to track candidate rejected points.
-- 2. Broadcast Resilience: wrap realtime.send in BEGIN ... EXCEPTION block so a broadcast
--    failure never rolls back the stored location.
-- 3. Jump Check Recovery:
--    a. Cap jump check bypass: jumps > 5000m (~5 km) are ALWAYS rejected, even after outage.
--    b. Outage bypass: jumps <= 5000m after >= 60s outage are accepted.
--    c. Two-agreeing-points recovery: accepts when consecutive rejected points agree within
--       physical thresholds AND both points have reasonable accuracy (<= 100m).
--    d. When accepted, clears last_rejected candidate points.
-- 4. End / Cancel Trip & Daily Purge Cleanup:
--    a. end_trip deletes row in bus_locations_latest (clearing live location & last_rejected_*).
--    b. cancel_trip deletes row in bus_locations_latest.
--    c. purge_expired_location_history, purge_location_history, and purge_school_location_history
--       clear completed/cancelled trips and stale rows from bus_locations_latest.
-- ==============================================================================

BEGIN;

-- 1. Add rejected point tracking columns to bus_locations_latest
ALTER TABLE public.bus_locations_latest
    ADD COLUMN IF NOT EXISTS last_rejected_lat double precision,
    ADD COLUMN IF NOT EXISTS last_rejected_lng double precision,
    ADD COLUMN IF NOT EXISTS last_rejected_accuracy double precision,
    ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz;


-- 2. Update ingest_location function
CREATE OR REPLACE FUNCTION public.ingest_location(
    p_trip_id uuid,
    p_lat double precision,
    p_lng double precision,
    p_heading double precision,
    p_speed double precision,
    p_accuracy double precision,
    p_age_ms integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id uuid;
    v_recorded_at timestamptz;
    v_trip record;
    v_last_loc record;
    v_time_diff double precision;
    v_dist_meters double precision;
    v_rej_time_diff double precision;
    v_rej_dist double precision;
    v_is_jump boolean := false;
    v_consecutive_agrees boolean := false;
    v_payload jsonb;
BEGIN
    -- 1. Caller Authentication
    v_caller_id := auth.uid();
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
    END IF;

    -- 2. Validate GPS Age: Age in ms, must be [0, 30000]
    IF p_age_ms IS NULL OR p_age_ms < 0 OR p_age_ms > 30000 THEN
        RAISE EXCEPTION 'Invalid Input: Point age outside allowed window (0-30s)' USING ERRCODE = '22023';
    END IF;

    -- Compute recorded_at on server: now() - age_ms
    v_recorded_at := now() - (p_age_ms * interval '1 millisecond');

    -- 3. Validate Coordinates Range
    IF p_lat IS NULL OR p_lat < -90.0 OR p_lat > 90.0 THEN
        RAISE EXCEPTION 'Invalid Input: Latitude outside [-90, 90]' USING ERRCODE = '22023';
    END IF;

    IF p_lng IS NULL OR p_lng < -180.0 OR p_lng > 180.0 THEN
        RAISE EXCEPTION 'Invalid Input: Longitude outside [-180, 180]' USING ERRCODE = '22023';
    END IF;

    -- 4. Validate Speed (m/s): max 45 m/s (~162 km/h)
    IF p_speed IS NOT NULL AND (p_speed < 0.0 OR p_speed > 45.0) THEN
        RAISE EXCEPTION 'Invalid Input: Speed exceeds physical maximum (45 m/s)' USING ERRCODE = '22023';
    END IF;

    -- 5. Validate Accuracy
    IF p_accuracy IS NOT NULL AND (p_accuracy < 0.0 OR p_accuracy > 5000.0) THEN
        RAISE EXCEPTION 'Invalid Input: Accuracy radius outside valid range' USING ERRCODE = '22023';
    END IF;

    -- 6. Validate Heading
    IF p_heading IS NOT NULL AND (p_heading < 0.0 OR p_heading > 360.0) THEN
        RAISE EXCEPTION 'Invalid Input: Heading outside [0, 360]' USING ERRCODE = '22023';
    END IF;

    -- 7. Query Trip Record
    SELECT id, school_id, route_id, bus_id, driver_profile_id, status
    INTO v_trip
    FROM public.trips
    WHERE id = p_trip_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = '02000';
    END IF;

    -- 8. Authorization Checks
    IF NOT app_security.driver_is_assigned_to_trip(p_trip_id) THEN
        RAISE EXCEPTION 'Access Denied: Driver not assigned to this trip' USING ERRCODE = '42501';
    END IF;

    IF v_trip.status IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'Trip state error: Trip is not in progress' USING ERRCODE = '22000';
    END IF;

    -- 9. Inspect Last Recorded Location for this Bus
    SELECT lat, lng, accuracy, recorded_at,
           last_rejected_lat, last_rejected_lng, last_rejected_accuracy, last_rejected_at
    INTO v_last_loc
    FROM public.bus_locations_latest
    WHERE bus_id = v_trip.bus_id;

    IF v_last_loc.recorded_at IS NOT NULL THEN
        -- Out-of-order check: ignore older or duplicate timestamps without broadcast
        IF v_recorded_at <= v_last_loc.recorded_at THEN
            RETURN jsonb_build_object('status', 'ignored_out_of_order');
        END IF;

        -- Minimum interval check: ~5s throttle between stored points
        IF v_recorded_at < (v_last_loc.recorded_at + interval '5 seconds') THEN
            RETURN jsonb_build_object('status', 'ignored_rate_limit');
        END IF;

        -- Jump Check and Recovery Logic
        v_time_diff := EXTRACT(EPOCH FROM (v_recorded_at - v_last_loc.recorded_at));
        IF v_time_diff > 0 THEN
            v_dist_meters := sqrt(
                power((p_lat - v_last_loc.lat) * 111320.0, 2) +
                power((p_lng - v_last_loc.lng) * 111320.0 * cos(radians((p_lat + v_last_loc.lat) / 2.0)), 2)
            );

            -- Determine if this point constitutes an implausible jump:
            -- 1. Hard cap: Any jump over 5000m (~5 km) is ALWAYS treated as a jump (caps outage bypass).
            -- 2. Outage bypass: Jumps <= 5000m after >= 60s outage are accepted.
            -- 3. Speed limit: Points exceeding 45 m/s * dt + acc1 + acc2 + 50m are treated as jumps.
            v_is_jump := false;
            IF v_dist_meters > 5000.0 THEN
                v_is_jump := true;
            ELSIF v_time_diff >= 60.0 THEN
                v_is_jump := false;
            ELSIF v_dist_meters > (45.0 * v_time_diff + COALESCE(p_accuracy, 0.0) + COALESCE(v_last_loc.accuracy, 0.0) + 50.0) THEN
                v_is_jump := true;
            END IF;

            IF v_is_jump THEN
                -- Recovery Condition: Do consecutive rejected points agree with each other?
                -- Requires reasonable accuracy (<= 100m) for BOTH the candidate and the incoming point.
                v_consecutive_agrees := false;
                IF v_last_loc.last_rejected_at IS NOT NULL
                   AND v_recorded_at > v_last_loc.last_rejected_at
                   AND v_recorded_at < (v_last_loc.last_rejected_at + interval '60 seconds')
                   AND COALESCE(p_accuracy, 999.0) <= 100.0
                   AND COALESCE(v_last_loc.last_rejected_accuracy, 999.0) <= 100.0 THEN
                    v_rej_time_diff := EXTRACT(EPOCH FROM (v_recorded_at - v_last_loc.last_rejected_at));
                    v_rej_dist := sqrt(
                        power((p_lat - v_last_loc.last_rejected_lat) * 111320.0, 2) +
                        power((p_lng - v_last_loc.last_rejected_lng) * 111320.0 * cos(radians((p_lat + v_last_loc.last_rejected_lat) / 2.0)), 2)
                    );
                    IF v_rej_dist <= (45.0 * v_rej_time_diff + COALESCE(p_accuracy, 0.0) + COALESCE(v_last_loc.last_rejected_accuracy, 0.0) + 50.0) THEN
                        v_consecutive_agrees := true;
                    END IF;
                END IF;

                IF NOT v_consecutive_agrees THEN
                    -- Record candidate rejected point and return rejected_jump
                    UPDATE public.bus_locations_latest
                    SET last_rejected_lat = p_lat,
                        last_rejected_lng = p_lng,
                        last_rejected_accuracy = p_accuracy,
                        last_rejected_at = v_recorded_at,
                        updated_at = now()
                    WHERE bus_id = v_trip.bus_id;

                    RETURN jsonb_build_object('status', 'rejected_jump', 'message', 'Invalid Input: Implausible location jump detected');
                END IF;
                -- If v_consecutive_agrees is true, we accept the new point and reset last_rejected_* below
            END IF;
        END IF;
    END IF;

    -- 10. Persist to bus_locations_latest and clear last_rejected tracking
    INSERT INTO public.bus_locations_latest (
        bus_id, school_id, trip_id, lat, lng, heading, speed, accuracy, recorded_at, updated_at,
        last_rejected_lat, last_rejected_lng, last_rejected_accuracy, last_rejected_at
    )
    VALUES (
        v_trip.bus_id, v_trip.school_id, p_trip_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, v_recorded_at, now(),
        NULL, NULL, NULL, NULL
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
        updated_at = now(),
        last_rejected_lat = NULL,
        last_rejected_lng = NULL,
        last_rejected_accuracy = NULL,
        last_rejected_at = NULL
    WHERE EXCLUDED.recorded_at > bus_locations_latest.recorded_at;

    -- 11. Append to bus_location_history
    INSERT INTO public.bus_location_history (
        school_id, trip_id, bus_id, lat, lng, heading, speed, accuracy, recorded_at
    )
    VALUES (
        v_trip.school_id, p_trip_id, v_trip.bus_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, v_recorded_at
    );

    -- 12. Compact Realtime Broadcast wrapped in resilient exception block
    v_payload := jsonb_build_object(
        'lat', round(p_lat::numeric, 5),
        'lng', round(p_lng::numeric, 5),
        'spd', round(COALESCE(p_speed, 0.0)::numeric, 1),
        'acc', round(p_accuracy::numeric, 1),
        't', (EXTRACT(EPOCH FROM v_recorded_at) * 1000)::bigint
    );

    BEGIN
        PERFORM realtime.send(
            v_payload,
            'location',
            'trip:' || p_trip_id::text,
            true -- private = true (RLS enforced on realtime.messages)
        );
    EXCEPTION WHEN OTHERS THEN
        -- Broadcast failure must never roll back stored point
        NULL;
    END;

    RETURN jsonb_build_object(
        'status', 'accepted',
        'recorded_at', v_recorded_at,
        'payload_size_bytes', octet_length(v_payload::text)
    );
END;
$$;


-- 3. Update end_trip to clear bus_locations_latest and last_rejected_* for the bus
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

    -- Clear latest location and rejected jump points for this bus
    DELETE FROM public.bus_locations_latest
    WHERE bus_id = v_trip.bus_id;

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


-- 4. Update cancel_trip to clear bus_locations_latest and last_rejected_* for the bus
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

    -- Clear latest location and rejected jump points for this bus
    DELETE FROM public.bus_locations_latest
    WHERE bus_id = v_trip.bus_id;

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
        'cancelled_at', v_now
    );
END;
$$;


-- 5. Update automated retention purge to clear bus_locations_latest
CREATE OR REPLACE FUNCTION app_security.purge_expired_location_history(
    p_hours integer DEFAULT 72,
    p_summary_days integer DEFAULT 90
)
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
    v_deleted_latest integer := 0;
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

    -- Clear bus_locations_latest for completed/cancelled trips or older than cutoff
    DELETE FROM public.bus_locations_latest
    WHERE recorded_at < v_cutoff
       OR trip_id IN (SELECT id FROM public.trips WHERE status IN ('completed', 'cancelled'));
    GET DIAGNOSTICS v_deleted_latest = ROW_COUNT;

    INSERT INTO public.audit_log (performed_by, action, details_json)
    VALUES (
        NULL,
        'SYSTEM_PURGE_EXPIRED_LOCATION_HISTORY',
        jsonb_build_object(
            'deleted_history_points', v_deleted,
            'deleted_summaries', v_deleted_summaries,
            'cleared_latest_points', v_deleted_latest,
            'history_cutoff', v_cutoff,
            'summary_cutoff', v_summary_cutoff
        )
    );

    RETURN v_deleted;
END;
$$;


-- 6. Update manager purge_location_history to clear bus_locations_latest
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

    -- Clear bus_locations_latest for this school's finished/cancelled trips or before today
    DELETE FROM public.bus_locations_latest
    WHERE school_id = v_school_id
      AND (
          recorded_at < v_today_start
          OR trip_id IN (SELECT id FROM public.trips WHERE school_id = v_school_id AND status IN ('completed', 'cancelled'))
      );

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (v_school_id, v_user_id, 'PURGE_LOCATION_HISTORY', jsonb_build_object('deleted_points', v_deleted, 'before_timestamp', v_today_start));

    RETURN v_deleted;
END;
$$;


-- 7. Update on-demand purge_school_location_history to delete from bus_locations_latest
CREATE OR REPLACE FUNCTION public.purge_school_location_history(
    p_school_id uuid,
    p_hours integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id uuid := (SELECT auth.uid());
    v_role text := (SELECT app_security.current_user_role());
    v_deleted_count integer := 0;
    v_school_name text;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Access Denied: Unauthenticated' USING ERRCODE = '42501';
    END IF;

    IF v_role = 'owner' THEN
        -- Owner can purge for any school
        NULL;
    ELSIF v_role = 'manager' THEN
        IF p_school_id IS DISTINCT FROM (SELECT app_security.current_user_school_id()) THEN
            RAISE EXCEPTION 'Cross-tenant violation: Cannot purge data for another school' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'Access Denied: Only platform owner or school manager can purge location data' USING ERRCODE = '42501';
    END IF;

    SELECT name INTO v_school_name FROM public.schools WHERE id = p_school_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'School not found' USING ERRCODE = 'P0002';
    END IF;

    IF p_hours > 0 THEN
        DELETE FROM public.bus_location_history
        WHERE school_id = p_school_id
          AND recorded_at < (now() - (p_hours || ' hours')::interval);
    ELSE
        -- 0 hours means purge all location history for this school immediately
        DELETE FROM public.bus_location_history
        WHERE school_id = p_school_id;
    END IF;
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

    -- Clear bus_locations_latest and last_rejected_* for this school's buses
    IF p_hours > 0 THEN
        DELETE FROM public.bus_locations_latest
        WHERE school_id = p_school_id
          AND (
              recorded_at < (now() - (p_hours || ' hours')::interval)
              OR trip_id IN (SELECT id FROM public.trips WHERE school_id = p_school_id AND status IN ('completed', 'cancelled'))
          );
    ELSE
        DELETE FROM public.bus_locations_latest
        WHERE school_id = p_school_id;
    END IF;

    -- Write audit log
    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        p_school_id,
        CASE WHEN v_role = 'owner' THEN NULL ELSE v_caller_id END,
        'MANUAL_PURGE_LOCATION_DATA',
        jsonb_build_object(
            'actor_id', v_caller_id,
            'actor_role', v_role,
            'school_id', p_school_id,
            'school_name', v_school_name,
            'hours_threshold', p_hours,
            'deleted_points', v_deleted_count
        )
    );

    RETURN jsonb_build_object(
        'status', 'success',
        'school_id', p_school_id,
        'deleted_points', v_deleted_count
    );
END;
$$;


-- Permissions & Grants
REVOKE ALL ON FUNCTION public.ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, integer) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.end_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_trip(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_trip(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_trip(uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION app_security.purge_expired_location_history(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_security.purge_expired_location_history(integer, integer) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.purge_location_history() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_location_history() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.purge_school_location_history(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.purge_school_location_history(uuid, integer) TO authenticated, service_role;

COMMIT;
