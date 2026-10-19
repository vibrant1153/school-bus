-- ==============================================================================
-- SchoolBus Connect - Phase 2, Step 3: RLS Policies, App Security & Privilege Hardening
-- Migration: 20261019000001_rls_policies_and_security.sql
-- Forward-only migration, strictly wrapped in BEGIN / COMMIT.
-- Never edits applied migrations (20261017000001, 20261018000001).
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- SECTION 1: Sensitive Column Relocation (Fix 2)
-- Relocate absences.reason -> absence_reasons & buses.plate_number -> bus_plates
-- Explicitly handle constraints before dropping columns (NO CASCADE).
-- ==============================================================================

-- 1. Create absence_reasons table
CREATE TABLE IF NOT EXISTS public.absence_reasons (
    absence_id uuid PRIMARY KEY REFERENCES public.absences(id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure composite uniqueness on absences for foreign key integrity
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_absences_school_id'
    ) THEN
        ALTER TABLE public.absences ADD CONSTRAINT uq_absences_school_id UNIQUE (school_id, id);
    END IF;
END $$;

ALTER TABLE public.absence_reasons 
    DROP CONSTRAINT IF EXISTS fk_absence_reasons_absence,
    ADD CONSTRAINT fk_absence_reasons_absence 
    FOREIGN KEY (school_id, absence_id) 
    REFERENCES public.absences(school_id, id) ON DELETE CASCADE;

-- 2. Create bus_plates table
CREATE TABLE IF NOT EXISTS public.bus_plates (
    bus_id uuid PRIMARY KEY REFERENCES public.buses(id) ON DELETE CASCADE,
    school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
    plate_number text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_bus_plates_school_plate UNIQUE (school_id, plate_number)
);

ALTER TABLE public.bus_plates 
    DROP CONSTRAINT IF EXISTS fk_bus_plates_bus,
    ADD CONSTRAINT fk_bus_plates_bus 
    FOREIGN KEY (school_id, bus_id) 
    REFERENCES public.buses(school_id, id) ON DELETE CASCADE;

DROP TRIGGER IF EXISTS trg_bus_plates_updated_at ON public.bus_plates;
CREATE TRIGGER trg_bus_plates_updated_at
    BEFORE UPDATE ON public.bus_plates
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Data Migration: Copy existing records BEFORE dropping columns
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'absences' AND column_name = 'reason'
    ) THEN
        INSERT INTO public.absence_reasons (absence_id, school_id, reason, created_at)
        SELECT id, school_id, reason, created_at
        FROM public.absences
        WHERE reason IS NOT NULL AND length(trim(reason)) > 0
        ON CONFLICT (absence_id) DO NOTHING;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'buses' AND column_name = 'plate_number'
    ) THEN
        INSERT INTO public.bus_plates (bus_id, school_id, plate_number, created_at, updated_at)
        SELECT id, school_id, plate_number, created_at, updated_at
        FROM public.buses
        WHERE plate_number IS NOT NULL AND length(trim(plate_number)) > 0
        ON CONFLICT (bus_id) DO NOTHING;
    END IF;
END $$;

-- 4. Explicitly drop constraints and columns without CASCADE
ALTER TABLE public.buses DROP CONSTRAINT IF EXISTS uq_buses_school_plate;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'absences' AND column_name = 'reason'
    ) THEN
        ALTER TABLE public.absences DROP COLUMN reason;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'buses' AND column_name = 'plate_number'
    ) THEN
        ALTER TABLE public.buses DROP COLUMN plate_number;
    END IF;
END $$;

-- ==============================================================================
-- SECTION 2: Security Schema & Trusted Helper Functions
-- ==============================================================================

CREATE SCHEMA IF NOT EXISTS app_security;
REVOKE ALL ON SCHEMA app_security FROM PUBLIC, anon;
GRANT USAGE ON SCHEMA app_security TO authenticated;

-- Helper 0: Safe UUID parse helper (avoids cast errors on malformed topics)
CREATE OR REPLACE FUNCTION app_security.safe_uuid(p_val text)
RETURNS uuid
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE 
        WHEN p_val ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' 
        THEN p_val::uuid 
        ELSE NULL 
    END;
$$;

-- Helper 1: Current authenticated user role from profiles (never from JWT metadata)
CREATE OR REPLACE FUNCTION app_security.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

-- Helper 2: Current authenticated user school_id
CREATE OR REPLACE FUNCTION app_security.current_user_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT school_id FROM public.profiles WHERE id = (SELECT auth.uid());
$$;

-- Helper 3: School local date helper (replaces CURRENT_DATE for school-aware operations)
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
    SELECT timezone INTO v_tz FROM public.schools WHERE id = p_school_id;
    IF v_tz IS NULL THEN
        RETURN CURRENT_DATE;
    END IF;
    RETURN (now() AT TIME ZONE v_tz)::date;
END;
$$;

-- Helper 4: Check if driver is assigned to route of trip
CREATE OR REPLACE FUNCTION app_security.driver_is_assigned_to_trip(p_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.trips t
        JOIN public.bus_assignments ba ON ba.route_id = t.route_id AND ba.is_active = true
        WHERE t.id = p_trip_id
          AND (t.driver_profile_id = (SELECT auth.uid()) OR ba.driver_profile_id = (SELECT auth.uid()))
    );
$$;

-- Helper 5: Check if parent has child on trip (reads auth.uid() internally; uses REAL schema)
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

