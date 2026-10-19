-- ==============================================================================
-- SchoolBus Connect - Phase 2, Step 3: RLS Policies, Security Architecture & Privilege Hardening
-- Migration: 20261019000001_rls_policies_and_security.sql
--
-- Guarantees:
-- 1. All app users authenticate through role 'authenticated' with JWT claims.
-- 2. Sensitive columns moved to dedicated RLS tables:
--    - absences.reason moved to absence_reasons (managers and reporting parents only).
--    - buses.plate_number moved to bus_plates (managers and assigned drivers only).
--    - Existing data preserved by copying before dropping columns (without CASCADE).
-- 3. Dedicated 'app_security' schema for internal security helpers (not exposed over HTTP).
--    - Helpers read auth.uid() internally (no user-id parameters).
-- 4. Server RPCs hardened:
--    - All use IS DISTINCT FROM for role checks.
--    - SET search_path = ''.
--    - Input validation on all parameters.
--    - REVOKE EXECUTE from PUBLIC and anon.
-- 5. Drivers have NO direct SELECT on absences; attendance queried via is_student_absent() RPC.
--    - Scoped strictly to students assigned to driver's current trip.
-- 6. Realtime messages scoped strictly to 'broadcast' extension and safe regex-validated 'trip:<trip_id>' topics.
--    - No client INSERT policy on realtime.messages for anyone.
-- 7. Platform owner restricted to schools, manager profiles, and aggregated health RPC (no student PII).
-- 8. Complete privilege script revoking PUBLIC/anon table access and setting strict default privileges.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Private Security Schema
-- ------------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_security;
REVOKE ALL ON SCHEMA app_security FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_security TO authenticated;

-- ------------------------------------------------------------------------------
-- 2. Composite Constraint & Sensitive Column Relocation
-- ------------------------------------------------------------------------------
-- Add composite unique constraint on absences for tenant foreign key references
ALTER TABLE absences ADD CONSTRAINT uq_absences_school_id UNIQUE (school_id, id);

