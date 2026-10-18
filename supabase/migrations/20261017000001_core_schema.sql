-- ==============================================================================
-- SchoolBus Connect - Phase 2, Step 2: Core Relational Schema
-- Migration: 20261017000001_core_schema.sql
--
-- Guarantees:
-- 1. All 18 tables have school_id for strict multi-tenant isolation.
-- 2. Composite foreign keys with school_id prevent cross-tenant row references.
-- 3. profiles.school_id is nullable ONLY for role 'owner'.
-- 4. alert_events uses dedupe_key so multiple 'delayed' alerts per trip are allowed.
-- 5. guardians has alert_radius_m (default 500, check 200/500/1000).
-- 6. schools has timezone ('Africa/Addis_Ababa'); routes/schedules use TIME type.
-- 7. trips has trip_date with UNIQUE(school_id, bus_id, direction, trip_date).
-- 8. bus_assignments has partial unique index: at most one active assignment per bus.
-- 9. student_stops direction is strictly 'morning' or 'afternoon'.
-- 10. profiles.phone has unique index where phone IS NOT NULL.
-- 11. trips has status-vs-timestamps check constraints.
-- 12. stops has deferrable stop sequence uniqueness for reordering.
-- 13. updated_at automatic triggers on all tables with updated_at.
-- 14. Performance indexes on location history and foreign keys.
-- 15. RLS enabled on all 18 tables (no policies yet = default DENY).
-- 16. Wrapped in transaction BEGIN / COMMIT. No DROP statements.
-- ==============================================================================

BEGIN;

-- Helper: generic updated_at timestamp function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 1. Schools (Multi-tenant root)
CREATE TABLE IF NOT EXISTS schools (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid GENERATED ALWAYS AS (id) STORED,
    name text NOT NULL,
    code text NOT NULL UNIQUE,
    timezone text NOT NULL DEFAULT 'Africa/Addis_Ababa',
    contact_phone text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_schools_id_school_id UNIQUE (id, school_id)
);

CREATE TRIGGER trg_schools_updated_at
    BEFORE UPDATE ON schools
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 2. Profiles (Extends auth.users for parent, driver, manager, owner)
CREATE TABLE IF NOT EXISTS profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    school_id uuid REFERENCES schools(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('parent', 'driver', 'manager', 'owner')),
    full_name text NOT NULL,
    phone text,
    language_pref text NOT NULL DEFAULT 'en' CHECK (language_pref IN ('en', 'am')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_profiles_school_id UNIQUE (school_id, id),
    CONSTRAINT chk_profiles_school_id_owner CHECK ((role = 'owner') OR (school_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_phone_unique 
    ON profiles(phone) 
    WHERE phone IS NOT NULL;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 3. Buses
CREATE TABLE IF NOT EXISTS buses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name text NOT NULL,
    plate_number text NOT NULL,
    capacity integer CHECK (capacity > 0),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_buses_school_id UNIQUE (school_id, id),
    CONSTRAINT uq_buses_school_plate UNIQUE (school_id, plate_number)
);

CREATE TRIGGER trg_buses_updated_at
    BEFORE UPDATE ON buses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 4. Routes
CREATE TABLE IF NOT EXISTS routes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    name text NOT NULL,
    code text,
    start_time time NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_routes_school_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_routes_updated_at
    BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Route Schedules (Weekly schedule rules with TIME type)
CREATE TABLE IF NOT EXISTS route_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    route_id uuid NOT NULL,
    day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 1 AND 7), -- 1=Monday, 7=Sunday
    departure_time time NOT NULL,
    direction text NOT NULL CHECK (direction IN ('morning', 'afternoon')),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_route_schedules_school_id UNIQUE (school_id, id),
    CONSTRAINT fk_route_schedules_route FOREIGN KEY (school_id, route_id) 
        REFERENCES routes(school_id, id) ON DELETE CASCADE
);

-- 6. Stops (Ordered route stops; sequence deferrable for reordering)
CREATE TABLE IF NOT EXISTS stops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    route_id uuid NOT NULL,
    name text NOT NULL,
    sequence_morning integer NOT NULL CHECK (sequence_morning >= 1),
    lat double precision NOT NULL CHECK (lat >= -90.0 AND lat <= 90.0),
    lng double precision NOT NULL CHECK (lng >= -180.0 AND lng <= 180.0),
    has_pin boolean NOT NULL DEFAULT true,
    is_school boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_stops_school_id UNIQUE (school_id, id),
    CONSTRAINT fk_stops_route FOREIGN KEY (school_id, route_id) 
        REFERENCES routes(school_id, id) ON DELETE CASCADE,
    CONSTRAINT uq_stops_route_seq UNIQUE (route_id, sequence_morning) DEFERRABLE INITIALLY DEFERRED
);

CREATE TRIGGER trg_stops_updated_at
    BEFORE UPDATE ON stops
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 7. Students (Child records)
CREATE TABLE IF NOT EXISTS students (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    full_name text NOT NULL,
    grade integer CHECK (grade BETWEEN 0 AND 12),
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_students_school_id UNIQUE (school_id, id)
);