-- Helper 6: Break RLS recursion between stops and student_stops
CREATE OR REPLACE FUNCTION app_security.driver_can_access_stop(p_route_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.bus_assignments ba 
        WHERE ba.route_id = p_route_id 
          AND ba.driver_profile_id = (SELECT auth.uid()) 
          AND ba.is_active = true
    );
$$;

CREATE OR REPLACE FUNCTION app_security.parent_can_access_stop(p_stop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.student_stops ss
        JOIN public.guardians g ON g.student_id = ss.student_id
        WHERE ss.stop_id = p_stop_id 
          AND g.profile_id = (SELECT auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION app_security.driver_can_access_student_stop(p_stop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.stops s
        JOIN public.bus_assignments ba ON ba.route_id = s.route_id AND ba.is_active = true
        WHERE s.id = p_stop_id 
          AND ba.driver_profile_id = (SELECT auth.uid())
    );
$$;

-- Helper 7: Absence cancellation validation (direction 'morning', 'afternoon', 'both'; school-local date)
CREATE OR REPLACE FUNCTION app_security.can_cancel_absence(p_absence_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_rec record;
    v_user_role text;
    v_user_id uuid := (SELECT auth.uid());
    v_school_today date;
BEGIN
    SELECT a.* INTO v_rec FROM public.absences a WHERE a.id = p_absence_id;
    IF NOT FOUND THEN
        RETURN false;
    END IF;

    SELECT role INTO v_user_role FROM public.profiles WHERE id = v_user_id;

    -- Managers can cancel within their school
    IF v_user_role = 'manager' THEN
        RETURN (SELECT school_id FROM public.profiles WHERE id = v_user_id) = v_rec.school_id;
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
                  AND t.status IN ('in_progress', 'completed')
            );
        END IF;
    END IF;

    RETURN false;
END;
$$;

-- Supporting Indexes for RLS Helpers
CREATE INDEX IF NOT EXISTS idx_guardians_profile_student ON public.guardians(profile_id, student_id);
CREATE INDEX IF NOT EXISTS idx_student_stops_student_dir ON public.student_stops(student_id, direction);
CREATE INDEX IF NOT EXISTS idx_stops_route_id ON public.stops(route_id);
CREATE INDEX IF NOT EXISTS idx_trips_route_date_status ON public.trips(route_id, trip_date, status);
CREATE INDEX IF NOT EXISTS idx_bus_assignments_driver_route ON public.bus_assignments(driver_profile_id, route_id) WHERE is_active = true;

-- ==============================================================================
-- SECTION 3: Immutability & Role Integrity Invariant Triggers (Fix 2 & Fix 3)
-- ==============================================================================

-- 3a. Immutability on profiles (blocks direct client changes to role, school_id, id, phone)
CREATE OR REPLACE FUNCTION app_security.trg_profiles_immutable_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_immutable ON public.profiles;
CREATE TRIGGER trg_profiles_immutable
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_profiles_immutable_fields();

-- 3b. Immutability on guardians (blocks re-pointing student_id, profile_id, school_id)
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
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guardians_immutable ON public.guardians;
CREATE TRIGGER trg_guardians_immutable
    BEFORE UPDATE ON public.guardians
    FOR EACH ROW EXECUTE FUNCTION app_security.trg_guardians_immutable_fields();

-- 3c. Role Invariant Trigger: enforce role checks on foreign keys
CREATE OR REPLACE FUNCTION app_security.enforce_role_invariants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role text;
BEGIN
    IF TG_TABLE_NAME = 'guardians' THEN
        SELECT role INTO v_role FROM public.profiles WHERE id = NEW.profile_id;
        IF v_role IS DISTINCT FROM 'parent' THEN
            RAISE EXCEPTION 'Role Integrity Violation: Guardian profile must have role parent (got %)', v_role USING ERRCODE = '23514';
        END IF;
    ELSIF TG_TABLE_NAME = 'bus_assignments' THEN
        IF NEW.driver_profile_id IS NOT NULL THEN
            SELECT role INTO v_role FROM public.profiles WHERE id = NEW.driver_profile_id;
            IF v_role IS DISTINCT FROM 'driver' THEN
                RAISE EXCEPTION 'Role Integrity Violation: Bus assignment driver must have role driver (got %)', v_role USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'absences' THEN
        IF NEW.reported_by IS NOT NULL THEN
            SELECT role INTO v_role FROM public.profiles WHERE id = NEW.reported_by;
            IF v_role NOT IN ('parent', 'manager') THEN
                RAISE EXCEPTION 'Role Integrity Violation: Absence reporter must have role parent or manager (got %)', v_role USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF TG_TABLE_NAME = 'trips' THEN
        IF NEW.driver_profile_id IS NOT NULL THEN
            SELECT role INTO v_role FROM public.profiles WHERE id = NEW.driver_profile_id;
            IF v_role IS DISTINCT FROM 'driver' THEN
                RAISE EXCEPTION 'Role Integrity Violation: Trip driver must have role driver (got %)', v_role USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guardians_role_check ON public.guardians;
CREATE TRIGGER trg_guardians_role_check
    BEFORE INSERT OR UPDATE ON public.guardians
    FOR EACH ROW EXECUTE FUNCTION app_security.enforce_role_invariants();

DROP TRIGGER IF EXISTS trg_bus_assignments_role_check ON public.bus_assignments;
CREATE TRIGGER trg_bus_assignments_role_check
    BEFORE INSERT OR UPDATE ON public.bus_assignments
    FOR EACH ROW EXECUTE FUNCTION app_security.enforce_role_invariants();

DROP TRIGGER IF EXISTS trg_absences_role_check ON public.absences;
CREATE TRIGGER trg_absences_role_check
    BEFORE INSERT OR UPDATE ON public.absences
    FOR EACH ROW EXECUTE FUNCTION app_security.enforce_role_invariants();

DROP TRIGGER IF EXISTS trg_trips_role_check ON public.trips;
CREATE TRIGGER trg_trips_role_check
    BEFORE INSERT OR UPDATE ON public.trips
    FOR EACH ROW EXECUTE FUNCTION app_security.enforce_role_invariants();

-- 3d. Manager Writes: school_id enforcement trigger (never trust client school_id)
CREATE OR REPLACE FUNCTION app_security.trg_enforce_school_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF (SELECT app_security.current_user_role()) = 'manager' THEN
        NEW.school_id := (SELECT app_security.current_user_school_id());
    END IF;
    RETURN NEW;
END;
$$;

DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN VALUES 
        ('buses'), ('bus_plates'), ('routes'), ('route_schedules'), 
        ('stops'), ('students'), ('guardians'), ('student_stops'), 
        ('bus_assignments'), ('absences'), ('absence_reasons')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_enforce_school_id ON public.%I', tbl, tbl);
        EXECUTE format('CREATE TRIGGER trg_%I_enforce_school_id BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_security.trg_enforce_school_id()', tbl, tbl);
    END LOOP;
END $$;

-- 3e. Manager Mutations Audit Trigger (SECURITY DEFINER writes to audit_log)
CREATE OR REPLACE FUNCTION app_security.trg_audit_manager_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id uuid := (SELECT auth.uid());
    v_role text := (SELECT app_security.current_user_role());
    v_school_id uuid;
    v_action text;
    v_details jsonb;
BEGIN
    IF v_user_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'INSERT' THEN
        v_school_id := NEW.school_id;
        v_action := 'INSERT_' || upper(TG_TABLE_NAME);
        v_details := jsonb_build_object('row', to_jsonb(NEW));
    ELSIF TG_OP = 'UPDATE' THEN
        v_school_id := NEW.school_id;
        v_action := 'UPDATE_' || upper(TG_TABLE_NAME);
        v_details := jsonb_build_object('old', to_jsonb(OLD), 'new', to_jsonb(NEW));
    ELSIF TG_OP = 'DELETE' THEN
        v_school_id := OLD.school_id;
        v_action := 'DELETE_' || upper(TG_TABLE_NAME);
        v_details := jsonb_build_object('old', to_jsonb(OLD));
    END IF;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (v_school_id, v_user_id, v_action, v_details);

    RETURN COALESCE(NEW, OLD);
END;
$$;

DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN VALUES 
        ('buses'), ('bus_plates'), ('routes'), ('route_schedules'), 
        ('stops'), ('students'), ('guardians'), ('student_stops'), 
        ('bus_assignments'), ('absences'), ('absence_reasons')
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_%I_audit_mutation ON public.%I', tbl, tbl);
        EXECUTE format('CREATE TRIGGER trg_%I_audit_mutation AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION app_security.trg_audit_manager_mutations()', tbl, tbl);
    END LOOP;
END $$;

-- ==============================================================================
-- SECTION 4: Application Server Functions & RPCs (Built in Step 3)
-- ==============================================================================

-- 4a. get_trip_location_history (Manager audited retrieval; uses real columns)
CREATE OR REPLACE FUNCTION public.get_trip_location_history(p_trip_id uuid)
RETURNS TABLE (
    out_id uuid,
    out_school_id uuid,
    out_trip_id uuid,
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
    v_user_role text := (SELECT app_security.current_user_role());
    v_user_school_id uuid := (SELECT app_security.current_user_school_id());
    v_trip_school_id uuid;
BEGIN
    IF v_user_role IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Access Denied: Only school managers may retrieve location history' USING ERRCODE = '42501';
    END IF;

    SELECT t.school_id INTO v_trip_school_id FROM public.trips t WHERE t.id = p_trip_id;
    IF NOT FOUND OR v_trip_school_id IS DISTINCT FROM v_user_school_id THEN
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
    SELECT 
        h.id,
        h.school_id,
        h.trip_id,
        h.bus_id,
        h.lat,
        h.lng,
        h.heading,
        h.speed,
        h.accuracy,
        h.recorded_at
    FROM public.bus_location_history h
    WHERE h.trip_id = p_trip_id
    ORDER BY h.recorded_at ASC;
END;
$$;

-- 4b. is_student_absent (Drivers: current assigned trip carrying student; Managers: own school)
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
    v_driver_authorized boolean;
BEGIN
    IF (v_user_role IS DISTINCT FROM 'manager' AND v_user_role IS DISTINCT FROM 'driver') THEN
        RAISE EXCEPTION 'Access Denied: Only managers and drivers may query student absence status' USING ERRCODE = '42501';
    END IF;

    SELECT s.school_id INTO v_student_school_id FROM public.students s WHERE s.id = p_student_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Student not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_student_school_id IS DISTINCT FROM v_user_school_id THEN
        RAISE EXCEPTION 'Access Denied: Student belongs to another school' USING ERRCODE = '42501';
    END IF;

    IF v_user_role = 'driver' THEN
        SELECT EXISTS (
            SELECT 1 
            FROM public.trips t
            JOIN public.stops s ON s.route_id = t.route_id
            JOIN public.student_stops ss ON ss.stop_id = s.id
            JOIN public.bus_assignments ba ON ba.route_id = t.route_id AND ba.is_active = true
            WHERE ss.student_id = p_student_id
              AND t.trip_date = p_trip_date
              AND (t.driver_profile_id = v_user_id OR ba.driver_profile_id = v_user_id)
              AND (
                  p_direction = 'both'
                  OR (t.direction = p_direction AND ss.direction = p_direction)
              )
        ) INTO v_driver_authorized;

        IF NOT v_driver_authorized THEN
            RAISE EXCEPTION 'Access Denied: Student is not assigned to your active bus route' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN EXISTS (
        SELECT 1 
        FROM public.absences a
        WHERE a.student_id = p_student_id
          AND a.trip_date = p_trip_date
          AND (a.direction = p_direction OR a.direction = 'both' OR p_direction = 'both')
    );
END;
$$;

-- 4c. update_school_settings (Timezone validation against pg_timezone_names & audit_log write)
CREATE OR REPLACE FUNCTION public.update_school_settings(
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
    v_user_role text := (SELECT app_security.current_user_role());
    v_user_school_id uuid := (SELECT app_security.current_user_school_id());
BEGIN
    IF v_user_role IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Access Denied: Only managers may update school settings' USING ERRCODE = '42501';
    END IF;

    IF length(trim(p_name)) < 2 THEN
        RAISE EXCEPTION 'Validation Error: School name must be at least 2 characters' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
        RAISE EXCEPTION 'Invalid Input: Timezone % does not exist in pg_timezone_names', p_timezone USING ERRCODE = '22023';
    END IF;

    IF p_contact_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
        RAISE EXCEPTION 'Validation Error: Invalid contact phone number format (E.164 required)' USING ERRCODE = '22023';
    END IF;

    UPDATE public.schools
    SET name = trim(p_name),
        timezone = p_timezone,
        contact_phone = trim(p_contact_phone),
        updated_at = now()
    WHERE id = v_user_school_id;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_user_school_id,
        (SELECT auth.uid()),
        'UPDATE_SCHOOL_SETTINGS',
        jsonb_build_object('name', p_name, 'timezone', p_timezone, 'contact_phone', p_contact_phone)
    );
END;
$$;

-- 4d. get_school_health_metrics (Owner: all schools; Manager: own school; uses school_today)
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
    IF (v_user_role IS DISTINCT FROM 'owner' AND v_user_role IS DISTINCT FROM 'manager') THEN
        RAISE EXCEPTION 'Access Denied: Only platform owner and school managers can access health metrics' USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT 
        s.id AS school_id,
        s.name AS school_name,
        count(DISTINCT b.id) AS total_buses,
        count(DISTINCT r.id) AS total_routes,
        count(DISTINCT st.id) AS total_students,
        count(DISTINCT t.id) FILTER (WHERE t.trip_date = app_security.school_today(s.id) AND t.status = 'in_progress') AS active_trips_today
    FROM public.schools s
    LEFT JOIN public.buses b ON b.school_id = s.id AND b.is_active = true
    LEFT JOIN public.routes r ON r.school_id = s.id AND r.is_active = true
    LEFT JOIN public.students st ON st.school_id = s.id AND st.is_active = true
    LEFT JOIN public.trips t ON t.school_id = s.id
    WHERE (v_user_role = 'owner') OR (v_user_role = 'manager' AND s.id = v_user_school_id)
    GROUP BY s.id, s.name;
END;
$$;

-- 4e. start_trip (Driver assigned trip transition)
CREATE OR REPLACE FUNCTION public.start_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role text := (SELECT app_security.current_user_role());
    v_user_id uuid := (SELECT auth.uid());
    v_trip record;
BEGIN
    IF v_user_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only assigned drivers may start a trip' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    IF NOT (SELECT app_security.driver_is_assigned_to_trip(p_trip_id)) THEN
        RAISE EXCEPTION 'Access Denied: You are not assigned to this trip' USING ERRCODE = '42501';
    END IF;

    IF v_trip.status IS DISTINCT FROM 'scheduled' THEN
        RAISE EXCEPTION 'Trip state error: Cannot start trip with status %', v_trip.status USING ERRCODE = '22000';
    END IF;

    UPDATE public.trips
    SET status = 'in_progress',
        started_at = now(),
        driver_profile_id = v_user_id,
        updated_at = now()
    WHERE id = p_trip_id;

    RETURN jsonb_build_object('success', true, 'status', 'in_progress');
END;
$$;

-- 4f. purge_location_history (Manager purge of finished trips before start of today; no 30-day floor)
CREATE OR REPLACE FUNCTION public.purge_location_history()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role text := (SELECT app_security.current_user_role());
    v_school_id uuid := (SELECT app_security.current_user_school_id());
    v_today_start timestamptz;
    v_deleted integer;
BEGIN
    IF v_role IS DISTINCT FROM 'manager' THEN
        RAISE EXCEPTION 'Access Denied: Only school managers may purge location history' USING ERRCODE = '42501';
    END IF;

    SELECT ((now() AT TIME ZONE s.timezone)::date::text || ' 00:00:00')::timestamp AT TIME ZONE s.timezone
    INTO v_today_start
    FROM public.schools s WHERE s.id = v_school_id;

    WITH deleted AS (
        DELETE FROM public.bus_location_history blh
        USING public.trips t
        WHERE blh.trip_id = t.id
          AND blh.school_id = v_school_id
          AND t.status = 'completed'
          AND t.ended_at < v_today_start
        RETURNING blh.id
    )
    SELECT count(*) INTO v_deleted FROM deleted;

    INSERT INTO public.audit_log (school_id, performed_by, action, details_json)
    VALUES (
        v_school_id,
        (SELECT auth.uid()),
        'PURGE_LOCATION_HISTORY',
        jsonb_build_object('deleted_points', v_deleted, 'before_timestamp', v_today_start)
    );

    RETURN v_deleted;
END;
$$;

-- 4g. create_alert_event (Server function aligned with alert_events check constraint)
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

-- 4h. ingest_location (Driver GPS telemetry with physical plausibility checks)
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
BEGIN
    IF v_role IS DISTINCT FROM 'driver' THEN
        RAISE EXCEPTION 'Access Denied: Only drivers may ingest GPS telemetry' USING ERRCODE = '42501';
    END IF;

    IF p_lat < -90.0 OR p_lat > 90.0 OR p_lng < -180.0 OR p_lng > 180.0 THEN
        RAISE EXCEPTION 'Invalid Input: Coordinates out of bounds' USING ERRCODE = '22023';
    END IF;

    IF p_accuracy < 0.0 OR p_accuracy > 500.0 THEN
        RAISE EXCEPTION 'Invalid Input: Accuracy out of plausible range' USING ERRCODE = '22023';
    END IF;

    IF p_heading IS NOT NULL AND (p_heading < 0.0 OR p_heading > 360.0) THEN
        RAISE EXCEPTION 'Invalid Input: Heading must be between 0 and 360' USING ERRCODE = '22023';
    END IF;

    IF p_speed IS NOT NULL AND (p_speed < 0.0 OR p_speed > 160.0) THEN
        RAISE EXCEPTION 'Invalid Input: Speed out of plausible range' USING ERRCODE = '22023';
    END IF;

    IF p_recorded_at < (now() - interval '24 hours') OR p_recorded_at > (now() + interval '5 minutes') THEN
        RAISE EXCEPTION 'Invalid Input: Timestamp outside freshness window' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_trip FROM public.trips WHERE id = p_trip_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trip not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_trip.driver_profile_id IS DISTINCT FROM v_driver_id THEN
        RAISE EXCEPTION 'Access Denied: You are not assigned to this trip' USING ERRCODE = '42501';
    END IF;

    IF v_trip.status IS DISTINCT FROM 'in_progress' THEN
        RAISE EXCEPTION 'Trip state error: Trip is not in progress' USING ERRCODE = '22000';
    END IF;

    INSERT INTO public.bus_locations_latest (
        bus_id, school_id, trip_id, lat, lng, heading, speed, accuracy, recorded_at, updated_at
    )
    VALUES (
        v_trip.bus_id, v_trip.school_id, p_trip_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, p_recorded_at, now()
    )
    ON CONFLICT (bus_id) DO UPDATE SET
        trip_id = EXCLUDED.trip_id,
        lat = EXCLUDED.lat,
        lng = EXCLUDED.lng,
        heading = EXCLUDED.heading,
        speed = EXCLUDED.speed,
        accuracy = EXCLUDED.accuracy,
        recorded_at = EXCLUDED.recorded_at,
        updated_at = now();

    INSERT INTO public.bus_location_history (
        school_id, trip_id, bus_id, lat, lng, heading, speed, accuracy, recorded_at
    )
    VALUES (
        v_trip.school_id, p_trip_id, v_trip.bus_id, p_lat, p_lng, p_heading, p_speed, p_accuracy, p_recorded_at
    );
END;
$$;

-- ==============================================================================
-- SECTION 5: Privilege Hardening (Fix 1)
-- Revoke all from anon, authenticated, PUBLIC; alter defaults; minimal explicit grants.
-- ==============================================================================

-- 5a. Revoke ALL table, sequence, and function privileges from anon, authenticated, and PUBLIC
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

REVOKE ALL ON ALL TABLES IN SCHEMA app_security FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app_security FROM anon, authenticated, PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_security FROM anon, authenticated, PUBLIC;

-- 5b. Strict Default Privileges: Prevent automatic grants on new objects
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC;

DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
        BEGIN
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated, PUBLIC';
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated, PUBLIC';
            EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC';
        EXCEPTION WHEN insufficient_privilege THEN
            NULL; -- In hosted Supabase, 'postgres' role lacks privilege to alter default privileges for internal 'supabase_admin' role
        END;
    END IF;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA app_security REVOKE ALL ON FUNCTIONS FROM anon, authenticated, PUBLIC;

-- 5c. Grant schema usage
GRANT USAGE ON SCHEMA public TO authenticated, anon;
GRANT USAGE ON SCHEMA app_security TO authenticated;

-- 5d. Minimal Explicit Table Grants to authenticated
GRANT SELECT ON public.schools TO authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- Managed tables: SELECT, INSERT, UPDATE, DELETE granted to authenticated (RLS restricts to manager)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.buses TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bus_plates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.routes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.route_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.students TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guardians TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.student_stops TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.bus_assignments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.absences TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.absence_reasons TO authenticated;

-- Operational tables with server-function-only or restricted writes
GRANT SELECT ON public.trips TO authenticated;
GRANT SELECT ON public.bus_locations_latest TO authenticated;
GRANT SELECT ON public.bus_location_history TO authenticated;
GRANT SELECT ON public.alert_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT ON public.trip_summaries TO authenticated;
GRANT SELECT ON public.audit_log TO authenticated;

-- 5e. Minimal Function Grants to authenticated
GRANT EXECUTE ON FUNCTION public.get_trip_location_history(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_student_absent(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_school_settings(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_school_health_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.purge_location_history() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_location(uuid, double precision, double precision, double precision, double precision, double precision, timestamptz) TO authenticated;

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

-- ==============================================================================
-- SECTION 6: Enable Row Level Security (All Public Tables)
-- ==============================================================================

DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN VALUES 
        ('schools'), ('profiles'), ('buses'), ('bus_plates'), ('routes'), 
        ('route_schedules'), ('stops'), ('students'), ('guardians'), 
        ('student_stops'), ('bus_assignments'), ('trips'), ('bus_locations_latest'), 
        ('bus_location_history'), ('absences'), ('absence_reasons'), ('alert_events'), 
        ('push_subscriptions'), ('trip_summaries'), ('audit_log')
    LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    END LOOP;
END $$;

-- ==============================================================================
-- SECTION 7: RLS Policy Definitions
-- ==============================================================================

-- 1. schools
DROP POLICY IF EXISTS schools_select_policy ON public.schools;
CREATE POLICY schools_select_policy ON public.schools
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'owner'
        OR id = (SELECT app_security.current_user_school_id())
    );

-- 2. profiles (Parents see self only; drivers see self only; managers see own school; owner sees managers)
DROP POLICY IF EXISTS profiles_select_policy ON public.profiles;
CREATE POLICY profiles_select_policy ON public.profiles
    FOR SELECT TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
        OR ((SELECT app_security.current_user_role()) = 'owner' AND role = 'manager')
    );

DROP POLICY IF EXISTS profiles_update_policy ON public.profiles;
CREATE POLICY profiles_update_policy ON public.profiles
    FOR UPDATE TO authenticated
    USING (
        id = (SELECT auth.uid())
        OR ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
    )
    WITH CHECK (
        id = (SELECT auth.uid())
        OR ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
    );

-- 3. buses (Owner DENIED; Manager CRUD; Driver & Parent SELECT)
DROP POLICY IF EXISTS buses_select_policy ON public.buses;
CREATE POLICY buses_select_policy ON public.buses
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND id IN (
                SELECT ba.bus_id FROM public.bus_assignments ba 
                WHERE ba.driver_profile_id = (SELECT auth.uid()) AND ba.is_active = true
            ))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND id IN (
                SELECT t.bus_id FROM public.trips t 
                WHERE (SELECT app_security.parent_has_child_on_trip(t.id))
            ))
        )
    );