-- 2a. Table: absence_reasons
CREATE TABLE IF NOT EXISTS absence_reasons (
    absence_id uuid PRIMARY KEY REFERENCES absences(id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_absence_reasons_absence FOREIGN KEY (school_id, absence_id)
        REFERENCES absences(school_id, id) ON DELETE CASCADE
);
ALTER TABLE absence_reasons ENABLE ROW LEVEL SECURITY;

-- 2b. Table: bus_plates
CREATE TABLE IF NOT EXISTS bus_plates (
    bus_id uuid PRIMARY KEY REFERENCES buses(id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    plate_number text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_bus_plates_bus FOREIGN KEY (school_id, bus_id)
        REFERENCES buses(school_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_bus_plates_school_plate UNIQUE (school_id, plate_number)
);
ALTER TABLE bus_plates ENABLE ROW LEVEL SECURITY;

-- 2c. Data Preservation: Copy existing data before dropping columns
INSERT INTO absence_reasons (absence_id, school_id, reason)
SELECT id, school_id, reason 
FROM absences 
WHERE reason IS NOT NULL AND length(trim(reason)) > 0
ON CONFLICT (absence_id) DO NOTHING;

INSERT INTO bus_plates (bus_id, school_id, plate_number)
SELECT id, school_id, plate_number 
FROM buses 
WHERE plate_number IS NOT NULL AND length(trim(plate_number)) > 0
ON CONFLICT (bus_id) DO NOTHING;

-- 2d. Explicit Dependency Handling: Drop unique constraint on plate before dropping column (NO CASCADE)
ALTER TABLE buses DROP CONSTRAINT IF EXISTS uq_buses_school_plate;
ALTER TABLE buses DROP COLUMN IF EXISTS plate_number;
ALTER TABLE absences DROP COLUMN IF EXISTS reason;

-- ------------------------------------------------------------------------------
-- 3. Security Helpers in 'app_security'
-- ------------------------------------------------------------------------------

-- Helper 1: Current role from profiles (never from JWT metadata)
CREATE OR REPLACE FUNCTION app_security.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT role FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

-- Helper 2: Current school_id from profiles
CREATE OR REPLACE FUNCTION app_security.current_user_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT school_id FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

-- Helper 3: Child on trip verification (evaluates auth.uid() internally)
CREATE OR REPLACE FUNCTION app_security.parent_has_child_on_trip(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
      SELECT 1
      FROM public.trips t
      JOIN public.stops s ON s.route_id = t.route_id
      JOIN public.student_stops ss ON ss.stop_id = s.id AND ss.direction = t.direction
      JOIN public.guardians g ON g.student_id = ss.student_id
      WHERE t.id = p_trip_id
        AND g.profile_id = (SELECT auth.uid())
  );
$$;

-- Helper 4: Absence cancellation rules for direction 'morning', 'afternoon', and 'both'
CREATE OR REPLACE FUNCTION app_security.can_cancel_absence(p_absence_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_school_id uuid;
    v_student_id uuid;
    v_trip_date date;
    v_direction text;
    v_reported_by uuid;
    v_timezone text;
    v_today date;
    v_caller_id uuid;
BEGIN
    v_caller_id := (SELECT auth.uid());

    SELECT a.school_id, a.student_id, a.trip_date, a.direction, a.reported_by, s.timezone
    INTO v_school_id, v_student_id, v_trip_date, v_direction, v_reported_by, v_timezone
    FROM public.absences a
    JOIN public.schools s ON s.id = a.school_id
    WHERE a.id = p_absence_id;

    IF NOT FOUND THEN RETURN false; END IF;
    IF v_reported_by IS DISTINCT FROM v_caller_id THEN RETURN false; END IF;

    v_today := (now() AT TIME ZONE v_timezone)::date;
    IF v_trip_date > v_today THEN RETURN true; END IF;
    IF v_trip_date < v_today THEN RETURN false; END IF;

    -- For today: verify trip hasn't started
    IF v_direction = 'morning' THEN
        RETURN NOT EXISTS (
            SELECT 1 FROM public.trips t
            JOIN public.student_stops ss ON ss.student_id = v_student_id AND ss.direction = t.direction
            WHERE t.school_id = v_school_id AND t.trip_date = v_trip_date AND t.direction = 'morning'
              AND t.status IN ('in_progress', 'completed')
        );
    ELSIF v_direction = 'afternoon' THEN
        RETURN NOT EXISTS (
            SELECT 1 FROM public.trips t
            JOIN public.student_stops ss ON ss.student_id = v_student_id AND ss.direction = t.direction
            WHERE t.school_id = v_school_id AND t.trip_date = v_trip_date AND t.direction = 'afternoon'
              AND t.status IN ('in_progress', 'completed')
        );
    ELSIF v_direction = 'both' THEN
        -- 'both' cancellation allowed only if NEITHER trip has started
        RETURN NOT EXISTS (
            SELECT 1 FROM public.trips t
            JOIN public.student_stops ss ON ss.student_id = v_student_id AND ss.direction = t.direction
            WHERE t.school_id = v_school_id AND t.trip_date = v_trip_date
              AND t.direction IN ('morning', 'afternoon')
              AND t.status IN ('in_progress', 'completed')
        );
    END IF;

    RETURN false;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. Server RPCs & Public Callable Functions
-- ------------------------------------------------------------------------------

-- 4a. is_student_absent (Driver scoped to current trip only; Manager to school)
CREATE OR REPLACE FUNCTION is_student_absent(
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
    v_role text;
    v_user_school_id uuid;
    v_caller_id uuid;
    v_student_school_id uuid;
BEGIN
    v_caller_id := (SELECT auth.uid());
    v_role := (SELECT app_security.current_user_role());
    v_user_school_id := (SELECT app_security.current_user_school_id());

    -- Input validation
    IF p_student_id IS NULL OR p_trip_date IS NULL OR p_direction IS NULL THEN
        RAISE EXCEPTION 'Invalid Input: student_id, trip_date, and direction are required' USING ERRCODE = '22023';
    END IF;

    IF p_direction NOT IN ('morning', 'afternoon') THEN
        RAISE EXCEPTION 'Invalid Input: direction must be morning or afternoon' USING ERRCODE = '22023';
    END IF;

    -- Verify student belongs to caller's school
    SELECT school_id INTO v_student_school_id FROM public.students WHERE id = p_student_id;
    IF v_student_school_id IS NULL OR v_student_school_id IS DISTINCT FROM v_user_school_id THEN
        RAISE EXCEPTION 'Access Denied: Student not found in caller school' USING ERRCODE = '42501';
    END IF;

    IF v_role = 'manager' THEN
        RETURN EXISTS (
            SELECT 1 FROM public.absences a
            WHERE a.school_id = v_user_school_id
              AND a.student_id = p_student_id
              AND a.trip_date = p_trip_date
              AND (a.direction = p_direction OR a.direction = 'both')
        );
    ELSIF v_role = 'driver' THEN
        -- Driver must have active assignment for this trip carrying this student
        IF NOT EXISTS (
            SELECT 1
            FROM public.trips t
            JOIN public.stops s ON s.route_id = t.route_id
            JOIN public.student_stops ss ON ss.stop_id = s.id AND ss.direction = t.direction
            WHERE t.school_id = v_user_school_id
              AND t.driver_profile_id = v_caller_id
              AND t.trip_date = p_trip_date
              AND t.direction = p_direction
              AND ss.student_id = p_student_id
        ) THEN
            RAISE EXCEPTION 'Access Denied: Student is not assigned to driver current trip' USING ERRCODE = '42501';
        END IF;

        RETURN EXISTS (
            SELECT 1 FROM public.absences a
            WHERE a.school_id = v_user_school_id
              AND a.student_id = p_student_id
              AND a.trip_date = p_trip_date
              AND (a.direction = p_direction OR a.direction = 'both')
        );
    ELSE
        RAISE EXCEPTION 'Access Denied: Only drivers and managers may check absence status' USING ERRCODE = '42501';
    END IF;
END;
$$;

-- 4b. get_trip_location_history (Manager audited retrieval)
CREATE OR REPLACE FUNCTION get_trip_location_history(p_trip_id uuid)
RETURNS TABLE (
    out_id uuid,
    out_bus_id uuid,
    out_lat double precision,
    out_lng double precision,
    out_heading double precision,
    out_speed double precision,
    out_accuracy double precision,
    out_recorded_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_school_id uuid;
    v_trip_school_id uuid;
BEGIN
    IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Access Denied: Only managers may access historical location traces' USING ERRCODE = '42501';
    END IF;

    IF p_trip_id IS NULL THEN
        RAISE EXCEPTION 'Invalid Input: trip_id cannot be null' USING ERRCODE = '22023';
    END IF;

    v_user_school_id := (SELECT app_security.current_user_school_id());
    SELECT school_id INTO v_trip_school_id FROM public.trips WHERE id = p_trip_id;

    IF v_trip_school_id IS NULL OR v_trip_school_id IS DISTINCT FROM v_user_school_id THEN
        RAISE EXCEPTION 'Access Denied: Trip does not belong to your school' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_user_school_id,
        (SELECT auth.uid()),
        'SELECT_LOCATION_HISTORY',
        jsonb_build_object('trip_id', p_trip_id, 'retrieved_at', now())
    );

    RETURN QUERY
    SELECT h.id, h.bus_id, h.lat, h.lng, h.heading, h.speed, h.accuracy, h.recorded_at
    FROM public.bus_location_history h
    WHERE h.trip_id = p_trip_id 
      AND h.school_id = v_user_school_id
    ORDER BY h.recorded_at ASC;
END;
$$;

-- 4c. update_school_settings (Manager audited configuration)
CREATE OR REPLACE FUNCTION update_school_settings(
    p_name text,
    p_timezone text,
    p_contact_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_school_id uuid;
BEGIN
    IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Access Denied: Only managers may update school settings' USING ERRCODE = '42501';
    END IF;

    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RAISE EXCEPTION 'Invalid Input: name cannot be empty' USING ERRCODE = '22023';
    END IF;

    v_school_id := (SELECT app_security.current_user_school_id());

    UPDATE public.schools
    SET name = p_name,
        timezone = p_timezone,
        contact_phone = p_contact_phone,
        updated_at = now()
    WHERE id = v_school_id;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_school_id,
        (SELECT auth.uid()),
        'UPDATE_SCHOOL_SETTINGS',
        jsonb_build_object('name', p_name, 'timezone', p_timezone, 'contact_phone', p_contact_phone)
    );
END;
$$;

-- 4d. get_school_health_metrics (Owner aggregated statistics only; zero PII)
CREATE OR REPLACE FUNCTION get_school_health_metrics()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner' THEN
        RAISE EXCEPTION 'Access Denied: Only system owner may access aggregated health metrics' USING ERRCODE = '42501';
    END IF;

    RETURN jsonb_build_object(
        'total_schools', (SELECT COUNT(*) FROM public.schools),
        'total_buses', (SELECT COUNT(*) FROM public.buses WHERE is_active = true),
        'total_trips_completed', (SELECT COUNT(*) FROM public.trips WHERE status = 'completed'),
        'total_trips_in_progress', (SELECT COUNT(*) FROM public.trips WHERE status = 'in_progress')
    );
END;
$$;

-- 4e. start_trip (Driver trip state transition)
CREATE OR REPLACE FUNCTION start_trip(p_trip_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_driver_id uuid;
BEGIN
    v_driver_id := (SELECT auth.uid());
    IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only drivers may start trips' USING ERRCODE = '42501';
    END IF;

    UPDATE public.trips
    SET status = 'in_progress', started_at = now()
    WHERE id = p_trip_id 
      AND driver_profile_id = v_driver_id
      AND status = 'scheduled';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip cannot be started or is not assigned to this driver' USING ERRCODE = '22000';
    END IF;
END;
$$;

-- 4f. ingest_location (Driver GPS telemetry update)
CREATE OR REPLACE FUNCTION ingest_location(
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
    v_driver_id uuid;
    v_school_id uuid;
    v_bus_id uuid;
BEGIN
    v_driver_id := (SELECT auth.uid());
    IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only drivers may ingest GPS telemetry' USING ERRCODE = '42501';
    END IF;

    IF p_lat < -90.0 OR p_lat > 90.0 OR p_lng < -180.0 OR p_lng > 180.0 OR p_accuracy < 0.0 THEN
        RAISE EXCEPTION 'Invalid coordinates or accuracy' USING ERRCODE = '22023';
    END IF;

    SELECT school_id, bus_id INTO v_school_id, v_bus_id
    FROM public.trips
    WHERE id = p_trip_id AND driver_profile_id = v_driver_id AND status = 'in_progress';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No active trip in progress for driver' USING ERRCODE = '22000';
    END IF;

    INSERT INTO public.bus_locations_latest (bus_id, school_id, trip_id, lat, lng, heading, speed, accuracy, recorded_at, updated_at)
    VALUES (v_bus_id, v_school_id, p_trip_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, p_recorded_at, now())
    ON CONFLICT (bus_id) DO UPDATE SET
        trip_id = EXCLUDED.trip_id,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        heading = EXCLUDED.heading,
        speed = EXCLUDED.speed,
        accuracy = EXCLUDED.accuracy,
        recorded_at = EXCLUDED.recorded_at,
        updated_at = now();

    INSERT INTO public.bus_location_history (school_id, trip_id, bus_id, lat, lng, heading, speed, accuracy, recorded_at)
    VALUES (v_school_id, p_trip_id, v_bus_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, p_recorded_at);
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. Role Invariant Triggers
-- ------------------------------------------------------------------------------

-- 5a. Guardian must be parent
CREATE OR REPLACE FUNCTION trg_enforce_guardian_parent_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles 
        WHERE id = NEW.profile_id AND role = 'parent' AND school_id = NEW.school_id
    ) THEN
        RAISE EXCEPTION 'Integrity Error: profile % is not a registered parent in school %', NEW.profile_id, NEW.school_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guardians_role_check ON guardians;
CREATE TRIGGER trg_guardians_role_check
    BEFORE INSERT OR UPDATE OF profile_id, school_id ON guardians
    FOR EACH ROW EXECUTE FUNCTION trg_enforce_guardian_parent_role();

-- 5b. Driver fields must have role 'driver'
CREATE OR REPLACE FUNCTION trg_enforce_driver_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.driver_profile_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.profiles 
            WHERE id = NEW.driver_profile_id AND role = 'driver' AND school_id = NEW.school_id
        ) THEN
            RAISE EXCEPTION 'Integrity Error: driver_profile_id % is not a registered driver in school %', NEW.driver_profile_id, NEW.school_id
                USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bus_assignments_driver_role_check ON bus_assignments;
CREATE TRIGGER trg_bus_assignments_driver_role_check
    BEFORE INSERT OR UPDATE OF driver_profile_id, school_id ON bus_assignments
    FOR EACH ROW EXECUTE FUNCTION trg_enforce_driver_role();

DROP TRIGGER IF EXISTS trg_trips_driver_role_check ON trips;
CREATE TRIGGER trg_trips_driver_role_check
    BEFORE INSERT OR UPDATE OF driver_profile_id, school_id ON trips
    FOR EACH ROW EXECUTE FUNCTION trg_enforce_driver_role();

-- 5c. Prevent direct role tampering on profiles
CREATE OR REPLACE FUNCTION trg_prevent_direct_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
        IF (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner' THEN
            RAISE EXCEPTION 'Permission Denied: User role cannot be modified directly' USING ERRCODE = '42501';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_role_protect ON profiles;
CREATE TRIGGER trg_profiles_role_protect
    BEFORE UPDATE OF role ON profiles
    FOR EACH ROW EXECUTE FUNCTION trg_prevent_direct_role_change();

-- ------------------------------------------------------------------------------
-- 6. Complete Privilege Hardening (Revocation & Minimal Grants)
-- ------------------------------------------------------------------------------

-- 6a. Revoke public/anon table privileges across public schema
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

-- 6b. Set default privileges so future objects are not automatically exposed
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_security REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC;

-- 6c. Revoke execution on all existing functions from PUBLIC and anon
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_security FROM PUBLIC, anon;

-- 6d. Explicit minimal grants to role 'authenticated'
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT USAGE ON SCHEMA app_security TO authenticated;

-- Minimal DML grants
GRANT SELECT ON schools TO authenticated;
GRANT SELECT, UPDATE (full_name, language_pref) ON profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON buses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bus_plates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON routes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON route_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON stops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON guardians TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON student_stops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bus_assignments TO authenticated;
GRANT SELECT ON trips TO authenticated;
GRANT SELECT ON bus_locations_latest TO authenticated;
GRANT SELECT ON bus_location_history TO authenticated;
GRANT SELECT, INSERT, DELETE ON absences TO authenticated;
GRANT SELECT, INSERT ON absence_reasons TO authenticated;
GRANT SELECT ON alert_events TO authenticated;
GRANT ALL ON push_subscriptions TO authenticated;
GRANT SELECT ON trip_summaries TO authenticated;
GRANT SELECT ON audit_log TO authenticated;

-- Audit log: strictly append-only by triggers/RPCs; authenticated has ZERO write
REVOKE INSERT, UPDATE, DELETE ON audit_log FROM authenticated, anon, PUBLIC;

-- 6e. Grant execution on authorized callable RPCs and internal security helpers
GRANT EXECUTE ON FUNCTION is_student_absent(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_trip_location_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_school_settings(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION get_school_health_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION start_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app_security TO authenticated;

-- ------------------------------------------------------------------------------
-- 7. Row Level Security Policies
-- ------------------------------------------------------------------------------

-- 1. schools (Owner sees all; others see own school only)
CREATE POLICY schools_select ON schools FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'owner'
    OR id = (SELECT app_security.current_user_school_id())
);

-- 2. profiles (Own profile, manager in own school, or owner reading manager)
CREATE POLICY profiles_select_own ON profiles FOR SELECT TO authenticated
USING (
    id = (SELECT auth.uid())
    OR (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    OR (
        (SELECT app_security.current_user_role()) = 'owner'
        AND role = 'manager'
    )
);

CREATE POLICY profiles_update_own ON profiles FOR UPDATE TO authenticated
USING (
    id = (SELECT auth.uid())
    OR (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    )
)
WITH CHECK (
    id = (SELECT auth.uid())
    OR (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    )
);

-- 3. buses (Owner DENIED; Manager all; Driver assigned; Parent child's bus)
CREATE POLICY buses_select ON buses FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (
        (SELECT app_security.current_user_role()) IN ('manager', 'driver')
        OR (
            (SELECT app_security.current_user_role()) = 'parent'
            AND EXISTS (
                SELECT 1 FROM public.trips t
                WHERE t.bus_id = buses.id
                  AND app_security.parent_has_child_on_trip(t.id)
            )
        )
    )
);

CREATE POLICY buses_manager_manage ON buses FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 4. bus_plates (Owner & Parent DENIED; Manager all; Driver assigned bus)
CREATE POLICY bus_plates_select ON bus_plates FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (
        (SELECT app_security.current_user_role()) = 'manager'
        OR (
            (SELECT app_security.current_user_role()) = 'driver'
            AND EXISTS (
                SELECT 1 FROM public.bus_assignments ba
                WHERE ba.bus_id = bus_plates.bus_id
                  AND ba.driver_profile_id = (SELECT auth.uid())
                  AND ba.is_active = true
            )
        )
    )
);

CREATE POLICY bus_plates_manager_manage ON bus_plates FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 5. routes (Owner DENIED; Manager all; Driver assigned; Parent child assigned)
CREATE POLICY routes_select ON routes FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (
        (SELECT app_security.current_user_role()) = 'manager'
        OR (
            (SELECT app_security.current_user_role()) = 'driver'
            AND EXISTS (
                SELECT 1 FROM public.bus_assignments ba
                WHERE ba.route_id = routes.id
                  AND ba.driver_profile_id = (SELECT auth.uid())
                  AND ba.is_active = true
            )
        )
        OR (
            (SELECT app_security.current_user_role()) = 'parent'
            AND EXISTS (
                SELECT 1 FROM public.stops s
                JOIN public.student_stops ss ON ss.stop_id = s.id
                JOIN public.guardians g ON g.student_id = ss.student_id
                WHERE s.route_id = routes.id
                  AND g.profile_id = (SELECT auth.uid())
            )
        )
    )
);

CREATE POLICY routes_manager_manage ON routes FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 6. route_schedules (Owner DENIED; Manager all; Driver & Parent in school)
CREATE POLICY route_schedules_select ON route_schedules FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (SELECT app_security.current_user_role()) IN ('manager', 'driver', 'parent')
);

CREATE POLICY route_schedules_manager_manage ON route_schedules FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 7. stops (Owner DENIED; Manager all; Driver & Parent in school)
CREATE POLICY stops_select ON stops FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (SELECT app_security.current_user_role()) IN ('manager', 'driver', 'parent')
);

CREATE POLICY stops_manager_manage ON stops FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 8. students (Owner DENIED; Manager all; Parent own children; Driver students on today's trip)
CREATE POLICY students_select ON students FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id())
    OR (
        (SELECT app_security.current_user_role()) = 'parent'
        AND EXISTS (
            SELECT 1 FROM public.guardians g
            WHERE g.student_id = students.id
              AND g.profile_id = (SELECT auth.uid())
        )
    )
    OR (
        (SELECT app_security.current_user_role()) = 'driver'
        AND EXISTS (
            SELECT 1 FROM public.trips t
            JOIN public.stops s ON s.route_id = t.route_id
            JOIN public.student_stops ss ON ss.stop_id = s.id AND ss.direction = t.direction
            WHERE ss.student_id = students.id
              AND t.driver_profile_id = (SELECT auth.uid())
              AND t.trip_date = CURRENT_DATE
        )
    )
);

CREATE POLICY students_manager_manage ON students FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 9. guardians (Owner & Driver DENIED; Parent own link only; Manager all)
CREATE POLICY guardians_select ON guardians FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id())
    OR (
        (SELECT app_security.current_user_role()) = 'parent'
        AND profile_id = (SELECT auth.uid())
    )
);

CREATE POLICY guardians_parent_update ON guardians FOR UPDATE TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'parent'
    AND profile_id = (SELECT auth.uid())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'parent'
    AND profile_id = (SELECT auth.uid())
);

