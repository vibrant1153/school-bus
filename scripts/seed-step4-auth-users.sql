-- ==============================================================================
-- SchoolBus Connect - Step 4 Development Seed Data (Auth Users & Profiles)
-- Script: scripts/seed-step4-auth-users.sql
--
-- Safety Guarantees:
-- 1. Requires app_security.environment marker table with 'dev' row.
-- 2. Strictly idempotent (ON CONFLICT DO UPDATE).
-- 3. Provisions deterministic test accounts with passwords loaded from gitignored .env.
-- ==============================================================================

DO $$
DECLARE
    v_has_dev_marker boolean := false;
    v_sch1_id uuid;
    v_sch2_id uuid;
    v_bus1_id uuid;
    v_route_a_id uuid;
    v_student1_id uuid;
    v_enc_pwd text;

    -- Deterministic test user UUIDs
    c_owner_id    constant uuid := '00000000-0000-0000-0000-000000000001';
    c_manager1_id constant uuid := '00000000-0000-0000-0000-000000000002';
    c_driver1_id  constant uuid := '00000000-0000-0000-0000-000000000003';
    c_parent1_id  constant uuid := '00000000-0000-0000-0000-000000000004';
    c_manager2_id constant uuid := '00000000-0000-0000-0000-000000000007';
BEGIN
    -- 1. Production Safety Guard
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'app_security' AND table_name = 'environment'
    ) THEN
        EXECUTE 'SELECT EXISTS (SELECT 1 FROM app_security.environment WHERE name = ''dev'')' INTO v_has_dev_marker;
    END IF;

    IF NOT v_has_dev_marker THEN
        RAISE EXCEPTION 'CRITICAL: seed-step4-auth-users.sql aborted! Target database is missing app_security.environment dev marker.'
            USING ERRCODE = '55000';
    END IF;

    -- 2. Lookup school IDs from Step 2 seed
    SELECT id INTO v_sch1_id FROM public.schools WHERE code = 'PAA-01';
    SELECT id INTO v_sch2_id FROM public.schools WHERE code = 'SGC-02';

    IF v_sch1_id IS NULL OR v_sch2_id IS NULL THEN
        RAISE EXCEPTION 'CRITICAL: Expected seed schools PAA-01 and SGC-02 not found!';
    END IF;

    -- 3. Compute password hash from runtime configuration or secure random bytes
    -- Passwords are synchronized via scripts/apply-test-user-passwords.js from gitignored .env
    v_enc_pwd := extensions.crypt(COALESCE(NULLIF(current_setting('app.test_password', true), ''), encode(gen_random_bytes(16), 'hex')), extensions.gen_salt('bf'));

    -- ==========================================================================
    -- 4. Seed auth.users and auth.identities
    -- ==========================================================================

    -- 4a. Platform Owner
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
    ) VALUES (
        c_owner_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'owner@schoolbus.local', v_enc_pwd, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Platform Owner","phone":"+251911000001"}'::jsonb,
        now(), now(), ''
    ) ON CONFLICT (id) DO UPDATE SET
        encrypted_password = EXCLUDED.encrypted_password,
        raw_user_meta_data = EXCLUDED.raw_user_meta_data;

    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
    VALUES (
        gen_random_uuid(), 'owner@schoolbus.local', c_owner_id,
        jsonb_build_object('sub', c_owner_id::text, 'email', 'owner@schoolbus.local'),
        'email', now(), now()
    ) ON CONFLICT (provider, provider_id) DO NOTHING;

    -- 4b. School 1 Manager (Pilot Academy Addis)
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
    ) VALUES (
        c_manager1_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'manager1@schoolbus.local', v_enc_pwd, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Manager One","phone":"+251911000002"}'::jsonb,
        now(), now(), ''
    ) ON CONFLICT (id) DO UPDATE SET
        encrypted_password = EXCLUDED.encrypted_password,
        raw_user_meta_data = EXCLUDED.raw_user_meta_data;

    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
    VALUES (
        gen_random_uuid(), 'manager1@schoolbus.local', c_manager1_id,
        jsonb_build_object('sub', c_manager1_id::text, 'email', 'manager1@schoolbus.local'),
        'email', now(), now()
    ) ON CONFLICT (provider, provider_id) DO NOTHING;

    -- 4c. School 1 Driver
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
    ) VALUES (
        c_driver1_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'driver1@schoolbus.local', v_enc_pwd, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Driver One","phone":"+251911000003"}'::jsonb,
        now(), now(), ''
    ) ON CONFLICT (id) DO UPDATE SET
        encrypted_password = EXCLUDED.encrypted_password,
        raw_user_meta_data = EXCLUDED.raw_user_meta_data;

    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
    VALUES (
        gen_random_uuid(), 'driver1@schoolbus.local', c_driver1_id,
        jsonb_build_object('sub', c_driver1_id::text, 'email', 'driver1@schoolbus.local'),
        'email', now(), now()
    ) ON CONFLICT (provider, provider_id) DO NOTHING;

    -- 4d. School 1 Parent
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
    ) VALUES (
        c_parent1_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'parent1@schoolbus.local', v_enc_pwd, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Parent One","phone":"+251911000004"}'::jsonb,
        now(), now(), ''
    ) ON CONFLICT (id) DO UPDATE SET
        encrypted_password = EXCLUDED.encrypted_password,
        raw_user_meta_data = EXCLUDED.raw_user_meta_data;

    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
    VALUES (
        gen_random_uuid(), 'parent1@schoolbus.local', c_parent1_id,
        jsonb_build_object('sub', c_parent1_id::text, 'email', 'parent1@schoolbus.local'),
        'email', now(), now()
    ) ON CONFLICT (provider, provider_id) DO NOTHING;

    -- 4e. School 2 Manager (St. George Community School)
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
    ) VALUES (
        c_manager2_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'manager2@schoolbus.local', v_enc_pwd, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"full_name":"Manager Two","phone":"+251911000007"}'::jsonb,
        now(), now(), ''
    ) ON CONFLICT (id) DO UPDATE SET
        encrypted_password = EXCLUDED.encrypted_password,
        raw_user_meta_data = EXCLUDED.raw_user_meta_data;

    INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at)
    VALUES (
        gen_random_uuid(), 'manager2@schoolbus.local', c_manager2_id,
        jsonb_build_object('sub', c_manager2_id::text, 'email', 'manager2@schoolbus.local'),
        'email', now(), now()
    ) ON CONFLICT (provider, provider_id) DO NOTHING;

    -- ==========================================================================
    -- 5. Seed public.profiles
    -- ==========================================================================
    INSERT INTO public.profiles (id, school_id, role, full_name, phone, language_pref, is_active)
    VALUES
        (c_owner_id, NULL, 'owner', 'Platform Owner', '+251911000001', 'en', true),
        (c_manager1_id, v_sch1_id, 'manager', 'Manager One', '+251911000002', 'en', true),
        (c_driver1_id, v_sch1_id, 'driver', 'Driver One', '+251911000003', 'am', true),
        (c_parent1_id, v_sch1_id, 'parent', 'Parent One', '+251911000004', 'en', true),
        (c_manager2_id, v_sch2_id, 'manager', 'Manager Two', '+251911000007', 'en', true)
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        phone = EXCLUDED.phone,
        is_active = true;

    -- ==========================================================================
    -- 6. Link Associations (Guardians & Bus Assignments)
    -- ==========================================================================

    -- Link Parent 1 to Student 1 in School 1
    SELECT id INTO v_student1_id FROM public.students WHERE school_id = v_sch1_id ORDER BY full_name LIMIT 1;
    IF v_student1_id IS NOT NULL THEN
        INSERT INTO public.guardians (school_id, student_id, profile_id, relationship, is_primary, alert_radius_m)
        VALUES (v_sch1_id, v_student1_id, c_parent1_id, 'father', true, 500)
        ON CONFLICT (student_id, profile_id) DO NOTHING;
    END IF;

    -- Assign Driver 1 to Bus 1 on Route A in School 1
    SELECT b.id INTO v_bus1_id 
    FROM public.buses b 
    JOIN public.bus_plates bp ON bp.bus_id = b.id 
    WHERE b.school_id = v_sch1_id AND bp.plate_number = 'TEST-001' 
    LIMIT 1;
    IF v_bus1_id IS NULL THEN
        SELECT id INTO v_bus1_id FROM public.buses WHERE school_id = v_sch1_id ORDER BY name LIMIT 1;
    END IF;
    SELECT id INTO v_route_a_id FROM public.routes WHERE school_id = v_sch1_id AND code = 'RT-A' LIMIT 1;

    IF v_bus1_id IS NOT NULL AND v_route_a_id IS NOT NULL THEN
        INSERT INTO public.bus_assignments (school_id, bus_id, route_id, driver_profile_id, effective_date, is_active)
        VALUES (v_sch1_id, v_bus1_id, v_route_a_id, c_driver1_id, CURRENT_DATE, true)
        ON CONFLICT (bus_id) WHERE is_active = true DO UPDATE SET
            route_id = EXCLUDED.route_id,
            driver_profile_id = EXCLUDED.driver_profile_id;
    END IF;

    RAISE NOTICE 'Step 4 test auth users seeded successfully for dev!';
END $$;