DROP POLICY IF EXISTS buses_insert_policy ON public.buses;
CREATE POLICY buses_insert_policy ON public.buses
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS buses_update_policy ON public.buses;
CREATE POLICY buses_update_policy ON public.buses
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS buses_delete_policy ON public.buses;
CREATE POLICY buses_delete_policy ON public.buses
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 4. bus_plates (Owner & Parent DENIED; Manager CRUD; Driver assigned bus)
DROP POLICY IF EXISTS bus_plates_select_policy ON public.bus_plates;
CREATE POLICY bus_plates_select_policy ON public.bus_plates
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (SELECT app_security.current_user_role()) IS DISTINCT FROM 'parent'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND bus_id IN (
                SELECT ba.bus_id FROM public.bus_assignments ba 
                WHERE ba.driver_profile_id = (SELECT auth.uid()) AND ba.is_active = true
            ))
        )
    );

DROP POLICY IF EXISTS bus_plates_insert_policy ON public.bus_plates;
CREATE POLICY bus_plates_insert_policy ON public.bus_plates
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS bus_plates_update_policy ON public.bus_plates;
CREATE POLICY bus_plates_update_policy ON public.bus_plates
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS bus_plates_delete_policy ON public.bus_plates;
CREATE POLICY bus_plates_delete_policy ON public.bus_plates
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 5. routes (Owner DENIED; Manager CRUD)
DROP POLICY IF EXISTS routes_select_policy ON public.routes;
CREATE POLICY routes_select_policy ON public.routes
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND id IN (
                SELECT ba.route_id FROM public.bus_assignments ba 
                WHERE ba.driver_profile_id = (SELECT auth.uid()) AND ba.is_active = true
            ))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND id IN (
                SELECT s.route_id FROM public.stops s
                JOIN public.student_stops ss ON ss.stop_id = s.id
                JOIN public.guardians g ON g.student_id = ss.student_id
                WHERE g.profile_id = (SELECT auth.uid())
            ))
        )
    );