CREATE POLICY guardians_manager_manage ON guardians FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 10. student_stops (Owner DENIED; Manager all; Parent own children; Driver stops on today's trip)
CREATE POLICY student_stops_select ON student_stops FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id())
    OR (
        (SELECT app_security.current_user_role()) = 'parent'
        AND EXISTS (
            SELECT 1 FROM public.guardians g
            WHERE g.student_id = student_stops.student_id
              AND g.profile_id = (SELECT auth.uid())
        )
    )
    OR (
        (SELECT app_security.current_user_role()) = 'driver'
        AND EXISTS (
            SELECT 1 FROM public.trips t
            JOIN public.stops s ON s.route_id = t.route_id
            WHERE s.id = student_stops.stop_id
              AND t.driver_profile_id = (SELECT auth.uid())
              AND t.trip_date = CURRENT_DATE
        )
    )
);

CREATE POLICY student_stops_manager_manage ON student_stops FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 11. bus_assignments (Owner & Parent DENIED; Driver own; Manager all)
CREATE POLICY bus_assignments_select ON bus_assignments FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (
        (SELECT app_security.current_user_role()) = 'manager'
        OR (
            (SELECT app_security.current_user_role()) = 'driver'
            AND driver_profile_id = (SELECT auth.uid())
        )
    )
);

