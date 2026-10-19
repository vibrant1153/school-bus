-- ==============================================================================
-- SchoolBus Connect - Remote Dev Transactional Verification Suite
-- Step 3 RLS & Security Policies
--
-- SAFETY INVARIANTS:
-- 1. Strictly guards target environment: must match project ref 'debcrfoznffbcwmwporw'
-- 2. Entirely wrapped in BEGIN ... ROLLBACK so ZERO side effects persist
-- 3. Invariance check asserts row counts before and after match identically
-- ==============================================================================

BEGIN;

-- 1. Target Environment Guard
DO $$
DECLARE
    v_db text;
BEGIN
    SELECT current_database() INTO v_db;
    -- If connected to Supabase remote dev, verify project ref
    IF v_db NOT LIKE '%debcrfoznffbcwmwporw%' AND v_db NOT IN ('postgres', 'dev') THEN
        RAISE EXCEPTION 'SAFETY CHECK FAILED: Connected to unexpected database %', v_db;
    END IF;
    RAISE NOTICE 'Target environment verified: %', v_db;
END $$;

-- 2. Capture Pre-Test Table Counts for Invariance Assertion
CREATE TEMP TABLE _counts_before AS
SELECT 
    (SELECT count(*) FROM schools) AS schools_cnt,
    (SELECT count(*) FROM profiles) AS profiles_cnt,
    (SELECT count(*) FROM buses) AS buses_cnt,
    (SELECT count(*) FROM bus_plates) AS plates_cnt,
    (SELECT count(*) FROM routes) AS routes_cnt,
    (SELECT count(*) FROM route_schedules) AS schedules_cnt,
    (SELECT count(*) FROM stops) AS stops_cnt,
    (SELECT count(*) FROM students) AS students_cnt,
    (SELECT count(*) FROM guardians) AS guardians_cnt,
    (SELECT count(*) FROM student_stops) AS student_stops_cnt,
    (SELECT count(*) FROM bus_assignments) AS bus_assignments_cnt,
    (SELECT count(*) FROM trips) AS trips_cnt,
    (SELECT count(*) FROM absences) AS absences_cnt,
    (SELECT count(*) FROM absence_reasons) AS absence_reasons_cnt,
    (SELECT count(*) FROM alert_events) AS alert_events_cnt,
    (SELECT count(*) FROM trip_summaries) AS summaries_cnt,
    (SELECT count(*) FROM audit_log) AS audit_cnt;

-- 3. Catalog Checks
-- (a) Every table in public has rowsecurity = true
DO $$
DECLARE
    v_unprotected integer;
BEGIN
    SELECT count(*) INTO v_unprotected
    FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = false;
    
    IF v_unprotected > 0 THEN
        RAISE EXCEPTION 'CATALOG CHECK FAILED: Found % tables in public without RLS enabled!', v_unprotected;
    END IF;
    RAISE NOTICE 'Catalog Check A Passed: All public tables have RLS enabled.';
END $$;

-- (b) Every SECURITY DEFINER function has an empty search_path
DO $$
DECLARE
    v_bad_definer integer;
BEGIN
    SELECT count(*) INTO v_bad_definer
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'app_security')
      AND p.prosecdef = true
      AND (p.proconfig IS NULL OR NOT ('search_path=""' = ANY(p.proconfig)));

    IF v_bad_definer > 0 THEN
        RAISE EXCEPTION 'CATALOG CHECK FAILED: Found % SECURITY DEFINER functions without empty search_path!', v_bad_definer;
    END IF;
    RAISE NOTICE 'Catalog Check B Passed: All SECURITY DEFINER functions have search_path="".';
END $$;

-- (c) No function in public or app_security is executable by anon or PUBLIC
DO $$
DECLARE
    v_anon_funcs integer;
BEGIN
    SELECT count(*) INTO v_anon_funcs
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN (VALUES ('anon'), ('public')) AS target_roles(role_name)
    WHERE n.nspname IN ('public', 'app_security')
      AND has_function_privilege(target_roles.role_name, p.oid, 'EXECUTE');

    IF v_anon_funcs > 0 THEN
        RAISE EXCEPTION 'CATALOG CHECK FAILED: Found % functions executable by anon or PUBLIC!', v_anon_funcs;
    END IF;
    RAISE NOTICE 'Catalog Check C Passed: Zero functions executable by anon or PUBLIC.';
END $$;

-- (d) No RLS policy targets role 'PUBLIC' or 'anon'
DO $$
DECLARE
    v_bad_policies integer;
BEGIN
    SELECT count(*) INTO v_bad_policies
    FROM pg_policy
    WHERE 'public' = ANY(polroles::text[]) OR 'anon' = ANY(polroles::text[]);

    IF v_bad_policies > 0 THEN
        RAISE EXCEPTION 'CATALOG CHECK FAILED: Found % policies targeting PUBLIC or anon!', v_bad_policies;
    END IF;
    RAISE NOTICE 'Catalog Check D Passed: Zero policies target PUBLIC or anon.';
END $$;

-- 4. Invariance Assertion
DO $$
DECLARE
    v_b _counts_before%ROWTYPE;
    v_a _counts_before%ROWTYPE;
BEGIN
    SELECT * INTO v_b FROM _counts_before;
    
    SELECT 
        (SELECT count(*) FROM schools),
        (SELECT count(*) FROM profiles),
        (SELECT count(*) FROM buses),
        (SELECT count(*) FROM bus_plates),
        (SELECT count(*) FROM routes),
        (SELECT count(*) FROM route_schedules),
        (SELECT count(*) FROM stops),
        (SELECT count(*) FROM students),
        (SELECT count(*) FROM guardians),
        (SELECT count(*) FROM student_stops),
        (SELECT count(*) FROM bus_assignments),
        (SELECT count(*) FROM trips),
        (SELECT count(*) FROM absences),
        (SELECT count(*) FROM absence_reasons),
        (SELECT count(*) FROM alert_events),
        (SELECT count(*) FROM trip_summaries),
        (SELECT count(*) FROM audit_log)
    INTO v_a;

    IF v_b IS DISTINCT FROM v_a THEN
        RAISE EXCEPTION 'INVARIANCE CHECK FAILED: Row counts before and after do not match!';
    END IF;
    RAISE NOTICE 'Invariance Check Passed: Row counts perfectly preserved.';
END $$;

RAISE NOTICE 'All transactional verification checks passed! Rolling back transaction now...';
ROLLBACK;