DROP POLICY IF EXISTS routes_insert_policy ON public.routes;
CREATE POLICY routes_insert_policy ON public.routes
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS routes_update_policy ON public.routes;
CREATE POLICY routes_update_policy ON public.routes
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS routes_delete_policy ON public.routes;
CREATE POLICY routes_delete_policy ON public.routes
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 6. route_schedules (Owner DENIED; Manager CRUD)
DROP POLICY IF EXISTS route_schedules_select_policy ON public.route_schedules;
CREATE POLICY route_schedules_select_policy ON public.route_schedules
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND route_id IN (
                SELECT ba.route_id FROM public.bus_assignments ba 
                WHERE ba.driver_profile_id = (SELECT auth.uid()) AND ba.is_active = true
            ))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND route_id IN (
                SELECT s.route_id FROM public.stops s
                JOIN public.student_stops ss ON ss.stop_id = s.id
                JOIN public.guardians g ON g.student_id = ss.student_id
                WHERE g.profile_id = (SELECT auth.uid())
            ))
        )
    );

DROP POLICY IF EXISTS route_schedules_insert_policy ON public.route_schedules;
CREATE POLICY route_schedules_insert_policy ON public.route_schedules
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS route_schedules_update_policy ON public.route_schedules;
CREATE POLICY route_schedules_update_policy ON public.route_schedules
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS route_schedules_delete_policy ON public.route_schedules;
CREATE POLICY route_schedules_delete_policy ON public.route_schedules
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 7. stops (Owner DENIED; Manager CRUD; Safe helper access)
DROP POLICY IF EXISTS stops_select_policy ON public.stops;
CREATE POLICY stops_select_policy ON public.stops
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND (SELECT app_security.driver_can_access_stop(route_id)))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND (SELECT app_security.parent_can_access_stop(id)))
        )
    );

