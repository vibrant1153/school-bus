-- ==============================================================================
-- SchoolBus Connect - Step 8b: GPS Telemetry Ingest & Realtime Broadcast
-- Migration: 20261025000002_step8b_ingest_location.sql
--
-- 1. Updates ingest_location to accept age_ms (Date.now() - position.timestamp).
-- 2. Calculates recorded_at = now() - age_ms; drops clock-skew warning.
-- 3. Enforces age <= 30s (0 to 30,000 ms), speed in m/s <= 45 m/s, jump check.
-- 4. Enforces min interval ~5s between stored points; drops out-of-order points.
-- 5. Calls realtime.send(topic trip:<id>, private:true) ONLY for accepted points.
-- 6. Payload is under 100 bytes with no names: {lat, lng, spd, acc, t}.
-- ==============================================================================

BEGIN;

-- Drop previous signature taking recorded_at timestamptz
DROP FUNCTION IF EXISTS public.ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz);

-- Create new ingest_location taking p_age_ms integer
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
    v_role text := (SELECT app_security.current_user_role());
    v_trip record;
    v_last_loc record;
    v_recorded_at timestamptz;
    v_time_diff double precision;
    v_dist_meters double precision;
    v_payload jsonb;
BEGIN
    -- 1. Role verification: Drivers only
    IF v_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only drivers may ingest GPS telemetry' USING ERRCODE = '42501';
    END IF;

    -- 2. Input Nullability Checks
    IF p_lat IS NULL OR p_lng IS NULL OR p_accuracy IS NULL OR p_age_ms IS NULL THEN
        RAISE EXCEPTION 'Invalid Input: lat, lng, accuracy, and age_ms cannot be null' USING ERRCODE = '22023';
    END IF;

    -- 3. Coordinate Bounds Validation
    IF p_lat < -90.0 OR p_lat > 90.0 OR p_lng < -180.0 OR p_lng > 180.0 THEN
        RAISE EXCEPTION 'Invalid Input: Coordinates out of bounds' USING ERRCODE = '22023';
    END IF;

    -- 4. Accuracy Plausibility
    IF p_accuracy < 0.0 OR p_accuracy > 1000.0 THEN
        RAISE EXCEPTION 'Invalid Input: Accuracy out of plausible range (0-1000m)' USING ERRCODE = '22023';
    END IF;

    -- 5. Heading Plausibility
    IF p_heading IS NOT NULL AND (p_heading < 0.0 OR p_heading > 360.0) THEN
        RAISE EXCEPTION 'Invalid Input: Heading must be between 0 and 360' USING ERRCODE = '22023';
    END IF;

    -- 6. Speed Plausibility (m/s; max 45 m/s is ~162 km/h)
    IF p_speed IS NOT NULL AND (p_speed < 0.0 OR p_speed > 45.0) THEN
        RAISE EXCEPTION 'Invalid Input: Speed out of plausible range (unit: m/s, max: 45 m/s)' USING ERRCODE = '22023';
    END IF;

    -- 7. Age Validation: Point age must be between 0 and 30,000 ms (~30 seconds)
    IF p_age_ms < 0 OR p_age_ms > 30000 THEN
        RAISE EXCEPTION 'Invalid Input: Point age outside allowed window (0-30s)' USING ERRCODE = '22023';
    END IF;

    -- Server computes recorded_at from current server time minus elapsed point age
    v_recorded_at := now() - (p_age_ms * interval '1 millisecond');

    -- 8. Verify Trip Existence & Driver Assignment
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

    -- 9. Inspect Last Recorded Location for this Bus
    SELECT lat, lng, accuracy, recorded_at INTO v_last_loc
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

        -- Implausible jump check between consecutive points
        v_time_diff := EXTRACT(EPOCH FROM (v_recorded_at - v_last_loc.recorded_at));
        IF v_time_diff > 0 THEN
            v_dist_meters := sqrt(
                power((p_lat - v_last_loc.lat) * 111320.0, 2) +
                power((p_lng - v_last_loc.lng) * 111320.0 * cos(radians((p_lat + v_last_loc.lat) / 2.0)), 2)
            );

            IF v_dist_meters > (45.0 * v_time_diff + COALESCE(p_accuracy, 0.0) + COALESCE(v_last_loc.accuracy, 0.0) + 50.0) THEN
                RAISE EXCEPTION 'Invalid Input: Implausible location jump detected' USING ERRCODE = '22023';
            END IF;
        END IF;
    END IF;

    -- 10. Persist to bus_locations_latest
    INSERT INTO public.bus_locations_latest (
        bus_id, school_id, trip_id, lat, lng, heading, speed, accuracy, recorded_at, updated_at
    )
    VALUES (
        v_trip.bus_id, v_trip.school_id, p_trip_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, v_recorded_at, now()
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

    -- 11. Append to bus_location_history
    INSERT INTO public.bus_location_history (
        school_id, trip_id, bus_id, lat, lng, heading, speed, accuracy, recorded_at
    )
    VALUES (
        v_trip.school_id, p_trip_id, v_trip.bus_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, v_recorded_at
    );

    -- 12. Compact Realtime Broadcast (under 100 bytes, no names)
    -- Format: {"lat": 9.02345, "lng": 38.75123, "spd": 12.4, "acc": 10.0, "t": 1792914797}
    v_payload := jsonb_build_object(
        'lat', round(p_lat::numeric, 5),
        'lng', round(p_lng::numeric, 5),
        'spd', round(COALESCE(p_speed, 0.0)::numeric, 1),
        'acc', round(p_accuracy::numeric, 1),
        't', (EXTRACT(EPOCH FROM v_recorded_at) * 1000)::bigint
    );

    PERFORM realtime.send(
        v_payload,
        'location',
        'trip:' || p_trip_id::text,
        true -- private = true (RLS enforced on realtime.messages)
    );

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
