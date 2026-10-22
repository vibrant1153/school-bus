-- ==============================================================================
-- SchoolBus Connect - Idempotent Development Seed Data
-- Seed file: supabase/seed.sql (Dev project only)
--
-- Features:
-- 1. Two distinct fake schools to allow testing multi-tenant isolation.
-- 2. Non-login entities only (schools, routes, schedules, stops, buses, students, student_stops).
-- 3. profiles, guardians, bus_assignments are deferred to Step 4 when auth users are created.
-- 4. 100% synthetic data. Idempotent (safe to run repeatedly via supabase db reset or seed).
-- ==============================================================================

DO $$
DECLARE
    -- School 1 (Pilot Academy Addis)
    v_sch1_id uuid;
    v_bus1_id uuid;
    v_bus2_id uuid;
    v_rt_a_id uuid;
    v_rt_b_id uuid;
    v_st_a1 uuid;
    v_st_a2 uuid;
    v_st_a3 uuid;
    v_st_a4 uuid;
    v_st_a5 uuid;
    v_st_b1 uuid;
    v_st_b2 uuid;
    v_st_b3 uuid;
    v_st_b4 uuid;
    v_stu1 uuid; v_stu2 uuid; v_stu3 uuid; v_stu4 uuid;
    v_stu5 uuid; v_stu6 uuid; v_stu7 uuid; v_stu8 uuid;

    -- School 2 (St. George Community School)
    v_sch2_id uuid;
    v_bus3_id uuid;
    v_rt_c_id uuid;
    v_st_c1 uuid;
    v_st_c2 uuid;
    v_st_c3 uuid;
    v_stu9 uuid; v_stu10 uuid; v_stu11 uuid; v_stu12 uuid;