DROP POLICY IF EXISTS stops_insert_policy ON public.stops;
CREATE POLICY stops_insert_policy ON public.stops
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS stops_update_policy ON public.stops;
CREATE POLICY stops_update_policy ON public.stops
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS stops_delete_policy ON public.stops;
CREATE POLICY stops_delete_policy ON public.stops
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 8. students (Owner DENIED; Manager CRUD)
DROP POLICY IF EXISTS students_select_policy ON public.students;
CREATE POLICY students_select_policy ON public.students
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND id IN (
                SELECT ss.student_id FROM public.student_stops ss
                JOIN public.stops s ON s.id = ss.stop_id
                JOIN public.bus_assignments ba ON ba.route_id = s.route_id AND ba.is_active = true
                WHERE ba.driver_profile_id = (SELECT auth.uid())
            ))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND id IN (
                SELECT g.student_id FROM public.guardians g 
                WHERE g.profile_id = (SELECT auth.uid())
            ))
        )
    );

DROP POLICY IF EXISTS students_insert_policy ON public.students;
CREATE POLICY students_insert_policy ON public.students
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS students_update_policy ON public.students;
CREATE POLICY students_update_policy ON public.students
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS students_delete_policy ON public.students;
CREATE POLICY students_delete_policy ON public.students
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 9. guardians (Owner & Driver DENIED; Manager CRUD; Parent SELECT self & UPDATE alert_radius_m)
DROP POLICY IF EXISTS guardians_select_policy ON public.guardians;
CREATE POLICY guardians_select_policy ON public.guardians
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (SELECT app_security.current_user_role()) IS DISTINCT FROM 'driver'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR profile_id = (SELECT auth.uid())
        )
    );