CREATE POLICY bus_assignments_manager_manage ON bus_assignments FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 12. trips (Owner DENIED; Drivers, Managers, Parents SELECT-ONLY; writes via RPCs)
CREATE POLICY trips_select ON trips FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (
        (SELECT app_security.current_user_role()) = 'manager'
        OR (
            (SELECT app_security.current_user_role()) = 'driver'
            AND driver_profile_id = (SELECT auth.uid())
        )
        OR (
            (SELECT app_security.current_user_role()) = 'parent'
            AND app_security.parent_has_child_on_trip(trips.id)
        )
    )
);

-- 13. bus_locations_latest (Owner DENIED; Drivers, Managers, Parents SELECT-ONLY; writes via ingest_location RPC)
CREATE POLICY bus_locations_latest_select ON bus_locations_latest FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (
        (SELECT app_security.current_user_role()) = 'manager'
        OR (
            (SELECT app_security.current_user_role()) = 'driver'
            AND EXISTS (
                SELECT 1 FROM public.trips t
                WHERE t.id = bus_locations_latest.trip_id
                  AND t.driver_profile_id = (SELECT auth.uid())
            )
        )
        OR (
            (SELECT app_security.current_user_role()) = 'parent'
            AND app_security.parent_has_child_on_trip(bus_locations_latest.trip_id)
        )
    )
);