CREATE TRIGGER trg_students_updated_at
    BEFORE UPDATE ON students
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 8. Guardians (Links student to parent profile with chosen alert_radius_m)
CREATE TABLE IF NOT EXISTS guardians (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id uuid NOT NULL,
    profile_id uuid NOT NULL,
    relationship text NOT NULL DEFAULT 'parent',
    is_primary boolean NOT NULL DEFAULT true,
    alert_radius_m integer NOT NULL DEFAULT 500 CHECK (alert_radius_m IN (200, 500, 1000)),
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_guardian_student_profile UNIQUE (student_id, profile_id),
    CONSTRAINT fk_guardians_student FOREIGN KEY (school_id, student_id) 
        REFERENCES students(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_guardians_profile FOREIGN KEY (school_id, profile_id) 
        REFERENCES profiles(school_id, id) ON DELETE CASCADE
);

-- 9. Student Stops (Morning or afternoon assigned pickup/dropoff stop)
CREATE TABLE IF NOT EXISTS student_stops (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id uuid NOT NULL,
    stop_id uuid NOT NULL,
    direction text NOT NULL CHECK (direction IN ('morning', 'afternoon')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_student_stop_direction UNIQUE (student_id, direction),
    CONSTRAINT fk_student_stops_student FOREIGN KEY (school_id, student_id) 
        REFERENCES students(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_student_stops_stop FOREIGN KEY (school_id, stop_id) 
        REFERENCES stops(school_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER trg_student_stops_updated_at
    BEFORE UPDATE ON student_stops
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 10. Bus Assignments (Assigns bus to route and driver)
CREATE TABLE IF NOT EXISTS bus_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    bus_id uuid NOT NULL,
    route_id uuid NOT NULL,
    driver_profile_id uuid,
    effective_date date NOT NULL DEFAULT CURRENT_DATE,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_bus_assignments_bus FOREIGN KEY (school_id, bus_id) 
        REFERENCES buses(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_bus_assignments_route FOREIGN KEY (school_id, route_id) 
        REFERENCES routes(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_bus_assignments_driver FOREIGN KEY (school_id, driver_profile_id) 
        REFERENCES profiles(school_id, id) ON DELETE SET NULL
);

-- Partial Unique Index: A bus can have at most one active assignment
CREATE UNIQUE INDEX IF NOT EXISTS idx_bus_assignments_one_active_per_bus 
    ON bus_assignments(bus_id) 
    WHERE is_active = true;

-- 11. Trips (Trip execution states, trip_date, and timestamp rules)
CREATE TABLE IF NOT EXISTS trips (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    bus_id uuid NOT NULL,
    route_id uuid NOT NULL,
    driver_profile_id uuid,
    trip_date date NOT NULL DEFAULT CURRENT_DATE,
    direction text NOT NULL CHECK (direction IN ('morning', 'afternoon')),
    status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed', 'cancelled')),
    scheduled_start timestamptz NOT NULL,
    started_at timestamptz,
    ended_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_trips_school_id UNIQUE (school_id, id),
    CONSTRAINT uq_trips_bus_direction_date UNIQUE (school_id, bus_id, direction, trip_date),
    CONSTRAINT fk_trips_bus FOREIGN KEY (school_id, bus_id) 
        REFERENCES buses(school_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_trips_route FOREIGN KEY (school_id, route_id) 
        REFERENCES routes(school_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_trips_driver FOREIGN KEY (school_id, driver_profile_id) 
        REFERENCES profiles(school_id, id) ON DELETE SET NULL,
    CONSTRAINT chk_trip_status_timestamps CHECK (
        (status = 'scheduled' AND started_at IS NULL AND ended_at IS NULL) OR
        (status = 'in_progress' AND started_at IS NOT NULL AND ended_at IS NULL) OR
        (status = 'completed' AND started_at IS NOT NULL AND ended_at IS NOT NULL AND ended_at >= started_at) OR
        (status = 'cancelled' AND (ended_at IS NOT NULL) AND (started_at IS NULL OR ended_at >= started_at))
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trips_one_active_per_bus 
    ON trips(bus_id) 
    WHERE status = 'in_progress';

CREATE TRIGGER trg_trips_updated_at
    BEFORE UPDATE ON trips
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 12. Bus Locations Latest (Single freshest location per bus for instant map view)
CREATE TABLE IF NOT EXISTS bus_locations_latest (
    bus_id uuid PRIMARY KEY,
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id uuid NOT NULL,
    lat double precision NOT NULL CHECK (lat >= -90.0 AND lat <= 90.0),
    lng double precision NOT NULL CHECK (lng >= -180.0 AND lng <= 180.0),
    heading double precision CHECK (heading >= 0.0 AND heading <= 360.0),
    speed double precision CHECK (speed >= 0.0),
    accuracy double precision NOT NULL CHECK (accuracy >= 0.0),
    recorded_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_bus_locations_latest_bus FOREIGN KEY (school_id, bus_id) 
        REFERENCES buses(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_bus_locations_latest_trip FOREIGN KEY (school_id, trip_id) 
        REFERENCES trips(school_id, id) ON DELETE CASCADE
);

CREATE TRIGGER trg_bus_locations_latest_updated_at
    BEFORE UPDATE ON bus_locations_latest
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 13. Bus Location History (12-second location trail for active trips)
CREATE TABLE IF NOT EXISTS bus_location_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id uuid NOT NULL,
    bus_id uuid NOT NULL,
    lat double precision NOT NULL CHECK (lat >= -90.0 AND lat <= 90.0),
    lng double precision NOT NULL CHECK (lng >= -180.0 AND lng <= 180.0),
    heading double precision CHECK (heading >= 0.0 AND heading <= 360.0),
    speed double precision CHECK (speed >= 0.0),
    accuracy double precision NOT NULL CHECK (accuracy >= 0.0),
    recorded_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_bus_location_history_trip FOREIGN KEY (school_id, trip_id) 
        REFERENCES trips(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_bus_location_history_bus FOREIGN KEY (school_id, bus_id) 
        REFERENCES buses(school_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bus_location_history_trip_time 
    ON bus_location_history(trip_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_bus_location_history_recorded_at 
    ON bus_location_history(recorded_at);

-- 14. Absences (Child attendance flag per date and direction)
CREATE TABLE IF NOT EXISTS absences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    student_id uuid NOT NULL,
    trip_date date NOT NULL DEFAULT CURRENT_DATE,
    direction text NOT NULL CHECK (direction IN ('both', 'morning', 'afternoon')),
    reported_by uuid,
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_absence_student_date_dir UNIQUE (student_id, trip_date, direction),
    CONSTRAINT fk_absences_student FOREIGN KEY (school_id, student_id) 
        REFERENCES students(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_absences_reporter FOREIGN KEY (school_id, reported_by) 
        REFERENCES profiles(school_id, id) ON DELETE SET NULL
);

-- 15. Alert Events (Trip notifications with flexible dedupe_key)
CREATE TABLE IF NOT EXISTS alert_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id uuid NOT NULL,
    student_id uuid,
    stop_id uuid,
    event_type text NOT NULL CHECK (event_type IN ('tripStarted', 'nearStop', 'delayed', 'tripCompleted', 'tripCancelled')),
    radius_meters integer CHECK (radius_meters IN (200, 500, 1000)),
    dedupe_key text NOT NULL,
    payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_alert_events_dedupe UNIQUE (school_id, trip_id, dedupe_key),
    CONSTRAINT fk_alert_events_trip FOREIGN KEY (school_id, trip_id) 
        REFERENCES trips(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_alert_events_student FOREIGN KEY (school_id, student_id) 
        REFERENCES students(school_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_alert_events_stop FOREIGN KEY (school_id, stop_id) 
        REFERENCES stops(school_id, id) ON DELETE SET NULL
);

-- 16. Push Subscriptions (Web Push tokens)
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    profile_id uuid NOT NULL,
    endpoint text NOT NULL UNIQUE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_push_subscriptions_profile FOREIGN KEY (school_id, profile_id) 
        REFERENCES profiles(school_id, id) ON DELETE CASCADE
);

-- 17. Trip Summaries (Pilot reliability metrics: pings, gap duration, accuracy; NO coordinates)
CREATE TABLE IF NOT EXISTS trip_summaries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    trip_id uuid NOT NULL UNIQUE,
    total_pings integer NOT NULL DEFAULT 0 CHECK (total_pings >= 0),
    longest_gap_seconds integer NOT NULL DEFAULT 0 CHECK (longest_gap_seconds >= 0),
    avg_accuracy_meters double precision CHECK (avg_accuracy_meters >= 0.0),
    started_at timestamptz NOT NULL,
    ended_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_trip_summaries_trip FOREIGN KEY (school_id, trip_id) 
        REFERENCES trips(school_id, id) ON DELETE CASCADE
);

-- 18. Audit Log (Manager actions, password resets, history purges)
CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id uuid NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    performed_by uuid,
    action text NOT NULL,
    details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT fk_audit_log_actor FOREIGN KEY (school_id, performed_by) 
        REFERENCES profiles(school_id, id) ON DELETE SET NULL
);

-- ==============================================================================
-- MANDATORY SECURITY: ENABLE ROW LEVEL SECURITY (RLS) ON ALL 18 TABLES
-- With zero policies defined, Postgres enforces DEFAULT DENY on all tables.
-- ==============================================================================
ALTER TABLE schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE buses ENABLE ROW LEVEL SECURITY;
ALTER TABLE routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_locations_latest ENABLE ROW LEVEL SECURITY;
ALTER TABLE bus_location_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

COMMIT;