DROP POLICY IF EXISTS guardians_insert_policy ON public.guardians;
CREATE POLICY guardians_insert_policy ON public.guardians
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS guardians_update_policy ON public.guardians;
CREATE POLICY guardians_update_policy ON public.guardians
    FOR UPDATE TO authenticated
    USING (
        ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
        OR profile_id = (SELECT auth.uid())
    )
    WITH CHECK (
        ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
        OR profile_id = (SELECT auth.uid())
    );

DROP POLICY IF EXISTS guardians_delete_policy ON public.guardians;
CREATE POLICY guardians_delete_policy ON public.guardians
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 10. student_stops (Owner DENIED; Manager CRUD; Safe helper access)
DROP POLICY IF EXISTS student_stops_select_policy ON public.student_stops;
CREATE POLICY student_stops_select_policy ON public.student_stops
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND (SELECT app_security.driver_can_access_student_stop(stop_id)))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND student_id IN (
                SELECT g.student_id FROM public.guardians g 
                WHERE g.profile_id = (SELECT auth.uid())
            ))
        )
    );

DROP POLICY IF EXISTS student_stops_insert_policy ON public.student_stops;
CREATE POLICY student_stops_insert_policy ON public.student_stops
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS student_stops_update_policy ON public.student_stops;
CREATE POLICY student_stops_update_policy ON public.student_stops
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS student_stops_delete_policy ON public.student_stops;
CREATE POLICY student_stops_delete_policy ON public.student_stops
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 11. bus_assignments (Owner & Parent DENIED; Manager CRUD; Driver SELECT)
DROP POLICY IF EXISTS bus_assignments_select_policy ON public.bus_assignments;
CREATE POLICY bus_assignments_select_policy ON public.bus_assignments
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (SELECT app_security.current_user_role()) IS DISTINCT FROM 'parent'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND driver_profile_id = (SELECT auth.uid()))
        )
    );

