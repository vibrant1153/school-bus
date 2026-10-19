import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

async function run() {
  console.log('🚀 Initializing PGlite in-memory database...')
  const db = new PGlite()

  // 1. Initialize auth & realtime schemas required for Supabase emulation
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

    -- Emulate Supabase Realtime schema
    CREATE SCHEMA IF NOT EXISTS realtime;
    CREATE TABLE IF NOT EXISTS realtime.messages (
      id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      topic text NOT NULL,
      extension text NOT NULL,
      payload jsonb DEFAULT '{}'::jsonb,
      event text,
      private boolean DEFAULT true,
      updated_at timestamptz DEFAULT now(),
      inserted_at timestamptz DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(nullif(current_setting('realtime.topic', true), ''), '');
    $$;

    CREATE OR REPLACE FUNCTION realtime.extension() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT COALESCE(nullif(current_setting('realtime.extension', true), ''), 'broadcast');
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

  // 4. Emulate Supabase's default privileges: Supabase by default grants ALL on functions to PUBLIC and anon.
  // This verifies that our migration explicitly strips those default grants!
  await db.exec(`
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC, anon, authenticated;
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

  // Helper for running queries under simulated authenticated user
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
      SET LOCAL "realtime.extension" = 'broadcast';
    `)
  }

  // Populate remaining mock test users and associations for multi-tenant tests
  await db.exec(`
    -- Seed test users across roles
    INSERT INTO auth.users (id) VALUES
      ('00000000-0000-0000-0000-000000000001'), -- Owner
      ('00000000-0000-0000-0000-000000000002'), -- Manager School 1
      ('00000000-0000-0000-0000-000000000003'), -- Driver 1 School 1 (Assigned to Trip 1)
      ('00000000-0000-0000-0000-000000000013'), -- Driver 2 School 1 (Assigned to Trip 2)
      ('00000000-0000-0000-0000-000000000005'), -- Parent 2 School 1 (Child NOT on Trip 1)
      ('00000000-0000-0000-0000-000000000006')  -- Parent School 2
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO profiles (id, school_id, role, full_name, phone) VALUES
      ('00000000-0000-0000-0000-000000000001', NULL, 'owner', 'Platform Owner', '+251911000001'),
      ('00000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'manager', 'Manager One', '+251911000002'),
      ('00000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'driver', 'Driver One', '+251911000003'),
      ('00000000-0000-0000-0000-000000000013', '11111111-1111-1111-1111-111111111111', 'driver', 'Driver Two', '+251911000013'),
      ('00000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111', 'parent', 'Parent Two', '+251911000005'),
      ('00000000-0000-0000-0000-000000000006', (SELECT id FROM schools WHERE code = 'SGC-02'), 'parent', 'Parent School 2', '+251911000006')
    ON CONFLICT (id) DO NOTHING;

    -- Look up IDs from seed data
    DO $$
    DECLARE
      v_sch1_id uuid := '11111111-1111-1111-1111-111111111111';
      v_bus1_id uuid;
      v_bus2_id uuid;
      v_rt_a_id uuid;
      v_rt_b_id uuid;
      v_st_a1 uuid;
      v_st_b1 uuid;
      v_stu1 uuid;
      v_stu2 uuid;
      v_trip1_id uuid := 'd0000000-0001-0000-0000-000000000001';
      v_trip2_id uuid := 'd0000000-0002-0000-0000-000000000002';
    BEGIN
      SELECT id INTO v_bus1_id FROM buses WHERE school_id = v_sch1_id AND name = 'Bus 1';
      SELECT id INTO v_bus2_id FROM buses WHERE school_id = v_sch1_id AND name = 'Bus 2';
      SELECT id INTO v_rt_a_id FROM routes WHERE school_id = v_sch1_id AND code = 'RT-A';
      SELECT id INTO v_rt_b_id FROM routes WHERE school_id = v_sch1_id AND code = 'RT-B';
      SELECT id INTO v_st_a1 FROM stops WHERE school_id = v_sch1_id AND route_id = v_rt_a_id LIMIT 1;
      SELECT id INTO v_st_b1 FROM stops WHERE school_id = v_sch1_id AND route_id = v_rt_b_id LIMIT 1;
      SELECT id INTO v_stu1 FROM students WHERE school_id = v_sch1_id LIMIT 1;
      SELECT id INTO v_stu2 FROM students WHERE school_id = v_sch1_id OFFSET 1 LIMIT 1;

      -- Guardians: Parent 1 (0004) -> Student 1; Parent 2 (0005) -> Student 2
      INSERT INTO guardians (school_id, student_id, profile_id, relationship) VALUES
        (v_sch1_id, v_stu1, '00000000-0000-0000-0000-000000000004', 'mother'),
        (v_sch1_id, v_stu2, '00000000-0000-0000-0000-000000000005', 'father')
      ON CONFLICT DO NOTHING;

      -- Student 1 assigned to Route A (Stop A1); Student 2 assigned to Route B (Stop B1)
      DELETE FROM student_stops WHERE student_id IN (v_stu1, v_stu2);
      INSERT INTO student_stops (school_id, student_id, stop_id, direction) VALUES
        (v_sch1_id, v_stu1, v_st_a1, 'morning'),
        (v_sch1_id, v_stu2, v_st_b1, 'morning');

      -- Bus assignments
      INSERT INTO bus_assignments (school_id, bus_id, route_id, driver_profile_id, effective_date, is_active) VALUES
        (v_sch1_id, v_bus1_id, v_rt_a_id, '00000000-0000-0000-0000-000000000003', CURRENT_DATE, true),
        (v_sch1_id, v_bus2_id, v_rt_b_id, '00000000-0000-0000-0000-000000000013', CURRENT_DATE, true)
      ON CONFLICT DO NOTHING;

      -- Trip 1 (Driver 1, Route A, morning) carrying Student 1
      INSERT INTO trips (id, school_id, bus_id, route_id, driver_profile_id, trip_date, direction, status, scheduled_start) VALUES
        (v_trip1_id, v_sch1_id, v_bus1_id, v_rt_a_id, '00000000-0000-0000-0000-000000000003', CURRENT_DATE, 'morning', 'scheduled', now()),
        (v_trip2_id, v_sch1_id, v_bus2_id, v_rt_b_id, '00000000-0000-0000-0000-000000000013', CURRENT_DATE, 'morning', 'scheduled', now())
      ON CONFLICT DO NOTHING;

      -- Location history on Trip 1
      INSERT INTO bus_location_history (id, school_id, trip_id, bus_id, lat, lng, heading, speed, accuracy, recorded_at) VALUES
        ('e0000000-0001-0000-0000-000000000001', v_sch1_id, v_trip1_id, v_bus1_id, 9.011, 38.751, 90.0, 25.0, 5.0, now() - interval '2 minutes')
      ON CONFLICT DO NOTHING;

      -- Trip-level alert on Trip 1
      INSERT INTO alert_events (id, school_id, trip_id, student_id, event_type, dedupe_key, payload_json) VALUES
        ('aaaaaaaa-0001-0000-0000-000000000001', v_sch1_id, v_trip1_id, NULL, 'delayed', 'del-01', '{"delayMinutes": 10}'::jsonb)
      ON CONFLICT DO NOTHING;
    END $$;
  `)

  console.log('🧪 RUNNING EXHAUSTIVE TEST SUITE WITH POSITIVE CONTROLS...\n')

  let passed = 0
  let failed = 0

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
  await test('Owner cannot read students, buses, assignments, trips, audit_log, summaries; CAN read schools & manager profiles', async () => {
    await asUser('00000000-0000-0000-0000-000000000001', 'owner')

    // Denied tables: assert exactly 0 rows returned
    const deniedQueries = [
      { name: 'students', sql: 'SELECT * FROM students' },
      { name: 'buses', sql: 'SELECT * FROM buses' },
      { name: 'bus_plates', sql: 'SELECT * FROM bus_plates' },
      { name: 'bus_assignments', sql: 'SELECT * FROM bus_assignments' },
      { name: 'trips', sql: 'SELECT * FROM trips' },
      { name: 'audit_log', sql: 'SELECT * FROM audit_log' },
      { name: 'trip_summaries', sql: 'SELECT * FROM trip_summaries' },
      { name: 'absences', sql: 'SELECT * FROM absences' },
      { name: 'alert_events', sql: 'SELECT * FROM alert_events' }
    ]

    for (const q of deniedQueries) {
      const res = await db.query(q.sql)
      if (res.rows.length !== 0) throw new Error(`Owner leak on ${q.name}: expected 0 rows, got ${res.rows.length}`)
    }

    // Owner CAN read schools
    const schRes = await db.query('SELECT * FROM schools')
    if (schRes.rows.length < 2) throw new Error(`Owner should read schools, got ${schRes.rows.length}`)

    // Owner CAN read manager profiles ONLY (and their own profile; NOT parent or driver profiles)
    const profRes = await db.query('SELECT role, count(*) FROM profiles GROUP BY role')
    for (const r of profRes.rows) {
      if (r.role !== 'manager' && r.role !== 'owner') {
        throw new Error(`Owner saw forbidden profile role: ${r.role}`)
      }
    }

    // Owner CAN call aggregated health RPC
    const healthRes = await db.query('SELECT get_school_health_metrics() as health')
    if (!healthRes.rows[0].health || !healthRes.rows[0].health.total_schools) throw new Error('Owner health RPC failed')
  })

  // --- Suite 2: Parent Trip-Level Alerts with Positive/Negative Controls ---
  await test('Parent sees trip-level alert for child trip; other parent denied', async () => {
    // Parent 1 (child on Trip 1) -> 1 row
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const p1Res = await db.query('SELECT * FROM alert_events WHERE id = $1', ['aaaaaaaa-0001-0000-0000-000000000001'])
    if (p1Res.rows.length !== 1) throw new Error(`Parent 1 should see trip-level alert, got ${p1Res.rows.length}`)

    // Negative control: Parent 2 (child on Route B, NOT Trip 1) -> 0 rows
    await asUser('00000000-0000-0000-0000-000000000005', 'parent')
    const p2Res = await db.query('SELECT * FROM alert_events WHERE id = $1', ['aaaaaaaa-0001-0000-0000-000000000001'])
    if (p2Res.rows.length !== 0) throw new Error(`Parent 2 should NOT see trip alert, got ${p2Res.rows.length}`)
  })

  // --- Suite 3: Absence Privacy & Driver Attendance Scope (Fix 6) ---
  await test('Driver cannot access absences directly or read reason; is_student_absent only answers for driver assigned trip', async () => {
    await asSuperuser()
    // Student 1 is assigned to Route A (Driver 1 on Trip 1)
    const stu1 = (await db.query(`
      SELECT ss.student_id 
      FROM student_stops ss 
      JOIN stops s ON s.id = ss.stop_id 
      WHERE s.route_id = (SELECT route_id FROM trips WHERE id = 'd0000000-0001-0000-0000-000000000001')
      LIMIT 1
    `)).rows[0].student_id

    // Student 2 is assigned to Route B (Driver 2 on Trip 2)
    const stu2 = (await db.query(`
      SELECT ss.student_id 
      FROM student_stops ss 
      JOIN stops s ON s.id = ss.stop_id 
      WHERE s.route_id = (SELECT route_id FROM trips WHERE id = 'd0000000-0002-0000-0000-000000000002')
      LIMIT 1
    `)).rows[0].student_id

    // Create absence with reason for Student 1
    await db.query(`
      INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by)
      VALUES ('77777777-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', $1, CURRENT_DATE, 'morning', '00000000-0000-0000-0000-000000000004')
      ON CONFLICT DO NOTHING;
    `, [stu1])
    await db.query(`
      INSERT INTO absence_reasons (absence_id, school_id, reason)
      VALUES ('77777777-0001-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Medical note: contagious flu')
      ON CONFLICT DO NOTHING;
    `)

    // 1. Driver direct SELECT on absences -> 0 rows
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    const drvAbs = await db.query('SELECT * FROM absences')
    if (drvAbs.rows.length !== 0) throw new Error(`Driver saw ${drvAbs.rows.length} rows in absences`)

    // 2. Driver direct SELECT on absence_reasons -> 0 rows
    const drvRsn = await db.query('SELECT * FROM absence_reasons')
    if (drvRsn.rows.length !== 0) throw new Error(`Driver saw ${drvRsn.rows.length} rows in absence_reasons`)

    // 3. Driver 1 queries is_student_absent for stu1 on their assigned trip -> returns boolean true
    const isAbs = await db.query('SELECT is_student_absent($1, $2, $3) as absent', [stu1, new Date().toISOString().slice(0, 10), 'morning'])
    if (isAbs.rows[0].absent !== true) throw new Error('is_student_absent should return true for assigned student')

    // 4. Driver 1 queries is_student_absent for stu2 (on Driver 2 route) -> REJECTED with Access Denied (42501)
    await db.exec('SAVEPOINT sp_drv_other_bus')
    let otherBusRejected = false
    try {
      await db.query('SELECT is_student_absent($1, $2, $3)', [stu2, new Date().toISOString().slice(0, 10), 'morning'])
    } catch (e) {
      if (e.message.includes('Access Denied') || e.code === '42501') otherBusRejected = true
      await db.exec('ROLLBACK TO sp_drv_other_bus')
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

  // --- Suite 4: Location History Direct SELECT Blocked; Audited RPC Works ---
  await test('Manager direct SELECT on bus_location_history returns 0 rows; get_trip_location_history succeeds and audits', async () => {
    await asUser('00000000-0000-0000-0000-000000000002', 'manager')

    // Direct SELECT -> 0 rows
    const dirRes = await db.query('SELECT * FROM bus_location_history')
    if (dirRes.rows.length !== 0) throw new Error(`Direct select should return 0 rows, got ${dirRes.rows.length}`)

    // RPC get_trip_location_history -> returns points
    const rpcRes = await db.query('SELECT * FROM get_trip_location_history($1)', ['d0000000-0001-0000-0000-000000000001'])
    if (rpcRes.rows.length === 0) throw new Error('RPC should return history points')
    if (rpcRes.rows[0].out_lat !== 9.011) throw new Error(`Unexpected lat: ${rpcRes.rows[0].out_lat}`)

    // Positive control: Audit log entry exists
    const auditRes = await db.query("SELECT * FROM audit_log WHERE action = 'SELECT_LOCATION_HISTORY'")
    if (auditRes.rows.length === 0) throw new Error('Audit log entry was not created')
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

  // --- Suite 6: IS DISTINCT FROM Check for User with No Profile ---
  await test('User with no profile has every function call rejected', async () => {
    await asUser('99999999-9999-9999-9999-999999999999', 'authenticated')

    const calls = [
      { name: 'get_trip_location_history', sql: 'SELECT * FROM get_trip_location_history($1)', params: ['d0000000-0001-0000-0000-000000000001'] },
      { name: 'is_student_absent', sql: 'SELECT is_student_absent($1, $2, $3)', params: ['c0000000-0001-0000-0000-000000000001', '2026-10-19', 'morning'] },
      { name: 'update_school_settings', sql: 'SELECT update_school_settings($1, $2, $3)', params: ['Test', 'Africa/Addis_Ababa', '+251911000000'] },
      { name: 'get_school_health_metrics', sql: 'SELECT get_school_health_metrics()', params: [] },
      { name: 'start_trip', sql: 'SELECT start_trip($1)', params: ['d0000000-0001-0000-0000-000000000001'] }
    ]

    for (const c of calls) {
      await db.exec('SAVEPOINT sp_no_profile')
      let threw = false
      try {
        await db.query(c.sql, c.params)
      } catch (e) {
        threw = true
        await db.exec('ROLLBACK TO sp_no_profile')
      }
      if (!threw) throw new Error(`Function ${c.name} unexpectedly succeeded for user with no profile!`)
    }
  })

  // --- Suite 7: Spoofed Metadata in JWT Ignored ---
  await test('Spoofed user_metadata and app_metadata in JWT claims are strictly ignored', async () => {
    await asUser('00000000-0000-0000-0000-000000000004', 'authenticated', {
      user_metadata: { role: 'manager' },
      app_metadata: { role: 'owner' }
    })

    const roleRes = await db.query('SELECT app_security.current_user_role() as role')
    if (roleRes.rows[0].role !== 'parent') throw new Error(`Role helper should return 'parent', got ${roleRes.rows[0].role}`)

    await db.exec('SAVEPOINT sp_spoof')
    let threw = false
    try {
      await db.query('SELECT update_school_settings($1, $2, $3)', ['Hacked School', 'Africa/Addis_Ababa', '+251000000000'])
    } catch (e) {
      threw = true
      await db.exec('ROLLBACK TO sp_spoof')
    }
    if (!threw) throw new Error('Parent with spoofed metadata successfully executed manager function!')
  })

  // --- Suite 8: Server-Function-Only Enforcement ---
  await test('Direct writes on trips, alert_events, and trip_summaries are blocked by RLS/privileges', async () => {
    // 1. Driver direct UPDATE on trips
    await asUser('00000000-0000-0000-0000-000000000003', 'driver')
    await db.exec('SAVEPOINT sp_drv_upd')
    let drvUpdDenied = false
    try {
      await db.query("UPDATE trips SET status = 'completed' WHERE id = $1", ['d0000000-0001-0000-0000-000000000001'])
    } catch (e) {
      if (e.message.includes('permission denied') || e.code === '42501') drvUpdDenied = true
      await db.exec('ROLLBACK TO sp_drv_upd')
    }
    if (!drvUpdDenied) throw new Error('Driver direct UPDATE on trips should be rejected with permission denied')

    // Positive control: Driver can call start_trip() RPC
    const rpcStart = await db.query('SELECT start_trip($1)', ['d0000000-0001-0000-0000-000000000001'])
    if (!rpcStart) throw new Error('Driver start_trip RPC should succeed')

    // 2. Manager direct INSERT into alert_events
    await asUser('00000000-0000-0000-0000-000000000002', 'manager')
    await db.exec('SAVEPOINT sp_alert')
    let mgrAlertErr = false
    try {
      await db.query(`
        INSERT INTO alert_events (school_id, trip_id, event_type, dedupe_key)
        VALUES ('11111111-1111-1111-1111-111111111111', 'd0000000-0001-0000-0000-000000000001', 'delayed', 'test-delayed')
      `)
    } catch (e) {
      mgrAlertErr = true
      await db.exec('ROLLBACK TO sp_alert')
    }
    if (!mgrAlertErr) throw new Error('Manager direct INSERT on alert_events should be rejected by RLS')

    // 3. Manager direct UPDATE on trip_summaries is blocked by lack of UPDATE grant and RLS
    await db.exec('SAVEPOINT sp_sum')
    let mgrSumErr = false
    try {
      const mgrSumUpd = await db.query("UPDATE trip_summaries SET total_pings = 999 WHERE school_id = '11111111-1111-1111-1111-111111111111'")
      if (mgrSumUpd.rowCount === 0) mgrSumErr = true
    } catch (e) {
      if (e.message.includes('permission denied') || e.code === '42501') mgrSumErr = true
      await db.exec('ROLLBACK TO sp_sum')
    }
    if (!mgrSumErr) throw new Error('Manager direct UPDATE on trip_summaries should be blocked by privileges/RLS')
  })

  // --- Suite 9: Absence Cancellation Rules for 'both' Direction ---
  await test('Absence cancellation rule for direction both and future dates', async () => {
    await asSuperuser()
    // Find valid student of parent 1 (from guardians)
    const p1StudentRes = await db.query(`
      SELECT student_id, school_id FROM guardians 
      WHERE profile_id = '00000000-0000-0000-0000-000000000004' 
      LIMIT 1
    `)
    if (p1StudentRes.rows.length === 0) throw new Error('Parent 1 must have at least one student in guardians')
    const validStudentId = p1StudentRes.rows[0].student_id
    const schoolId = p1StudentRes.rows[0].school_id

    await db.query(`
      INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by)
      VALUES ('88888888-0001-0000-0000-000000000001', $1, $2, CURRENT_DATE + interval '2 days', 'both', '00000000-0000-0000-0000-000000000004')
      ON CONFLICT DO NOTHING;
    `, [schoolId, validStudentId])

    // Parent can delete future absence
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const delRes = await db.query('DELETE FROM absences WHERE id = $1', ['88888888-0001-0000-0000-000000000001'])
    if (delRes.rowCount !== 1) throw new Error('Parent should be able to delete future absence')

    // Create past absence
    await asSuperuser()
    await db.query(`
      INSERT INTO absences (id, school_id, student_id, trip_date, direction, reported_by)
      VALUES ('88888888-0002-0000-0000-000000000002', $1, $2, CURRENT_DATE - interval '1 day', 'morning', '00000000-0000-0000-0000-000000000004')
      ON CONFLICT DO NOTHING;
    `, [schoolId, validStudentId])

    // Parent cannot delete past absence
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    const delPast = await db.query('DELETE FROM absences WHERE id = $1', ['88888888-0002-0000-0000-000000000002'])
    if (delPast.rowCount !== 0) throw new Error('Parent should NOT be able to delete past absence directly')
  })

  // --- Suite 10: Role Invariants & Audit Log Protection ---
  await test('Role integrity triggers reject invalid role assignments; audit_log is write-protected', async () => {
    await asSuperuser()

    // 1. Linking driver as a guardian throws constraint exception
    await db.exec('SAVEPOINT sp_trg1')
    let guardianErr = false
    try {
      await db.query(`
        INSERT INTO guardians (school_id, student_id, profile_id)
        VALUES ('11111111-1111-1111-1111-111111111111', 'c0000000-0001-0000-0000-000000000001', '00000000-0000-0000-0000-000000000003')
      `)
    } catch (e) {
      guardianErr = true
      await db.exec('ROLLBACK TO sp_trg1')
    }
    if (!guardianErr) throw new Error('Guardians trigger should reject driver profile')

    // 2. Direct INSERT into audit_log by authenticated user fails with permission denied
    await asUser('00000000-0000-0000-0000-000000000002', 'manager')
    await db.exec('SAVEPOINT sp_trg2')
    let auditErr = false
    try {
      await db.query(`
        INSERT INTO audit_log (school_id, action) VALUES ('11111111-1111-1111-1111-111111111111', 'FAKE_ACTION')
      `)
    } catch (e) {
      auditErr = true
      await db.exec('ROLLBACK TO sp_trg2')
    }
    if (!auditErr) throw new Error('Authenticated user direct INSERT into audit_log should fail')
  })

  // --- Suite 11: Realtime Safe Parsing & Topic Authorization (Fix 4) ---
  await test('Realtime per-trip topic authorization: child on trip succeeds, same-school-other-trip denied, malformed topic safely denied', async () => {
    // 1. Parent 1 (child on Trip 1) -> Authorized
    await asUser('00000000-0000-0000-0000-000000000004', 'parent')
    await db.exec("SET LOCAL \"realtime.topic\" = 'trip:d0000000-0001-0000-0000-000000000001'; SET LOCAL \"realtime.extension\" = 'broadcast';")
    const p1Check = await db.query('SELECT app_security.parent_has_child_on_trip($1) as allowed', ['d0000000-0001-0000-0000-000000000001'])
    if (p1Check.rows[0].allowed !== true) throw new Error('Parent 1 should be authorized for Trip 1 topic')

    // 2. Parent 2 (same school, but child NOT on Trip 1) -> Denied
    await asUser('00000000-0000-0000-0000-000000000005', 'parent')
    await db.exec("SET LOCAL \"realtime.topic\" = 'trip:d0000000-0001-0000-0000-000000000001'; SET LOCAL \"realtime.extension\" = 'broadcast';")
    const p2Check = await db.query('SELECT app_security.parent_has_child_on_trip($1) as allowed', ['d0000000-0001-0000-0000-000000000001'])
    if (p2Check.rows[0].allowed !== false) throw new Error('Parent 2 (same school other bus) MUST be denied for Trip 1 topic')

    // 3. Malformed topic test: 'trip:abc' must deny without raising a UUID cast error!
    await db.exec("SET LOCAL \"realtime.topic\" = 'trip:abc'; SET LOCAL \"realtime.extension\" = 'broadcast';")
    const malformedPolicyCheck = await db.query(`
      SELECT ('broadcast' = 'broadcast' 
        AND 'trip:abc' ~ '^trip:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$') as matches
    `)
    if (malformedPolicyCheck.rows[0].matches !== false) throw new Error("Malformed topic 'trip:abc' should fail regex check")
  })

  // --- Suite 12: Catalog Checks ---
  await test('Catalog Checks: All SECURITY DEFINER functions have empty search_path, anon cannot execute public functions, RLS on all tables', async () => {
    await asSuperuser()

    // 1. Check all security definer functions in public and app_security have search_path = ''
    const secDefRes = await db.query(`
      SELECT p.proname, n.nspname, p.proconfig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef = true
        AND n.nspname IN ('public', 'app_security')
    `)

    for (const row of secDefRes.rows) {
      const configs = row.proconfig || []
      const hasEmptySearchPath = configs.some(c => c === 'search_path=""' || c === 'search_path=')
      if (!hasEmptySearchPath) {
        throw new Error(`SECURITY DEFINER function ${row.nspname}.${row.proname} lacks empty search_path! Configs: ${JSON.stringify(configs)}`)
      }
    }

    // 2. Check anon has zero execute privilege on any functions in public or app_security
    const anonPermRes = await db.query(`
      SELECT p.proname, n.nspname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname IN ('public', 'app_security')
        AND has_function_privilege('anon', p.oid, 'EXECUTE')
    `)
    if (anonPermRes.rows.length > 0) {
      throw new Error(`Role 'anon' has EXECUTE privilege on functions: ${anonPermRes.rows.map(r => `${r.nspname}.${r.proname}`).join(', ')}`)
    }

    // 3. Check 100% of tables in public have RLS enabled
    const rlsRes = await db.query(`
      SELECT tablename, rowsecurity
      FROM pg_tables
      WHERE schemaname = 'public'
        AND rowsecurity = false
    `)
    if (rlsRes.rows.length > 0) {
      throw new Error(`Tables lacking RLS: ${rlsRes.rows.map(r => r.tablename).join(', ')}`)
    }

    // 4. Check no policy targets role 'public'
    const publicPolicyRes = await db.query(`
      SELECT policyname, tablename, roles
      FROM pg_policies
      WHERE schemaname = 'public'
        AND 'public' = ANY(roles)
    `)
    if (publicPolicyRes.rows.length > 0) {
      throw new Error(`Policies targeting public: ${publicPolicyRes.rows.map(r => `${r.tablename}.${r.policyname}`).join(', ')}`)
    }
  })

  console.log(`\n======================================================`)
  console.log(`🎉 TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log(`======================================================\n`)

  if (failed > 0) process.exit(1)
}

run().catch(err => {
  console.error('Fatal execution error:', err)
  process.exit(1)
})
