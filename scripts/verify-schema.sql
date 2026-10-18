-- ==============================================================================
-- SchoolBus Connect - Migration Verification Query
-- Run this in the Supabase Dashboard SQL Editor or via supabase CLI
-- ==============================================================================

-- 1. Check Table Count & RLS Status across all public tables (Expect exactly 18 tables, all with rowsecurity = true)
SELECT 
    tablename,
    rowsecurity AS rls_enabled
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY tablename;

-- Summary counts
SELECT 
    COUNT(*) AS total_tables,
    COUNT(*) FILTER (WHERE rowsecurity = true) AS tables_with_rls_enabled
FROM pg_tables 
WHERE schemaname = 'public';

-- 2. Check Seeded Rows Count (Run as superuser/postgres in SQL Editor or CLI)
SELECT 
    (SELECT COUNT(*) FROM schools) AS schools_count,          -- Expect: 2
    (SELECT COUNT(*) FROM buses) AS buses_count,              -- Expect: 3
    (SELECT COUNT(*) FROM routes) AS routes_count,            -- Expect: 3
    (SELECT COUNT(*) FROM route_schedules) AS schedules_count,-- Expect: 30
    (SELECT COUNT(*) FROM stops) AS stops_count,              -- Expect: 12
    (SELECT COUNT(*) FROM students) AS students_count,        -- Expect: 12
    (SELECT COUNT(*) FROM student_stops) AS student_stops,    -- Expect: 18 (morning + afternoon for students)
    (SELECT COUNT(*) FROM profiles) AS profiles_count,        -- Expect: 0 (deferred to Step 4)
    (SELECT COUNT(*) FROM guardians) AS guardians_count,      -- Expect: 0 (deferred to Step 4)
    (SELECT COUNT(*) FROM trips) AS trips_count;              -- Expect: 0
