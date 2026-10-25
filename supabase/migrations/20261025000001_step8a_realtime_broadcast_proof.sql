-- ==============================================================================
-- SchoolBus Connect - Step 8a: Realtime Broadcast Proof
-- Migration: 20261025000001_step8a_realtime_broadcast_proof.sql
--
-- Adds forward RPC to emit location broadcasts via realtime.send
-- to topic trip:<trip_id> with private = true.
-- Also sends one proof broadcast for an existing trip upon migration run.
-- ==============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.broadcast_trip_location(
    p_trip_id uuid,
    p_payload jsonb DEFAULT '{"lat":9.02,"lng":38.75,"speed":10.5,"accuracy":15.0,"t":1792825000}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_topic text;
    v_trip_exists boolean;
BEGIN
    IF p_trip_id IS NULL THEN
        RAISE EXCEPTION 'Trip ID cannot be null';
    END IF;

    SELECT EXISTS (SELECT 1 FROM public.trips WHERE id = p_trip_id) INTO v_trip_exists;
    IF NOT v_trip_exists THEN
        RAISE EXCEPTION 'Trip % not found', p_trip_id;
    END IF;

    v_topic := 'trip:' || p_trip_id::text;

    -- Send realtime broadcast to private channel (enforces RLS on realtime.messages)
    PERFORM realtime.send(
        p_payload,
        'location',
        v_topic,
        true
    );

    RETURN jsonb_build_object(
        'status', 'broadcast_sent',
        'topic', v_topic,
        'payload', p_payload
    );
END;
$$;

REVOKE ALL ON FUNCTION public.broadcast_trip_location(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.broadcast_trip_location(uuid, jsonb) TO authenticated, service_role;

-- Send one broadcast proof for the newest trip in database
DO $$
DECLARE
    v_trip_id uuid;
BEGIN
    SELECT id INTO v_trip_id FROM public.trips ORDER BY trip_date DESC, created_at DESC LIMIT 1;
    IF v_trip_id IS NOT NULL THEN
        PERFORM realtime.send(
            '{"event":"migration_proof","t":1792825000}'::jsonb,
            'location',
            'trip:' || v_trip_id::text,
            true
        );
    END IF;
END;
$$;

COMMIT;