-- 14. bus_location_history (Zero direct select policies for all clients; audited RPC get_trip_location_history only)
-- No SELECT policy defined on bus_location_history.

-- 15. absences (Owner & Driver DENIED direct table access; Parents create/read/cancel; Managers read/manage)
CREATE POLICY absences_select ON absences FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id())
    OR (
        (SELECT app_security.current_user_role()) = 'parent'
        AND (
            reported_by = (SELECT auth.uid())
            OR EXISTS (
                SELECT 1 FROM public.guardians g
                WHERE g.student_id = absences.student_id
                  AND g.profile_id = (SELECT auth.uid())
            )
        )
    )
);

CREATE POLICY absences_parent_insert ON absences FOR INSERT TO authenticated
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'parent'
    AND reported_by = (SELECT auth.uid())
    AND trip_date >= (now() AT TIME ZONE (SELECT timezone FROM public.schools WHERE id = absences.school_id))::date
    AND EXISTS (
        SELECT 1 FROM public.guardians g
        WHERE g.student_id = absences.student_id
          AND g.profile_id = (SELECT auth.uid())
    )
);

CREATE POLICY absences_parent_delete ON absences FOR DELETE TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'parent'
    AND app_security.can_cancel_absence(id)
);

CREATE POLICY absences_manager_manage ON absences FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 16. absence_reasons (Owner & Driver DENIED; Managers and reporting parents only)
CREATE POLICY absence_reasons_select ON absence_reasons FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id())
    OR (
        (SELECT app_security.current_user_role()) = 'parent'
        AND EXISTS (
            SELECT 1 FROM public.absences a
            WHERE a.id = absence_reasons.absence_id
              AND a.reported_by = (SELECT auth.uid())
        )
    )
);

