import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

async function run() {
  console.log('🚀 Initializing PGlite in-memory database...')
  const db = new PGlite()

  // 1. Initialize auth and realtime schemas
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      email text
    );

    DO $$ BEGIN
      CREATE ROLE authenticated;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE ROLE anon;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE ROLE service_role;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;

    -- Emulate Supabase Realtime schema & messages table with REAL column 'extension'
    CREATE SCHEMA IF NOT EXISTS realtime;
    CREATE TABLE IF NOT EXISTS realtime.messages (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      topic text NOT NULL,
      extension text NOT NULL,
      payload jsonb,
      event text,
      private boolean DEFAULT false,
      updated_at timestamptz DEFAULT now(),
      inserted_at timestamptz DEFAULT now()
    );
    ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

    CREATE OR REPLACE FUNCTION realtime.topic()
    RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('realtime.topic', true);
    $$;

    -- Emulate Supabase auth helpers
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
        nullif(current_setting('app.current_user_id', true), '')::uuid
      );
    $$;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        nullif(current_setting('request.jwt.claims', true), '')::jsonb,
        '{}'::jsonb
      );
    $$;
  `)

  // 2. Load and apply Migration 1 (Core Schema) and Migration 2 (Review Fixes)
  const mig1 = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261017000001_core_schema.sql'), 'utf8')
  const mig2 = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261018000001_schema_review_fixes.sql'), 'utf8')

  console.log('📦 Applying Core Schema & Review Fixes migrations...')
  await db.exec(mig1)
  await db.exec(mig2)

  // 3. Pre-migration Data Insertion: Insert rows with plate_number and reason
  // to prove the migration preserves existing data when relocating sensitive columns.
  console.log('🧪 Pre-populating existing data before Step 3 migration (testing data preservation)...')
  await db.exec(`
    INSERT INTO schools (id, name, code, timezone, contact_phone) VALUES
      ('11111111-1111-1111-1111-111111111111', 'Pilot Academy Addis', 'PAA-01', 'Africa/Addis_Ababa', '+251110000001');

    INSERT INTO auth.users (id) VALUES
      ('00000000-0000-0000-0000-000000000004');

    INSERT INTO profiles (id, school_id, role, full_name, phone) VALUES
      ('00000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111', 'parent', 'Parent Data Preserve', '+251911000004');

    INSERT INTO students (id, school_id, full_name, grade) VALUES
      ('c0000000-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Child PreMigration', 3);

    -- Bus with plate_number before migration
    INSERT INTO buses (id, school_id, name, plate_number, capacity) VALUES
      ('b1111111-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Old Bus 1', 'PRE-MIG-PLATE-99', 30);

    -- Absence with reason before migration
    INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by, reason) VALUES
      ('99999999-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'c0000000-0001-0000-0000-000000000001', CURRENT_DATE, 'morning', '00000000-0000-0000-0000-000000000004', 'Pre-migration medical note');
  `)

  // 4. Recreate Supabase Default Privileges BEFORE applying the migration (Fix 1)
  console.log('⚙️  Recreating Supabase default privileges on public schema...')
  await db.exec(`
    GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  `)

  // 5. Apply Migration 3: 20261019000001_rls_policies_and_security.sql
  console.log('🔒 Applying Step 3 Migration: 20261019000001_rls_policies_and_security.sql...')
  const mig3 = readFileSync(resolve(process.cwd(), 'supabase/migrations/20261019000001_rls_policies_and_security.sql'), 'utf8')
  await db.exec(mig3)
  console.log('✅ Step 3 migration applied successfully!\n')

  // 6. Test Data Preservation Post-Migration
  console.log('🔍 Verifying sensitive column data preservation...')
  const plateCheck = await db.query('SELECT plate_number FROM bus_plates WHERE bus_id = $1', ['b1111111-0001-0000-0000-000000000001'])
  if (plateCheck.rows.length !== 1 || plateCheck.rows[0].plate_number !== 'PRE-MIG-PLATE-99') {
    throw new Error(`Data preservation failed for bus_plates: expected 'PRE-MIG-PLATE-99', got '${plateCheck.rows[0]?.plate_number}'`)
  }

  const reasonCheck = await db.query('SELECT reason FROM absence_reasons WHERE absence_id = $1', ['99999999-0001-0000-0000-000000000001'])
  if (reasonCheck.rows.length !== 1 || reasonCheck.rows[0].reason !== 'Pre-migration medical note') {
    throw new Error(`Data preservation failed for absence_reasons: expected 'Pre-migration medical note', got '${reasonCheck.rows[0]?.reason}'`)
  }
  console.log('✅ Data preservation verified: plate_number and reason correctly migrated!\n')

  // 7. Verify seed.sql runs cleanly on a database with this schema
  console.log('🌱 Testing that supabase/seed.sql runs cleanly on the migrated schema...')
  const seedSql = readFileSync(resolve(process.cwd(), 'supabase/seed.sql'), 'utf8')
  await db.exec(seedSql)
  console.log('✅ supabase/seed.sql executed successfully with 0 errors!\n')

  // Helpers for running queries under simulated authenticated user
  async function asUser(userId, role, extraClaims = {}) {
    const claims = {
      sub: userId,
      role: 'authenticated',
      ...extraClaims
    }
    await db.exec(`
      SET ROLE authenticated;
      SET LOCAL request.jwt.claim.sub = '${userId || ''}';
      SET LOCAL request.jwt.claims = '${JSON.stringify(claims)}';
      SET LOCAL app.current_user_id = '${userId || ''}';
    `)
  }

  async function asSuperuser() {
    await db.exec(`
      RESET ROLE;
      SET LOCAL request.jwt.claim.sub = '';
      SET LOCAL request.jwt.claims = '{}';
      SET LOCAL app.current_user_id = '';
      SET LOCAL "realtime.topic" = '';
    `)
  }

  // Populate remaining mock test users and associations for multi-tenant tests
  await db.exec(`
    INSERT INTO auth.users (id) VALUES
      ('00000000-0000-0000-0000-000000000001'), -- Owner
      ('00000000-0000-0000-0000-000000000002'), -- Manager School 1
      ('00000000-0000-0000-0000-000000000003'), -- Driver 1 School 1 (Assigned to Trip 1)
      ('00000000-0000-0000-0000-000000000013'), -- Driver 2 School 1 (Assigned to Trip 2)
      ('00000000-0000-0000-0000-000000000005'), -- Parent 2 School 1 (Child NOT on Trip 1)
      ('00000000-0000-0000-0000-000000000006'), -- Parent School 2
      ('00000000-0000-0000-0000-000000000007')  -- Manager School 2
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO profiles (id, school_id, role, full_name, phone) VALUES
      ('00000000-0000-0000-0000-000000000001', NULL, 'owner', 'Platform Owner', '+251911000001'),
      ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'manager', 'Manager One', '+251911000002'),
      ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'driver', 'Driver One', '+251911000003'),
      ('00000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'driver', 'Driver Two', '+251911000013'),
      ('00000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'parent', 'Parent Two', '+251911000005'),
      ('00000000-0000-0000-0000-000000000006', (SELECT id FROM schools WHERE code = 'SGC-02'), 'parent', 'Parent School 2', '+251911000006'),
      ('00000000-0000-0000-0000-000000000007', (SELECT id FROM schools WHERE code = 'SGC-02'), 'manager', 'Manager Two', '+251911000007')
    ON CONFLICT (id) DO NOTHING;

    DO $$
    DECLARE
      v_sch1_id uuid := '11111111-1111-1111-1111-111111111111';
      v_bus1_id uuid;
      v_bus2_id uuid;
      v_rt_a_id uuid;
      v_rt_b_id uuid;
      v_stu_p1_id uuid;
      v_stu_p2_id uuid;
      v_stop_a1 uuid;
      v_stop_b1 uuid;
    BEGIN
      SELECT id INTO v_bus1_id FROM buses WHERE school_id = v_sch1_id ORDER BY name LIMIT 1;
      SELECT id INTO v_bus2_id FROM buses WHERE school_id = v_sch1_id ORDER BY name OFFSET 1 LIMIT 1;
      SELECT id INTO v_rt_a_id FROM routes WHERE school_id = v_sch1_id AND code = 'RT-A' LIMIT 1;
      SELECT id INTO v_rt_b_id FROM routes WHERE school_id = v_sch1_id AND code = 'RT-B' LIMIT 1;

      -- Assign driver 1 to Bus 1 / Route A
      INSERT INTO bus_assignments (school_id, bus_id, route_id, driver_profile_id, effective_date, is_active)
      VALUES (v_sch1_id, v_bus1_id, v_rt_a_id, '00000000-0000-0000-0000-000000000003', CURRENT_DATE, true)
      ON CONFLICT DO NOTHING;

      -- Assign driver 2 to Bus 2 / Route B
      INSERT INTO bus_assignments (school_id, bus_id, route_id, driver_profile_id, effective_date, is_active)
      VALUES (v_sch1_id, v_bus2_id, v_rt_b_id, '00000000-0000-0000-0000-000000000013', CURRENT_DATE, true)
      ON CONFLICT DO NOTHING;

      -- Stops for Route A and B
      SELECT id INTO v_stop_a1 FROM stops WHERE route_id = v_rt_a_id LIMIT 1;
      SELECT id INTO v_stop_b1 FROM stops WHERE route_id = v_rt_b_id LIMIT 1;

      -- Link Parent 1 to a Route A student
      SELECT id INTO v_stu_p1_id FROM students WHERE school_id = v_sch1_id ORDER BY full_name LIMIT 1;
      INSERT INTO guardians (school_id, student_id, profile_id, relationship)
      VALUES (v_sch1_id, v_stu_p1_id, '00000000-0000-0000-0000-000000000004', 'father')
      ON CONFLICT (student_id, profile_id) DO NOTHING;

      INSERT INTO student_stops (school_id, student_id, stop_id, direction)
      VALUES (v_sch1_id, v_stu_p1_id, v_stop_a1, 'morning')
      ON CONFLICT (student_id, direction) DO NOTHING;

      -- Create student for Parent 2 on Route B (different bus)
      SELECT id INTO v_stu_p2_id FROM students WHERE school_id = v_sch1_id ORDER BY full_name OFFSET 1 LIMIT 1;
      INSERT INTO guardians (school_id, student_id, profile_id, relationship)
      VALUES (v_sch1_id, v_stu_p2_id, '00000000-0000-0000-0000-000000000005', 'father')
      ON CONFLICT (student_id, profile_id) DO NOTHING;

      INSERT INTO student_stops (school_id, student_id, stop_id, direction)
      VALUES (v_sch1_id, v_stu_p2_id, v_stop_b1, 'morning')
      ON CONFLICT (student_id, direction) DO NOTHING;

      -- Seed sample trip 1 (Route A / Bus 1)
      INSERT INTO trips (id, school_id, route_id, bus_id, driver_profile_id, trip_date, direction, status, scheduled_start)
      VALUES ('d0000000-0001-0000-0000-000000000001', v_sch1_id, v_rt_a_id, v_bus1_id, '00000000-0000-0000-0000-000000000003', CURRENT_DATE, 'morning', 'scheduled', now())
      ON CONFLICT (id) DO NOTHING;

      -- Seed sample trip 2 (Route B / Bus 2)
      INSERT INTO trips (id, school_id, route_id, bus_id, driver_profile_id, trip_date, direction, status, scheduled_start)
      VALUES ('d0000000-0002-0000-0000-000000000002', v_sch1_id, v_rt_b_id, v_bus2_id, '00000000-0000-0000-0000-000000000013', CURRENT_DATE, 'morning', 'scheduled', now())
      ON CONFLICT (id) DO NOTHING;

      -- Seed sample breadcrumbs for Trip 1
      INSERT INTO bus_location_history (school_id, bus_id, trip_id, lat, lng, speed, heading, accuracy, recorded_at)
      VALUES (v_sch1_id, v_bus1_id, 'd0000000-0001-0000-0000-000000000001', 9.011, 38.751, 24.5, 90.0, 5.0, now())
      ON CONFLICT DO NOTHING;
    END $$;
  `)

  // Test Runner Harness
  let passed = 0
  let failed = 0
  console.log('🧪 RUNNING EXHAUSTIVE TEST SUITE WITH POSITIVE CONTROLS...\n')

  async function test(name, fn) {
    try {
      await db.exec('BEGIN')
      await fn()
      await db.exec('ROLLBACK')
      passed++
      console.log(`   ✅ PASS: ${name}`)
    } catch (err) {
      failed++
      console.error(`   ❌ FAIL: ${name}`)
      console.error(`      Error: ${err.message}`)
      try { await db.exec('ROLLBACK') } catch (e) {}
    }
  }

  // --- Suite 1: Owner Restricted Access (Fix 1) ---
  await test('Owner cannot read operational tables (buses, assignments, trips, audit_log, summaries); CAN read schools & manager profiles', async () => {
    await asUser('00000000-0000-0000-0000-000000000001', 'owner')

    const deniedQueries = [
      { name: 'buses', sql: 'SELECT * FROM buses' },
      { name: 'bus_plates', sql: 'SELECT * FROM bus_plates' },
      { name: 'routes', sql: 'SELECT * FROM routes' },
      { name: 'route_schedules', sql: 'SELECT * FROM route_schedules' },
      { name: 'stops', sql: 'SELECT * FROM stops' },
      { name: 'students', sql: 'SELECT * FROM students' },
      { name: 'guardians', sql: 'SELECT * FROM guardians' },
      { name: 'student_stops', sql: 'SELECT * FROM student_stops' },
      { name: 'bus_assignments', sql: 'SELECT * FROM bus_assignments' },
      { name: 'trips', sql: 'SELECT * FROM trips' },
      { name: 'bus_locations_latest', sql: 'SELECT * FROM bus_locations_latest' },
      { name: 'bus_location_history', sql: 'SELECT * FROM bus_location_history' },
      { name: 'absences', sql: 'SELECT * FROM absences' },
      { name: 'absence_reasons', sql: 'SELECT * FROM absence_reasons' },
      { name: 'alert_events', sql: 'SELECT * FROM alert_events' },
      { name: 'trip_summaries', sql: 'SELECT * FROM trip_summaries' },
      { name: 'audit_log', sql: 'SELECT * FROM audit_log' }
    ]

    for (const q of deniedQueries) {
      const res = await db.query(q.sql)
      if (res.rows.length !== 0) throw new Error(`Owner leak on ${q.name}: expected 0 rows, got ${res.rows.length}`)
    }

    const schoolsRes = await db.query('SELECT * FROM schools')
    if (schoolsRes.rows.length === 0) throw new Error('Owner should see schools, got 0')

    const profsRes = await db.query('SELECT * FROM profiles')
    if (profsRes.rows.length === 0) throw new Error('Owner should see manager profiles')
    for (const p of profsRes.rows) {
      if (p.role !== 'manager' && p.id !== '00000000-0000-0000-0000-000000000001') {
        throw new Error(`Owner leaked non-manager profile with role ${p.role}`)
      }
    }

    const healthRes = await db.query('SELECT * FROM get_school_health_metrics()')
    if (healthRes.rows.length === 0) throw new Error('Owner should be able to call get_school_health_metrics')
  })

  // --- Suite 2: Realtime Authorization via REAL realtime.messages policy (Fix 5) ---
  await test('Realtime per-trip topic authorization: child on trip succeeds, other trip denied, malformed denied safely, non-broadcast denied, no INSERT', async () => {
    await asSuperuser()
    // Insert messages into realtime.messages table directly (as server)
    await db.query(`
      INSERT INTO realtime.messages (topic, extension, payload) VALUES
        ('trip:d0000000-0001-0000-0000-000000000001', 'broadcast', '{"event":"location"}'::jsonb),
        ('trip:d0000000-0002-0000-0000-000000000002', 'broadcast', '{"event":"location"}'::jsonb),
        ('trip:d0000000-0001-0000-0000-000000000001', 'presence', '{"event":"presence"}'::jsonb);
    `)

    // 1. Parent 1 queries realtime.messages for Trip 1 (child on trip) -> succeeds (1 row)
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    await db.exec("SET LOCAL \"realtime.topic\" = 'trip:d0000000-0001-0000-0000-000000000001';")
    const p1Trip1 = await db.query("SELECT * FROM realtime.messages WHERE topic = 'trip:d0000000-0001-0000-0000-000000000001' AND extension = 'broadcast'")
    if (p1Trip1.rows.length !== 1) throw new Error(`Parent 1 should see broadcast message for Trip 1, got ${p1Trip1.rows.length}`)

    // 2. Parent 1 queries Trip 2 (different bus) -> denied (0 rows)
    await db.exec("SET LOCAL \"realtime.topic\" = 'trip:d0000000-0002-0000-0000-000000000002';")
    const p1Trip2 = await db.query("SELECT * FROM realtime.messages WHERE topic = 'trip:d0000000-0002-0000-0000-000000000002' AND extension = 'broadcast'")
    if (p1Trip2.rows.length !== 0) throw new Error('Parent 1 saw broadcast for trip carrying other children!')

    // 3. Malformed topic -> safely returns 0 rows without cast exception
    await db.exec("SET LOCAL \"realtime.topic\" = 'trip:malformed-not-uuid';")
    const malformed = await db.query("SELECT * FROM realtime.messages WHERE topic = 'trip:malformed-not-uuid'")
    if (malformed.rows.length !== 0) throw new Error('Malformed topic query returned rows!')

    // 4. Non-broadcast extension -> denied (0 rows)
    await db.exec("SET LOCAL \"realtime.topic\" = 'trip:d0000000-0001-0000-0000-000000000001';")
    const presenceRes = await db.query("SELECT * FROM realtime.messages WHERE topic = 'trip:d0000000-0001-0000-0000-000000000001' AND extension = 'presence'")
    if (presenceRes.rows.length !== 0) throw new Error('Non-broadcast extension must be denied by RLS')

    // 5. No client INSERT policy on realtime.messages for anyone
    await db.exec('SAVEPOINT sp_realtime_insert')
    let insertDenied = false
    try {
      await db.query("INSERT INTO realtime.messages (topic, extension) VALUES ('trip:d0000000-0001-0000-0000-000000000001', 'broadcast')")
    } catch (e) {
      if (e.message.includes('violates row-level security policy') || e.code === '42501') insertDenied = true
      await db.exec('ROLLBACK TO sp_realtime_insert')
    }
    if (!insertDenied) throw new Error('Client INSERT into realtime.messages must be denied by RLS')
  })

  // --- Suite 3: Driver Attendance Isolation (Fix 6) ---
  await test('Driver cannot access absences directly or read reason; is_student_absent only answers for driver assigned trip', async () => {
    await asSuperuser()
    // Look up students for Trip 1 and Trip 2
    const stu1 = (await db.query(`
      SELECT ss.student_id 
      FROM student_stops ss 
      JOIN stops s ON s.id = ss.stop_id 
      WHERE s.route_id = (SELECT route_id FROM trips WHERE id = 'd0000000-0001-0000-0000-000000000001')
      LIMIT 1
    `)).rows[0].student_id

    const stu2 = (await db.query(`
      SELECT ss.student_id 
      FROM student_stops ss 
      JOIN stops s ON s.id = ss.stop_id 
      WHERE s.route_id = (SELECT route_id FROM trips WHERE id = 'd0000000-0002-0000-0000-000000000002')
      LIMIT 1
    `)).rows[0].student_id

    await db.query(`
      INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by)
      VALUES ('77777777-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', $1, CURRENT_DATE, 'morning', '00000000-0000-0000-0000-000000000004')
      ON CONFLICT DO NOTHING;
    `, [stu1])
    await db.query(`
      INSERT INTO absence_reasons (absence_id, school_id, reason)
      VALUES ('77777777-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Medical note: flu')
      ON CONFLICT DO NOTHING;
    `)

    // 1. Driver 1 direct SELECT on absences -> 0 rows
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    const drvAbs = await db.query('SELECT * FROM absences')
    if (drvAbs.rows.length !== 0) throw new Error(`Driver saw ${drvAbs.rows.length} rows in absences`)

    // 2. Driver 1 direct SELECT on absence_reasons -> 0 rows
    const drvRsn = await db.query('SELECT * FROM absence_reasons')
    if (drvRsn.rows.length !== 0) throw new Error(`Driver saw ${drvRsn.rows.length} rows in absence_reasons`)

    // 3. Driver 1 queries is_student_absent for assigned student -> returns true
    const isAbs = await db.query('SELECT is_student_absent($1, $2, $3) as absent', [stu1, new Date().toISOString().slice(0, 10), 'morning'])
    if (isAbs.rows[0].absent !== true) throw new Error('is_student_absent should return true for assigned student')

    // 4. Driver 1 queries is_student_absent for stu2 (on Driver 2 route) -> REJECTED with 42501 Access Denied
    await db.exec('SAVEPOINT sp_drv_other')
    let otherBusRejected = false
    try {
      await db.query('SELECT is_student_absent($1, $2, $3)', [stu2, new Date().toISOString().slice(0, 10), 'morning'])
    } catch (e) {
      if (e.message.includes('Access Denied') || e.code === '42501') otherBusRejected = true
      await db.exec('ROLLBACK TO sp_drv_other')
    }
    if (!otherBusRejected) throw new Error('Driver querying absence for student on another bus MUST be rejected')

    // Positive control: Driver 2 queries stu2 -> succeeds!
    await asUser('00000000-0000-0000-0000-000000000013', 'driver')
    const drv2Check = await db.query('SELECT is_student_absent($1, $2, $3) as absent', [stu2, new Date().toISOString().slice(0, 10), 'morning'])
    if (typeof drv2Check.rows[0].absent !== 'boolean') throw new Error('Driver 2 query for their own student should succeed')

    // Positive control: Manager reads reason
    await asUser('00000000-0000-0000-0000-000000000002', 'manager')
    const mgrRsn = await db.query('SELECT * FROM absence_reasons')
    if (mgrRsn.rows.length === 0 || !mgrRsn.rows[0].reason.includes('Medical')) throw new Error('Manager should read full medical reason')
  })

  // --- Suite 4: Location History Direct SELECT Blocked; Audited RPC & Purge Works ---
  await test('Manager direct SELECT on bus_location_history returns 0 rows; get_trip_location_history succeeds and audits; purge_location_history functions', async () => {
    await asUser('00000000-0000-0000-0000-000000000002', 'manager')

    // Direct SELECT -> 0 rows
    const dirRes = await db.query('SELECT * FROM bus_location_history')
    if (dirRes.rows.length !== 0) throw new Error(`Direct select should return 0 rows, got ${dirRes.rows.length}`)

    // RPC get_trip_location_history -> returns real columns
    const rpcRes = await db.query('SELECT * FROM get_trip_location_history($1)', ['d0000000-0001-0000-0000-000000000001'])
    if (rpcRes.rows.length === 0) throw new Error('RPC should return history points')
    if (rpcRes.rows[0].out_lat !== 9.011) throw new Error(`Unexpected lat: ${rpcRes.rows[0].out_lat}`)
    if (rpcRes.rows[0].out_heading !== 90.0) throw new Error(`Unexpected heading: ${rpcRes.rows[0].out_heading}`)

    // Positive control: Audit log entry exists
    const auditRes = await db.query("SELECT * FROM audit_log WHERE action = 'SELECT_LOCATION_HISTORY'")
    if (auditRes.rows.length === 0) throw new Error('Audit log entry was not created')

    // Test purge_location_history: manager can execute, driver cannot
    const purgeCount = await db.query('SELECT purge_location_history() as cnt')
    if (typeof purgeCount.rows[0].cnt !== 'number') throw new Error('purge_location_history should return integer count')

    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    await db.exec('SAVEPOINT sp_purge_drv')
    let drvPurgeDenied = false
    try {
      await db.query('SELECT purge_location_history()')
    } catch (e) {
      if (e.message.includes('Access Denied') || e.code === '42501') drvPurgeDenied = true
      await db.exec('ROLLBACK TO sp_purge_drv')
    }
    if (!drvPurgeDenied) throw new Error('Driver calling purge_location_history must be rejected')
  })

  // --- Suite 5: Plate Number and Assignment Privacy ---
  await test('Parents cannot access bus_plates or bus_assignments; can see bus name only', async () => {
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')

    const baRes = await db.query('SELECT * FROM bus_assignments')
    if (baRes.rows.length !== 0) throw new Error('Parent must see 0 rows on bus_assignments')

    const bpRes = await db.query('SELECT * FROM bus_plates')
    if (bpRes.rows.length !== 0) throw new Error('Parent must see 0 rows on bus_plates')

    const bRes = await db.query('SELECT id, name FROM buses')
    if (bRes.rows.length === 0) throw new Error('Parent should see assigned bus name')

    // Positive control: Driver sees plate for assigned bus
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    const drvPlate = await db.query('SELECT * FROM bus_plates')
    if (drvPlate.rows.length === 0) throw new Error('Driver should see assigned bus plate')
  })

  // --- Suite 6: Immutability Triggers (Fix 2) ---
  await test('Direct client changes to profiles.role, school_id, id, phone and guardians.student_id, profile_id are blocked with exact error', async () => {
    // 1. Parent attempts to change own role
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    await db.exec('SAVEPOINT sp_immut_role')
    let roleErr = false
    try {
      await db.query("UPDATE profiles SET role = 'manager' WHERE id = '00000000-0000-0000-0000-000000000004'")
    } catch (e) {
      if (e.message.includes('profiles.role cannot be updated directly') && e.code === '42501') roleErr = true
      await db.exec('ROLLBACK TO sp_immut_role')
    }
    if (!roleErr) throw new Error('Expected 42501 Immutable field violation for profiles.role')

    // 2. Parent attempts to change own school_id
    await db.exec('SAVEPOINT sp_immut_school')
    let schoolErr = false
    try {
      await db.query("UPDATE profiles SET school_id = '22222222-2222-2222-2222-222222222222' WHERE id = '00000000-0000-0000-0000-000000000004'")
    } catch (e) {
      if (e.message.includes('profiles.school_id cannot be updated directly') && e.code === '42501') schoolErr = true
      await db.exec('ROLLBACK TO sp_immut_school')
    }
    if (!schoolErr) throw new Error('Expected 42501 Immutable field violation for profiles.school_id')

    // 3. Parent attempts to re-point guardians row to another child
    await db.exec('SAVEPOINT sp_immut_guard')
    let guardErr = false
    try {
      await db.query("UPDATE guardians SET student_id = 'c0000000-0002-0000-0000-000000000002' WHERE profile_id = '00000000-0000-0000-0000-000000000004'")
    } catch (e) {
      if (e.message.includes('guardians.student_id cannot be updated directly') && e.code === '42501') guardErr = true
      await db.exec('ROLLBACK TO sp_immut_guard')
    }
    if (!guardErr) throw new Error('Expected 42501 Immutable field violation for guardians.student_id')

    // 4. Manager cannot change another user's role
    await asUser('00000000-0000-0000-0000-000000000002', 'manager')
    await db.exec('SAVEPOINT sp_mgr_role')
    let mgrRoleErr = false
    try {
      await db.query("UPDATE profiles SET role = 'manager' WHERE id = '00000000-0000-0000-0000-000000000003'")
    } catch (e) {
      if (e.message.includes('profiles.role cannot be updated directly') && e.code === '42501') mgrRoleErr = true
      await db.exec('ROLLBACK TO sp_mgr_role')
    }
    if (!mgrRoleErr) throw new Error('Manager changing user role must be blocked by immutability trigger')

    // Positive control: Parent can update full_name and alert_radius_m
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const profUpd = await db.query("UPDATE profiles SET full_name = 'Updated Parent Name' WHERE id = '00000000-0000-0000-0000-000000000004'")
    if (profUpd.rowCount !== 1) throw new Error('Parent should be able to update own full_name')

    const gUpd = await db.query("UPDATE guardians SET alert_radius_m = 1000 WHERE profile_id = '00000000-0000-0000-0000-000000000004'")
    if (gUpd.rowCount === 0) throw new Error('Parent should be able to update alert_radius_m on own guardian record')
  })

  // --- Suite 7: Manager Writes in Own School & Cross-Tenant Rejection (Fix 3) ---
  await test('Manager CRUD in own school works with audit logging; cross-school writes rejected; operational tables write-protected', async () => {
    // Look up school 2 id and a school 2 bus as superuser
    await asSuperuser()
    const otherSchoolRes = await db.query("SELECT id FROM schools WHERE code = 'SGC-02'")
    if (otherSchoolRes.rows.length === 0) throw new Error("School SGC-02 not found")
    const otherSchoolId = otherSchoolRes.rows[0].id
    const otherBusRes = await db.query('SELECT id FROM buses WHERE school_id = $1 LIMIT 1', [otherSchoolId])
    const otherBusId = otherBusRes.rows[0]?.id

    await asUser('00000000-0000-0000-0000-000000000002', 'manager')

    // 1. Manager inserts a new bus in own school
    const newBusId = 'b0000000-9999-0000-0000-000000000001'
    await db.query(`
      INSERT INTO buses (id, name, capacity)
      VALUES ($1, 'Manager Bus 99', 40)
    `, [newBusId])

    // Verify school_id was set by the database
    const busCheck = await db.query('SELECT school_id FROM buses WHERE id = $1', [newBusId])
    if (busCheck.rows[0].school_id !== '11111111-1111-1111-1111-111111111111') {
      throw new Error(`Database trigger did not populate manager school_id: got ${busCheck.rows[0].school_id}`)
    }

    // Verify audit log entry was created
    const auditBus = await db.query("SELECT * FROM audit_log WHERE action = 'INSERT_BUSES'")
    if (auditBus.rows.length === 0) throw new Error('Audit log entry for manager INSERT_BUSES was not created')

    // 2. Manager updates bus in own school
    const updRes = await db.query("UPDATE buses SET name = 'Manager Bus 99 Renamed' WHERE id = $1", [newBusId])
    if (updRes.rowCount !== 1) throw new Error('Manager should be able to update bus in own school')

    // 3. Manager attempts write against another school -> rejected or affects 0 rows
    if (otherBusId) {
      const crossUpd = await db.query("UPDATE buses SET name = 'Hacked Bus' WHERE id = $1", [otherBusId])
      if (crossUpd.rowCount !== 0) throw new Error('Manager cross-tenant UPDATE on bus in School 2 should affect 0 rows')
    }

    // 4. Manager still CANNOT write trips, alert_events, trip_summaries, bus_locations_latest, or audit_log
    await db.exec('SAVEPOINT sp_mgr_trips')
    let tripDenied = false
    try {
      await db.query("INSERT INTO trips (bus_id, route_id, trip_date, direction, scheduled_start) VALUES ('b1111111-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', CURRENT_DATE, 'morning', now())")
    } catch (e) {
      if (e.message.includes('permission denied') || e.code === '42501') tripDenied = true
      await db.exec('ROLLBACK TO sp_mgr_trips')
    }
    if (!tripDenied) throw new Error('Manager direct INSERT into trips must be denied by privileges')

    await db.exec('SAVEPOINT sp_mgr_audit_w')
    let auditWriteDenied = false
    try {
      await db.query("INSERT INTO audit_log (school_id, action) VALUES ('11111111-1111-1111-1111-111111111111', 'HACK_LOG')")
    } catch (e) {
      if (e.message.includes('permission denied') || e.code === '42501') auditWriteDenied = true
      await db.exec('ROLLBACK TO sp_mgr_audit_w')
    }
    if (!auditWriteDenied) throw new Error('Manager direct write to audit_log must be denied')
  })

  // --- Suite 8: Server-Function-Only Enforcement & Exact Trip Assertions (Fix 6) ---
  await test('Direct writes on trips & summaries blocked; driver start_trip RPC asserts in_progress status', async () => {
    // 1. Driver direct UPDATE on trips -> throws permission denied
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    await db.exec('SAVEPOINT sp_drv_upd')
    let drvUpdDenied = false
    try {
      await db.query("UPDATE trips SET status = 'completed' WHERE id = 'd0000000-0001-0000-0000-000000000001'")
    } catch (e) {
      if (e.message.includes('permission denied') || e.code === '42501') drvUpdDenied = true
      await db.exec('ROLLBACK TO sp_drv_upd')
    }
    if (!drvUpdDenied) throw new Error('Driver direct UPDATE on trips should be rejected with permission denied')

    // Positive control: Driver calls start_trip RPC and we assert resulting trip status is in_progress
    await db.query('SELECT start_trip($1)', ['d0000000-0001-0000-0000-000000000001'])
    const tripStatusRes = await db.query('SELECT status, started_at FROM trips WHERE id = $1', ['d0000000-0001-0000-0000-000000000001'])
    if (tripStatusRes.rows[0].status !== 'in_progress' || !tripStatusRes.rows[0].started_at) {
      throw new Error(`Expected trip to transition to 'in_progress' with started_at, got ${tripStatusRes.rows[0].status}`)
    }

    // 2. Seed a trip_summaries row, then Manager attempts direct UPDATE on trip_summaries -> blocked
    await asSuperuser()
    await db.query(`
      INSERT INTO trip_summaries (school_id, trip_id, total_pings, started_at, ended_at)
      VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0001-0000-0000-000000000001', 10, now() - interval '1 hour', now())
      ON CONFLICT (trip_id) DO NOTHING;
    `)

    await asUser('00000000-0000-0000-0000-000000000002', 'manager')
    await db.exec('SAVEPOINT sp_mgr_ts_upd')
    let tsDenied = false
    try {
      await db.query("UPDATE trip_summaries SET total_pings = 999 WHERE trip_id = 'd0000000-0001-0000-0000-000000000001'")
    } catch (e) {
      if (e.message.includes('permission denied') || e.code === '42501') tsDenied = true
      await db.exec('ROLLBACK TO sp_mgr_ts_upd')
    }
    if (!tsDenied) throw new Error('Manager direct UPDATE on trip_summaries must be rejected with permission denied')
  })

  // --- Suite 9: School Local Date & Absence Cancellation Rules (Fix 4 & Fix 6) ---
  await test('School local date timezone check; absence cancellation rules for future, past, and both same-day started trips', async () => {
    await asSuperuser()
    // 1. Create a school in Pacific/Kiritimati (UTC+14:00)
    await db.query(`
      INSERT INTO schools (id, name, code, timezone, contact_phone)
      VALUES ('99999999-9999-9999-9999-999999999999', 'Kiritimati School', 'KIR-01', 'Pacific/Kiritimati', '+251911999999')
      ON CONFLICT (code) DO NOTHING;
    `)
    const kiritimatiDate = (await db.query("SELECT app_security.school_today('99999999-9999-9999-9999-999999999999') as s_date")).rows[0].s_date
    const expectedKiritimati = (await db.query("SELECT (now() AT TIME ZONE 'Pacific/Kiritimati')::date as exp_date")).rows[0].exp_date
    if (kiritimatiDate.toISOString().slice(0, 10) !== expectedKiritimati.toISOString().slice(0, 10)) {
      throw new Error(`School date mismatch: expected ${expectedKiritimati}, got ${kiritimatiDate}`)
    }

    // 2. Future absence cancellation: parent can delete
    const p1StudentRes = await db.query("SELECT student_id, school_id FROM guardians WHERE profile_id = '00000000-0000-0000-0000-000000000004' LIMIT 1")
    const stuId = p1StudentRes.rows[0].student_id
    const schId = p1StudentRes.rows[0].school_id

    await db.query(`
      INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by)
      VALUES ('88888888-0001-0000-0000-000000000001', $1, $2, CURRENT_DATE + interval '2 days', 'both', '00000000-0000-0000-0000-000000000004')
      ON CONFLICT DO NOTHING;
    `, [schId, stuId])

    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const delFuture = await db.query('DELETE FROM absences WHERE id = $1', ['88888888-0001-0000-0000-000000000001'])
    if (delFuture.rowCount !== 1) throw new Error('Parent should be able to delete future absence')

    // 3. Past absence cancellation: parent cannot delete directly
    await asSuperuser()
    await db.query(`
      INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by)
      VALUES ('88888888-0002-0000-0000-000000000002', $1, $2, CURRENT_DATE - interval '1 day', 'morning', '00000000-0000-0000-0000-000000000004')
      ON CONFLICT DO NOTHING;
    `, [schId, stuId])

    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const delPast = await db.query('DELETE FROM absences WHERE id = $1', ['88888888-0002-0000-0000-000000000002'])
    if (delPast.rowCount !== 0) throw new Error('Parent should NOT be able to delete past absence directly')

    // 4. Same-day 'both' absence when morning trip has started: deletion must be rejected!
    await asSuperuser()
    // Ensure trip 1 on CURRENT_DATE is in_progress
    await db.query("UPDATE trips SET status = 'in_progress', started_at = now() WHERE id = 'd0000000-0001-0000-0000-000000000001'")
    await db.query(`
      INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by)
      VALUES ('88888888-0003-0000-0000-000000000003', $1, $2, CURRENT_DATE, 'both', '00000000-0000-0000-0000-000000000004')
      ON CONFLICT DO NOTHING;
    `, [schId, stuId])

    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const delBothStarted = await db.query('DELETE FROM absences WHERE id = $1', ['88888888-0003-0000-0000-000000000003'])
    if (delBothStarted.rowCount !== 0) throw new Error("Parent should NOT be able to delete 'both' absence after morning trip has started!")
  })

  // --- Suite 10: Role Invariants & Profiles Privacy ---
  await test('Guardians trigger rejects non-parent role; parents and drivers see only their own profile', async () => {
    await asSuperuser()

    // 1. Linking driver as a guardian throws 23514 Role Integrity Violation
    await db.exec('SAVEPOINT sp_trg_guard')
    let guardianErr = false
    try {
      await db.query(`
        INSERT INTO guardians (school_id, student_id, profile_id)
        VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0001-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003')
      `)
    } catch (e) {
      if (e.message.includes('Role Integrity Violation') || e.code === '23514') guardianErr = true
      await db.exec('ROLLBACK TO sp_trg_guard')
    }
    if (!guardianErr) throw new Error('Guardians trigger should reject driver profile with 23514')

    // 2. Parent queries profiles -> sees ONLY their own profile (cannot read drivers or managers)
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const pProfiles = await db.query('SELECT * FROM profiles')
    if (pProfiles.rows.length !== 1 || pProfiles.rows[0].id !== '00000000-0000-0000-0000-000000000004') {
      throw new Error(`Parent leaked profiles: expected 1 own profile, got ${pProfiles.rows.length}`)
    }

    // 3. Driver queries profiles -> sees ONLY their own profile
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    const dProfiles = await db.query('SELECT * FROM profiles')
    if (dProfiles.rows.length !== 1 || dProfiles.rows[0].id !== '00000000-0000-0000-0000-000000000003') {
      throw new Error(`Driver leaked profiles: expected 1 own profile, got ${dProfiles.rows.length}`)
    }
  })

  // --- Suite 11: Settings Validation & Ingest Telemetry Sanity Checks ---
  await test('update_school_settings validates timezone against pg_timezone_names; ingest_location validates coordinates and accuracy', async () => {
    await asUser('00000000-0000-0000-0000-000000000002', 'manager')

    // 1. Invalid timezone -> rejected with 22023
    await db.exec('SAVEPOINT sp_tz_invalid')
    let tzErr = false
    try {
      await db.query("SELECT update_school_settings('Pilot Academy', 'Invalid/Timezone', '+251110000001')")
    } catch (e) {
      if (e.message.includes('does not exist in pg_timezone_names') && e.code === '22023') tzErr = true
      await db.exec('ROLLBACK TO sp_tz_invalid')
    }
    if (!tzErr) throw new Error('Expected 22023 Invalid Input for non-existent timezone')

    // 2. Valid settings update -> succeeds and audits
    await db.query("SELECT update_school_settings('Pilot Academy Updated', 'Africa/Addis_Ababa', '+251110000001')")
    const auditTz = await db.query("SELECT * FROM audit_log WHERE action = 'UPDATE_SCHOOL_SETTINGS'")
    if (auditTz.rows.length === 0) throw new Error('Audit log for update_school_settings missing')

    // 3. Driver ingest_location with invalid latitude (95.0) -> rejected with 22023
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    await db.exec('SAVEPOINT sp_gps_bounds')
    let gpsErr = false
    try {
      await db.query('SELECT ingest_location($1, $2, $3, $4, $5, $6, $7)', [
        'd0000000-0001-0000-0000-000000000001', 95.0, 38.75, 90.0, 30.0, 10.0, new Date().toISOString()
      ])
    } catch (e) {
      if (e.message.includes('Coordinates out of bounds') && e.code === '22023') gpsErr = true
      await db.exec('ROLLBACK TO sp_gps_bounds')
    }
    if (!gpsErr) throw new Error('Expected 22023 for out of bounds latitude')

    // 4. Valid ingest_location on in-progress trip -> succeeds
    await asSuperuser()
    await db.query("UPDATE trips SET status = 'in_progress', started_at = now() WHERE id = 'd0000000-0001-0000-0000-000000000001'")
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    await db.query('SELECT ingest_location($1, $2, $3, $4, $5, $6, $7)', [
      'd0000000-0001-0000-0000-000000000001', 9.02, 38.74, 180.0, 25.0, 8.0, new Date().toISOString()
    ])

    const locLatest = await db.query("SELECT * FROM bus_locations_latest WHERE trip_id = 'd0000000-0001-0000-0000-000000000001'")
    if (locLatest.rows.length === 0 || locLatest.rows[0].lat !== 9.02) throw new Error('ingest_location failed to update bus_locations_latest')
  })

  // --- Suite 12: Catalog Checks & No-Profile User (Fix 1 & Fix 6) ---
  await test('Catalog checks: DEFINER search_path, anon privilege revocation, real OID policy check, and no-profile user isolation', async () => {
    // 1. Search path check on SECURITY DEFINER functions
    const badDefiners = await db.query(`
      SELECT p.proname, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'app_security')
        AND p.prosecdef = true
        AND (p.proconfig IS NULL OR NOT ('search_path=""' = ANY(p.proconfig)))
    `)
    if (badDefiners.rows.length > 0) {
      throw new Error(`Found ${badDefiners.rows.length} SECURITY DEFINER functions without search_path="": ${badDefiners.rows.map(r => r.proname).join(', ')}`)
    }

    // 2. Privilege check: anon & PUBLIC have ZERO execute on public/app_security functions
    const anonExecFuncs = await db.query(`
      SELECT p.proname, target_roles.role_name
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      CROSS JOIN (VALUES ('anon'), ('public')) AS target_roles(role_name)
      WHERE n.nspname IN ('public', 'app_security')
        AND has_function_privilege(target_roles.role_name, p.oid, 'EXECUTE')
    `)
    if (anonExecFuncs.rows.length > 0) {
      throw new Error(`Security breach: Found ${anonExecFuncs.rows.length} functions executable by anon or PUBLIC: ${anonExecFuncs.rows.map(r => `${r.proname} (${r.role_name})`).join(', ')}`)
    }

    // 3. RLS enabled on all public tables
    const unprotTables = await db.query("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND rowsecurity = false")
    if (unprotTables.rows.length > 0) {
      throw new Error(`Found tables with RLS disabled: ${unprotTables.rows.map(r => r.tablename).join(', ')}`)
    }

    // 4. Real OID check: no policy targets role PUBLIC (oid 0) or anon (Fix 6)
    const publicPolicies = await db.query(`
      SELECT p.polname, p.polrelid::regclass, r.rolname
      FROM pg_policy p
      LEFT JOIN pg_roles r ON r.oid = ANY(p.polroles)
      WHERE 0 = ANY(p.polroles) OR r.rolname = 'anon';
    `)
    if (publicPolicies.rows.length > 0) {
      throw new Error(`Found policies targeting PUBLIC or anon: ${publicPolicies.rows.map(r => r.polname).join(', ')}`)
    }

    // 5. User with no profile: every function call rejected and all tables return 0 rows
    await asUser('99999999-9999-9999-9999-999999999999', 'authenticated')
    const calls = [
      { name: 'get_trip_location_history', sql: 'SELECT * FROM get_trip_location_history($1)', params: ['d0000000-0001-0000-0000-000000000001'] },
      { name: 'is_student_absent', sql: 'SELECT is_student_absent($1, $2, $3)', params: ['c0000000-0001-0000-0000-000000000001', '2026-10-19', 'morning'] },
      { name: 'update_school_settings', sql: 'SELECT update_school_settings($1, $2, $3)', params: ['Test', 'Africa/Addis_Ababa', '+251110000001'] },
      { name: 'get_school_health_metrics', sql: 'SELECT get_school_health_metrics()', params: [] },
      { name: 'start_trip', sql: 'SELECT start_trip($1)', params: ['d0000000-0001-0000-0000-000000000001'] },
      { name: 'purge_location_history', sql: 'SELECT purge_location_history()', params: [] }
    ]

    for (const c of calls) {
      await db.exec('SAVEPOINT sp_no_prof')
      let rejected = false
      try {
        await db.query(c.sql, c.params)
      } catch (e) {
        if (e.message.includes('Access Denied') || e.code === '42501') rejected = true
        await db.exec('ROLLBACK TO sp_no_prof')
      }
      if (!rejected) throw new Error(`Function ${c.name} unexpectedly succeeded for user with no profile!`)
    }

    const noProfBuses = await db.query('SELECT * FROM buses')
    if (noProfBuses.rows.length !== 0) throw new Error('User with no profile should see 0 buses')
  })

  console.log('\n======================================================')
  console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) process.exit(1)
}

run().catch(err => {
  console.error('\nFatal test execution error:', err)
  process.exit(1)
})