BEGIN
    -- ==========================================================================
    -- PRODUCTION SAFETY GUARD
    -- ==========================================================================
    -- 0. Require app_security.environment table with name = 'dev'
    DECLARE
        v_has_dev_marker boolean := false;
    BEGIN
        IF EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'app_security' AND table_name = 'environment'
        ) THEN
            EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_security.environment WHERE name = ''dev'')' INTO v_has_dev_marker;
        END IF;

        IF NOT v_has_dev_marker THEN
            RAISE EXCEPTION 'Environment Guard: Target database missing app_security.environment marker table with dev row (run scripts/mark-dev-environment.sql first).'
                USING ERRCODE = '55000';
        END IF;
    END;

    -- 1. Block if app.environment is explicitly marked as non-development
    IF current_setting('app.environment', true) IN ('production', 'prod', 'staging') THEN
        RAISE EXCEPTION 'CRITICAL: seed.sql cannot be executed in % environment!', current_setting('app.environment', true);
    END IF;

    -- 2. Block if any non-synthetic school exists in the database
    IF EXISTS (
        SELECT 1 FROM schools 
        WHERE code NOT IN ('PAA-01', 'SGC-02', 'SGCS-02')
    ) THEN
        RAISE EXCEPTION 'CRITICAL: seed.sql aborted! Database contains non-synthetic schools. Seeding is strictly forbidden on non-dev databases.';
    END IF;

    -- ==========================================================================
    -- SCHOOL 1: Pilot Academy Addis (PAA-01)
    -- ==========================================================================
    INSERT INTO schools (name, code, timezone, contact_phone)
    VALUES ('Pilot Academy Addis', 'PAA-01', 'Africa/Addis_Ababa', '+251-11-000-0001')
    ON CONFLICT (code) DO UPDATE 
        SET name = EXCLUDED.name, timezone = EXCLUDED.timezone, contact_phone = EXCLUDED.contact_phone
    RETURNING id INTO v_sch1_id;

    -- Buses for School 1
    SELECT id INTO v_bus1_id FROM buses WHERE school_id = v_sch1_id AND name = 'Bus 1';
    IF v_bus1_id IS NULL THEN
        INSERT INTO buses (school_id, name, capacity)
        VALUES (v_sch1_id, 'Bus 1', 30)
        RETURNING id INTO v_bus1_id;
    END IF;
    INSERT INTO bus_plates (bus_id, school_id, plate_number)
    VALUES (v_bus1_id, v_sch1_id, 'TEST-001')
    ON CONFLICT (school_id, plate_number) DO NOTHING;

    SELECT id INTO v_bus2_id FROM buses WHERE school_id = v_sch1_id AND name = 'Bus 2';
    IF v_bus2_id IS NULL THEN
        INSERT INTO buses (school_id, name, capacity)
        VALUES (v_sch1_id, 'Bus 2', 30)
        RETURNING id INTO v_bus2_id;
    END IF;
    INSERT INTO bus_plates (bus_id, school_id, plate_number)
    VALUES (v_bus2_id, v_sch1_id, 'TEST-002')
    ON CONFLICT (school_id, plate_number) DO NOTHING;

    -- Routes for School 1
    SELECT id INTO v_rt_a_id FROM routes WHERE school_id = v_sch1_id AND code = 'RT-A';
    IF v_rt_a_id IS NULL THEN
        INSERT INTO routes (school_id, name, code, start_time)
        VALUES (v_sch1_id, 'Route A', 'RT-A', '06:45:00'::time)
        RETURNING id INTO v_rt_a_id;
    END IF;

    SELECT id INTO v_rt_b_id FROM routes WHERE school_id = v_sch1_id AND code = 'RT-B';
    IF v_rt_b_id IS NULL THEN
        INSERT INTO routes (school_id, name, code, start_time)
        VALUES (v_sch1_id, 'Route B', 'RT-B', '06:50:00'::time)
        RETURNING id INTO v_rt_b_id;
    END IF;

    -- Schedules for School 1 (Mon-Fri)
    DELETE FROM route_schedules WHERE school_id = v_sch1_id;
    INSERT INTO route_schedules (school_id, route_id, day_of_week, departure_time, direction)
    SELECT v_sch1_id, v_rt_a_id, d, '06:45:00'::time, 'morning' FROM generate_series(1, 5) AS d;
    INSERT INTO route_schedules (school_id, route_id, day_of_week, departure_time, direction)
    SELECT v_sch1_id, v_rt_a_id, d, '16:00:00'::time, 'afternoon' FROM generate_series(1, 5) AS d;

    INSERT INTO route_schedules (school_id, route_id, day_of_week, departure_time, direction)
    SELECT v_sch1_id, v_rt_b_id, d, '06:50:00'::time, 'morning' FROM generate_series(1, 5) AS d;
    INSERT INTO route_schedules (school_id, route_id, day_of_week, departure_time, direction)
    SELECT v_sch1_id, v_rt_b_id, d, '16:00:00'::time, 'afternoon' FROM generate_series(1, 5) AS d;

    -- Stops for Route A
    DELETE FROM stops WHERE school_id = v_sch1_id;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_a_id, 'Green Park Gate', 1, 9.0205, 38.7500, true, false)
    RETURNING id INTO v_st_a1;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_a_id, 'Market Corner', 2, 9.0230, 38.7530, true, false)
    RETURNING id INTO v_st_a2;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_a_id, 'Church Road', 3, 9.0260, 38.7560, true, false)
    RETURNING id INTO v_st_a3;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_a_id, 'Clinic Junction', 4, 9.0290, 38.7590, false, false)
    RETURNING id INTO v_st_a4;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_a_id, 'School Gate (Campus 1)', 5, 9.0320, 38.7620, true, true)
    RETURNING id INTO v_st_a5;

    -- Stops for Route B
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_b_id, 'Bakery Lane', 1, 9.0180, 38.7450, true, false)
    RETURNING id INTO v_st_b1;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_b_id, 'Water Tower', 2, 9.0210, 38.7480, true, false)
    RETURNING id INTO v_st_b2;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_b_id, 'Sports Field', 3, 9.0250, 38.7520, true, false)
    RETURNING id INTO v_st_b3;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch1_id, v_rt_b_id, 'School Gate (Campus 1)', 4, 9.0320, 38.7620, true, true)
    RETURNING id INTO v_st_b4;

    -- Students for School 1
    DELETE FROM students WHERE school_id = v_sch1_id;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student A (sample)', 3) RETURNING id INTO v_stu1;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student B (sample)', 5) RETURNING id INTO v_stu2;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student C (sample)', 2) RETURNING id INTO v_stu3;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student D (sample)', 6) RETURNING id INTO v_stu4;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student E (sample)', 1) RETURNING id INTO v_stu5;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student F (sample)', 4) RETURNING id INTO v_stu6;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student G (sample)', 4) RETURNING id INTO v_stu7;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch1_id, 'Student H (sample)', 3) RETURNING id INTO v_stu8;

    -- Student Stops for School 1 (morning & afternoon)
    INSERT INTO student_stops (school_id, student_id, stop_id, direction) VALUES 
        (v_sch1_id, v_stu1, v_st_a4, 'morning'),
        (v_sch1_id, v_stu1, v_st_a4, 'afternoon'),
        (v_sch1_id, v_stu2, v_st_a2, 'morning'),
        (v_sch1_id, v_stu2, v_st_a2, 'afternoon'),
        (v_sch1_id, v_stu4, v_st_b1, 'morning'),
        (v_sch1_id, v_stu4, v_st_b1, 'afternoon'),
        (v_sch1_id, v_stu5, v_st_b3, 'morning'),
        (v_sch1_id, v_stu5, v_st_b3, 'afternoon'),
        (v_sch1_id, v_stu6, v_st_a1, 'morning'),
        (v_sch1_id, v_stu6, v_st_a1, 'afternoon'),
        (v_sch1_id, v_stu7, v_st_a1, 'morning'),
        (v_sch1_id, v_stu7, v_st_a1, 'afternoon');
        -- stu3 and stu8 have no assigned stop (tests manager dashboard 'Needs a stop' health warning)

    -- ==========================================================================
    -- SCHOOL 2: St. George Community School (SGC-02)
    -- Multi-tenant isolation testing partner
    -- ==========================================================================
    INSERT INTO schools (name, code, timezone, contact_phone)
    VALUES ('St. George Community School', 'SGC-02', 'Africa/Addis_Ababa', '+251-11-000-0002')
    ON CONFLICT (code) DO UPDATE 
        SET name = EXCLUDED.name, timezone = EXCLUDED.timezone, contact_phone = EXCLUDED.contact_phone
    RETURNING id INTO v_sch2_id;

    -- Bus for School 2
    SELECT id INTO v_bus3_id FROM buses WHERE school_id = v_sch2_id AND name = 'Bus 3';
    IF v_bus3_id IS NULL THEN
        INSERT INTO buses (school_id, name, capacity)
        VALUES (v_sch2_id, 'Bus 3', 25)
        RETURNING id INTO v_bus3_id;
    END IF;
    INSERT INTO bus_plates (bus_id, school_id, plate_number)
    VALUES (v_bus3_id, v_sch2_id, 'TEST-003')
    ON CONFLICT (school_id, plate_number) DO NOTHING;

    -- Route for School 2
    SELECT id INTO v_rt_c_id FROM routes WHERE school_id = v_sch2_id AND code = 'RT-C';
    IF v_rt_c_id IS NULL THEN
        INSERT INTO routes (school_id, name, code, start_time)
        VALUES (v_sch2_id, 'Route C', 'RT-C', '07:00:00'::time)
        RETURNING id INTO v_rt_c_id;
    END IF;

    -- Schedules for School 2 (Mon-Fri)
    DELETE FROM route_schedules WHERE school_id = v_sch2_id;
    INSERT INTO route_schedules (school_id, route_id, day_of_week, departure_time, direction)
    SELECT v_sch2_id, v_rt_c_id, d, '07:00:00'::time, 'morning' FROM generate_series(1, 5) AS d;
    INSERT INTO route_schedules (school_id, route_id, day_of_week, departure_time, direction)
    SELECT v_sch2_id, v_rt_c_id, d, '16:00:00'::time, 'afternoon' FROM generate_series(1, 5) AS d;

    -- Stops for Route C
    DELETE FROM stops WHERE school_id = v_sch2_id;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch2_id, v_rt_c_id, 'Hill View', 1, 9.0150, 38.7400, true, false)
    RETURNING id INTO v_st_c1;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch2_id, v_rt_c_id, 'Post Office', 2, 9.0220, 38.7510, true, false)
    RETURNING id INTO v_st_c2;
    INSERT INTO stops (school_id, route_id, name, sequence_morning, lat, lng, has_pin, is_school)
    VALUES (v_sch2_id, v_rt_c_id, 'School Gate (Campus 2)', 3, 9.0320, 38.7620, true, true)
    RETURNING id INTO v_st_c3;

    -- Students for School 2
    DELETE FROM students WHERE school_id = v_sch2_id;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch2_id, 'Student I (sample)', 5) RETURNING id INTO v_stu9;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch2_id, 'Student J (sample)', 2) RETURNING id INTO v_stu10;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch2_id, 'Student K (sample)', 6) RETURNING id INTO v_stu11;
    INSERT INTO students (school_id, full_name, grade) VALUES (v_sch2_id, 'Student L (sample)', 1) RETURNING id INTO v_stu12;

    -- Student Stops for School 2
    INSERT INTO student_stops (school_id, student_id, stop_id, direction) VALUES 
        (v_sch2_id, v_stu9, v_st_c1, 'morning'),
        (v_sch2_id, v_stu9, v_st_c1, 'afternoon'),
        (v_sch2_id, v_stu10, v_st_c2, 'morning'),
        (v_sch2_id, v_stu10, v_st_c2, 'afternoon'),
        (v_sch2_id, v_stu12, v_st_c1, 'morning'),
        (v_sch2_id, v_stu12, v_st_c1, 'afternoon');
        -- stu11 has no stop

END $$;