CREATE POLICY absence_reasons_parent_insert ON absence_reasons FOR INSERT TO authenticated
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'parent'
    AND EXISTS (
        SELECT 1 FROM public.absences a
        WHERE a.id = absence_reasons.absence_id
          AND a.reported_by = (SELECT auth.uid())
    )
);

CREATE POLICY absence_reasons_manager_manage ON absence_reasons FOR ALL TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
)
WITH CHECK (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 17. alert_events (Owner & Driver DENIED; Managers read-only; Parents read child/trip alerts)
CREATE POLICY alert_events_select ON alert_events FOR SELECT TO authenticated
USING (
    school_id = (SELECT app_security.current_user_school_id())
    AND (
        (SELECT app_security.current_user_role()) = 'manager'
        OR (
            (SELECT app_security.current_user_role()) = 'parent'
            AND (
                (student_id IS NOT NULL AND student_id IN (
                    SELECT g.student_id FROM public.guardians g WHERE g.profile_id = (SELECT auth.uid())
                ))
                OR
                (student_id IS NULL AND app_security.parent_has_child_on_trip(alert_events.trip_id))
            )
        )
    )
);

-- 18. push_subscriptions (Own profile_id only)
CREATE POLICY push_subscriptions_all ON push_subscriptions FOR ALL TO authenticated
USING (profile_id = (SELECT auth.uid()))
WITH CHECK (profile_id = (SELECT auth.uid()));

-- 19. trip_summaries (Owner, Driver, Parent DENIED; Managers SELECT-ONLY)
CREATE POLICY trip_summaries_manager_select ON trip_summaries FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- 20. audit_log (Owner, Driver, Parent DENIED; Managers SELECT-ONLY)
CREATE POLICY audit_log_select ON audit_log FOR SELECT TO authenticated
USING (
    (SELECT app_security.current_user_role()) = 'manager'
    AND school_id = (SELECT app_security.current_user_school_id())
);

-- ------------------------------------------------------------------------------
-- 8. Realtime Channel Authorization Policy
-- ------------------------------------------------------------------------------
-- Scope strictly to 'broadcast' extension and safe regex-validated 'trip:<trip_id>' topics.
-- Drivers do not subscribe; only manager of the school and parents with child on trip.
-- Zero client INSERT on realtime.messages for anyone.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages') THEN
        ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS realtime_trip_broadcast_select ON realtime.messages;
        CREATE POLICY realtime_trip_broadcast_select ON realtime.messages
        FOR SELECT TO authenticated
        USING (
            realtime.extension() = 'broadcast'
            AND realtime.topic() ~ '^trip:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            AND (
                (
                    (SELECT app_security.current_user_role()) = 'manager'
                    AND EXISTS (
                        SELECT 1 FROM public.trips t
                        WHERE t.id = (substring(realtime.topic() from 6))::uuid
                          AND t.school_id = (SELECT app_security.current_user_school_id())
                    )
                )
                OR
                (
                    (SELECT app_security.current_user_role()) = 'parent'
                    AND app_security.parent_has_child_on_trip((substring(realtime.topic() from 6))::uuid)
                )
            )
        );
    END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 9. Performance Indexes for Policy Traversal
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_guardians_profile_student ON guardians(profile_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_stops_route_lookup ON student_stops(stop_id, direction, student_id);
CREATE INDEX IF NOT EXISTS idx_alert_events_trip_student ON alert_events(trip_id, student_id);
CREATE INDEX IF NOT EXISTS idx_trips_route_dir ON trips(route_id, direction);
CREATE INDEX IF NOT EXISTS idx_trips_driver_date ON trips(driver_profile_id, trip_date, direction);
CREATE INDEX IF NOT EXISTS idx_absence_reasons_school ON absence_reasons(school_id);
CREATE INDEX IF NOT EXISTS idx_bus_plates_school ON bus_plates(school_id);

COMMIT;
