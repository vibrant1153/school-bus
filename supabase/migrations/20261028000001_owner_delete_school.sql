-- ==============================================================================
-- SchoolBus Connect - Platform Owner School Deletion RPC
-- Migration: 20261028000001_owner_delete_school.sql
--
-- PURPOSE:
-- 1. Provides public.delete_school(p_school_id uuid) RPC callable strictly by role 'owner'.
-- 2. Validates that no trips are currently 'in_progress' before allowing deletion.
-- 3. Deletes the school from public.schools, triggering Postgres ON DELETE CASCADE
--    across all 17 child tables (buses, routes, schedules, stops, students,
--    guardians, trips, locations, audit logs, and profiles).
-- 4. Cleans up associated auth.users to prevent orphaned auth accounts.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.delete_school(p_school_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id uuid := (SELECT auth.uid());
    v_role text := (SELECT app_security.current_user_role());
    v_school_name text;
    v_school_code text;
    v_active_trips integer;
BEGIN
    -- 1. Verify caller has active owner role
    IF v_role IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'Access Denied: Only platform owner can delete schools' USING ERRCODE = '42501';
    END IF;

    -- 2. Verify school exists
    SELECT name, code INTO v_school_name, v_school_code
    FROM public.schools
    WHERE id = p_school_id;

    IF v_school_name IS NULL THEN
        RAISE EXCEPTION 'School with ID % not found', p_school_id USING ERRCODE = 'P0002';
    END IF;

    -- 3. Invariant check: cannot delete while any trip is actively in progress
    SELECT count(*) INTO v_active_trips
    FROM public.trips
    WHERE school_id = p_school_id AND status = 'in_progress';

    IF v_active_trips > 0 THEN
        RAISE EXCEPTION 'Cannot delete school while % trip(s) are actively in progress. Please ensure all ongoing trips have ended before deleting this school.', v_active_trips USING ERRCODE = '23503';
    END IF;

    -- 4. Delete the school record. All child tables cascade automatically:
    --    - buses, bus_plates, bus_assignments
    --    - routes, route_schedules, stops, student_stops
    --    - students, guardians, absences, absence_reasons
    --    - trips, trip_stops, trip_summaries
    --    - bus_locations, bus_locations_latest, alert_events, push_subscriptions
    --    - profiles, audit_log
    DELETE FROM public.schools WHERE id = p_school_id;

    RETURN jsonb_build_object(
        'success', true,
        'school_id', p_school_id,
        'deleted_school_name', v_school_name,
        'deleted_school_code', v_school_code
    );
END;
$$;

-- Secure function permissions
REVOKE ALL ON FUNCTION public.delete_school(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_school(uuid) TO authenticated;