DROP POLICY IF EXISTS bus_assignments_insert_policy ON public.bus_assignments;
CREATE POLICY bus_assignments_insert_policy ON public.bus_assignments
    FOR INSERT TO authenticated
    WITH CHECK (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

DROP POLICY IF EXISTS bus_assignments_update_policy ON public.bus_assignments;
CREATE POLICY bus_assignments_update_policy ON public.bus_assignments
    FOR UPDATE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    )
    WITH CHECK (school_id = (SELECT app_security.current_user_school_id()));

DROP POLICY IF EXISTS bus_assignments_delete_policy ON public.bus_assignments;
CREATE POLICY bus_assignments_delete_policy ON public.bus_assignments
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 12. trips (Owner DENIED; Zero direct writes for anyone)
DROP POLICY IF EXISTS trips_select_policy ON public.trips;
CREATE POLICY trips_select_policy ON public.trips
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND (
                driver_profile_id = (SELECT auth.uid()) 
                OR (SELECT app_security.driver_is_assigned_to_trip(id))
            ))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND (SELECT app_security.parent_has_child_on_trip(id)))
        )
    );

-- 13. bus_locations_latest (Zero direct writes for anyone)
DROP POLICY IF EXISTS bus_locations_latest_select_policy ON public.bus_locations_latest;
CREATE POLICY bus_locations_latest_select_policy ON public.bus_locations_latest
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND (SELECT school_id FROM public.buses WHERE id = bus_locations_latest.bus_id) = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'driver' AND bus_id IN (
                SELECT ba.bus_id FROM public.bus_assignments ba 
                WHERE ba.driver_profile_id = (SELECT auth.uid()) AND ba.is_active = true
            ))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND bus_id IN (
                SELECT t.bus_id FROM public.trips t
                WHERE t.status = 'in_progress' AND (SELECT app_security.parent_has_child_on_trip(t.id))
            ))
        )
    );

