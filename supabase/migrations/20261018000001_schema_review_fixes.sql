-- Corrections found in the schema review. Forward migration: does not edit the applied one.
-- If any existing data breaks a new rule, the whole migration rolls back and nothing changes.
BEGIN;

-- 1. Composite foreign keys: SET NULL must null only the optional column, never school_id.
ALTER TABLE bus_assignments DROP CONSTRAINT fk_bus_assignments_driver;
ALTER TABLE bus_assignments ADD CONSTRAINT fk_bus_assignments_driver
    FOREIGN KEY (school_id, driver_profile_id) REFERENCES profiles(school_id, id)
    ON DELETE SET NULL (driver_profile_id);

ALTER TABLE trips DROP CONSTRAINT fk_trips_driver;
ALTER TABLE trips ADD CONSTRAINT fk_trips_driver
    FOREIGN KEY (school_id, driver_profile_id) REFERENCES profiles(school_id, id)
    ON DELETE SET NULL (driver_profile_id);

ALTER TABLE absences DROP CONSTRAINT fk_absences_reporter;
ALTER TABLE absences ADD CONSTRAINT fk_absences_reporter
    FOREIGN KEY (school_id, reported_by) REFERENCES profiles(school_id, id)
    ON DELETE SET NULL (reported_by);

ALTER TABLE alert_events DROP CONSTRAINT fk_alert_events_stop;
ALTER TABLE alert_events ADD CONSTRAINT fk_alert_events_stop
    FOREIGN KEY (school_id, stop_id) REFERENCES stops(school_id, id)
    ON DELETE SET NULL (stop_id);

ALTER TABLE audit_log DROP CONSTRAINT fk_audit_log_actor;
ALTER TABLE audit_log ADD CONSTRAINT fk_audit_log_actor
    FOREIGN KEY (school_id, performed_by) REFERENCES profiles(school_id, id)
    ON DELETE SET NULL (performed_by);

-- 2. Dates must come from the school's local day, not the database's UTC date.
ALTER TABLE trips ALTER COLUMN trip_date DROP DEFAULT;
ALTER TABLE absences ALTER COLUMN trip_date DROP DEFAULT;
ALTER TABLE bus_assignments ALTER COLUMN effective_date DROP DEFAULT;

-- 3. Phone numbers are login names: require one international format so duplicates can't hide.
ALTER TABLE profiles ADD CONSTRAINT chk_profiles_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{7,14}$');

-- 4. Fixed search_path on the trigger function (Supabase security advisor).
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 5. Small integrity rules.
ALTER TABLE route_schedules ADD CONSTRAINT uq_route_schedules_slot UNIQUE (route_id, day_of_week, direction);
ALTER TABLE trip_summaries ADD CONSTRAINT chk_trip_summaries_times CHECK (ended_at >= started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_one_school_per_route ON stops(route_id) WHERE is_school;

-- 6. Indexes for columns that security rules and screens will filter on.
CREATE INDEX IF NOT EXISTS idx_profiles_school_role ON profiles(school_id, role);
CREATE INDEX IF NOT EXISTS idx_guardians_profile ON guardians(profile_id);
CREATE INDEX IF NOT EXISTS idx_student_stops_stop ON student_stops(stop_id);
CREATE INDEX IF NOT EXISTS idx_trips_school_date ON trips(school_id, trip_date);
CREATE INDEX IF NOT EXISTS idx_alert_events_student_time ON alert_events(student_id, created_at DESC);

COMMIT;