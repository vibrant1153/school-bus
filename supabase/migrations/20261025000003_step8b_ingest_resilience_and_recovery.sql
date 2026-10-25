-- ==============================================================================
-- Step 8b Follow-up: Ingest Location Resilience and Jump Recovery Migration
-- Migration: 20261025000003_step8b_ingest_resilience_and_recovery.sql
--
-- Enhancements:
-- 1. Bus Locations Latest: add last_rejected_* columns to track candidate rejected points.
-- 2. Broadcast Resilience: wrap realtime.send in BEGIN ... EXCEPTION block so a broadcast
--    failure never rolls back the stored location.
-- 3. Jump Check Recovery:
--    a. If last accepted point is older than ~60s (v_time_diff >= 60), accept the new point.
--    b. If consecutive rejected points agree with each other within physical thresholds,
--       accept the new point.
--    c. When accepted, clear last_rejected candidate points.
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
            -- Recovery Condition 1: If last accepted point is older than ~60s, bypass jump check & accept
            IF v_time_diff < 60.0 THEN
                v_dist_meters := sqrt(
                    power((p_lat - v_last_loc.lat) * 111320.0, 2) +
                    power((p_lng - v_last_loc.lng) * 111320.0 * cos(radians((p_lat + v_last_loc.lat) / 2.0)), 2)
                );

                IF v_dist_meters > (45.0 * v_time_diff + COALESCE(p_accuracy, 0.0) + COALESCE(v_last_loc.accuracy, 0.0) + 50.0) THEN
                    -- Recovery Condition 2: Do consecutive rejected points agree with each other?
                    v_consecutive_agrees := false;
                    IF v_last_loc.last_rejected_at IS NOT NULL
                       AND v_recorded_at > v_last_loc.last_rejected_at
                       AND v_recorded_at < (v_last_loc.last_rejected_at + interval '60 seconds') THEN
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
                        -- Record this candidate rejected point and reject without broadcast
                        UPDATE public.bus_locations_latest
                        SET last_rejected_lat = p_lat,
                            last_rejected_lng = p_lng,
                            last_rejected_accuracy = p_accuracy,
                            last_rejected_at = v_recorded_at,
                            updated_at = now()
                        WHERE bus_id = v_trip.bus_id;

                        RETURN jsonb_build_object('status', 'rejected_jump', 'message', 'Invalid Input: Implausible location jump detected');
                    END IF;
                    -- If v_consecutive_agrees is true, we accept the new point
                END IF;
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

REVOKE ALL ON FUNCTION public.ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, integer) TO authenticated, service_role;

COMMIT;