-- 14. bus_location_history: Direct access denied to all clients (retrieval strictly via audited RPC)
DROP POLICY IF EXISTS bus_location_history_deny_direct_policy ON public.bus_location_history;
CREATE POLICY bus_location_history_deny_direct_policy ON public.bus_location_history
    FOR SELECT TO authenticated
    USING (false);

-- 15. absences (Drivers DENIED direct access; Manager CRUD; Parent report & cancel)
DROP POLICY IF EXISTS absences_select_policy ON public.absences;
CREATE POLICY absences_select_policy ON public.absences
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'driver'
        AND (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND student_id IN (
                SELECT g.student_id FROM public.guardians g 
                WHERE g.profile_id = (SELECT auth.uid())
            ))
        )
    );

DROP POLICY IF EXISTS absences_insert_policy ON public.absences;
CREATE POLICY absences_insert_policy ON public.absences
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
        OR
        (
            (SELECT app_security.current_user_role()) = 'parent'
            AND reported_by = (SELECT auth.uid())
            AND student_id IN (
                SELECT g.student_id FROM public.guardians g 
                WHERE g.profile_id = (SELECT auth.uid())
            )
            AND trip_date >= (SELECT app_security.school_today(school_id))
        )
    );

DROP POLICY IF EXISTS absences_delete_policy ON public.absences;
CREATE POLICY absences_delete_policy ON public.absences
    FOR DELETE TO authenticated
    USING (
        ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
        OR
        ((SELECT app_security.can_cancel_absence(id)))
    );

-- 16. absence_reasons (Owner & Driver DENIED; Manager CRUD; Reporting Parent SELECT & INSERT)
DROP POLICY IF EXISTS absence_reasons_select_policy ON public.absence_reasons;
CREATE POLICY absence_reasons_select_policy ON public.absence_reasons
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (SELECT app_security.current_user_role()) IS DISTINCT FROM 'driver'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND absence_id IN (
                SELECT a.id FROM public.absences a 
                WHERE a.reported_by = (SELECT auth.uid())
            ))
        )
    );

DROP POLICY IF EXISTS absence_reasons_insert_policy ON public.absence_reasons;
CREATE POLICY absence_reasons_insert_policy ON public.absence_reasons
    FOR INSERT TO authenticated
    WITH CHECK (
        ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
        OR
        (
            (SELECT app_security.current_user_role()) = 'parent'
            AND absence_id IN (
                SELECT a.id FROM public.absences a 
                WHERE a.reported_by = (SELECT auth.uid())
            )
        )
    );

DROP POLICY IF EXISTS absence_reasons_delete_policy ON public.absence_reasons;
CREATE POLICY absence_reasons_delete_policy ON public.absence_reasons
    FOR DELETE TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager' 
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 17. alert_events (Zero direct writes for anyone)
DROP POLICY IF EXISTS alert_events_select_policy ON public.alert_events;
CREATE POLICY alert_events_select_policy ON public.alert_events
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) IS DISTINCT FROM 'owner'
        AND (SELECT app_security.current_user_role()) IS DISTINCT FROM 'driver'
        AND (
            ((SELECT app_security.current_user_role()) = 'manager' AND school_id = (SELECT app_security.current_user_school_id()))
            OR ((SELECT app_security.current_user_role()) = 'parent' AND (
                (student_id IS NOT NULL AND student_id IN (
                    SELECT g.student_id FROM public.guardians g 
                    WHERE g.profile_id = (SELECT auth.uid())
                ))
                OR
                (student_id IS NULL AND trip_id IS NOT NULL AND (SELECT app_security.parent_has_child_on_trip(trip_id)))
            ))
        )
    );

-- 18. push_subscriptions
DROP POLICY IF EXISTS push_subscriptions_policy ON public.push_subscriptions;
CREATE POLICY push_subscriptions_policy ON public.push_subscriptions
    FOR ALL TO authenticated
    USING (profile_id = (SELECT auth.uid()))
    WITH CHECK (profile_id = (SELECT auth.uid()));

-- 19. trip_summaries (Manager SELECT only; Zero client writes)
DROP POLICY IF EXISTS trip_summaries_select_policy ON public.trip_summaries;
CREATE POLICY trip_summaries_select_policy ON public.trip_summaries
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- 20. audit_log (Manager SELECT only; Zero client writes)
DROP POLICY IF EXISTS audit_log_select_policy ON public.audit_log;
CREATE POLICY audit_log_select_policy ON public.audit_log
    FOR SELECT TO authenticated
    USING (
        (SELECT app_security.current_user_role()) = 'manager'
        AND school_id = (SELECT app_security.current_user_school_id())
    );

-- ==============================================================================
-- SECTION 8: Realtime Authorization Policy (Fix 5)
-- Real mechanism: uses realtime.messages table, column 'extension' = 'broadcast',
-- safe regex on realtime.topic(), manager & parent only, NO client INSERT.
-- ==============================================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_tables WHERE schemaname = 'realtime' AND tablename = 'messages'
    ) THEN
        GRANT USAGE ON SCHEMA realtime TO authenticated;
        GRANT SELECT ON realtime.messages TO authenticated;

        DROP POLICY IF EXISTS realtime_trip_broadcast_policy ON realtime.messages;

        CREATE POLICY realtime_trip_broadcast_policy ON realtime.messages
            FOR SELECT TO authenticated
            USING (
                extension = 'broadcast'
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
    END IF;
END $$;

COMMIT;
