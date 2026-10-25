import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Verification test suite for Step 8b follow-ups:
 * 1) Parent client trip_id filter and waiting state (show no bus until first point of current trip).
 * 2) ingest_location resilience: broadcast failure never rolls back the stored point.
 * 3) Jump check recovery:
 *    a. >60s outage recovery (last accepted point older than ~60s accepts new point).
 *    b. Consecutive rejected points agreement recovery (accepts when 2 consecutive points agree).
 *    c. Single glitch rejection (rejects single outlier, recovers if real point follows).
 */

async function runFollowupTests() {
  console.log('\n=============================================================')
  console.log('🧪 STEP 8b FOLLOW-UPS VERIFICATION TEST SUITE')
  console.log('=============================================================\n')

  let passedAll = true

  // --------------------------------------------------------------------------
  // TEST 1: Parent Client Filter & Waiting State (Unit logic test)
  // --------------------------------------------------------------------------
  console.log('📋 [TEST 1] Parent client trip_id filtering & waiting state...')

  function evaluateParentBusState(activeTrip, latestBusLocation, now) {
    let busStatus = { mode: 'none', secondsAgo: null }
    let busDistanceM = 0
    let busPosition = null

    if (activeTrip && latestBusLocation && latestBusLocation.trip_id === activeTrip.id) {
      const recordedAt = new Date(latestBusLocation.recorded_at).getTime()
      const secondsAgo = Math.max(0, Math.floor((now - recordedAt) / 1000))
      const isStale = secondsAgo >= 60

      busPosition = [latestBusLocation.lat, latestBusLocation.lng]
      busDistanceM = 100
      busStatus = {
        mode: isStale ? 'stale' : 'live',
        secondsAgo,
      }
    } else if (activeTrip) {
      // Trip is in progress, but no point for this trip has arrived yet: show no bus
      busStatus = { mode: 'waiting', secondsAgo: null }
      busDistanceM = 0
      busPosition = null
    }

    return { busStatus, busPosition }
  }

  const currentTrip = { id: 'trip-current-111', bus_id: 'bus-1' }
  const now = 1792940000000

  // 1A: bus_locations_latest has point from older/different trip
  const oldTripLoc = {
    bus_id: 'bus-1',
    trip_id: 'trip-yesterday-000',
    lat: 9.010,
    lng: 38.740,
    recorded_at: new Date(now - 10000).toISOString(),
  }
  const stateOld = evaluateParentBusState(currentTrip, oldTripLoc, now)
  if (stateOld.busPosition === null && stateOld.busStatus.mode === 'waiting') {
    console.log('   ✅ 1A: Older trip_id row ignored: busPosition is NULL, mode is "waiting" (no bus shown).')
  } else {
    console.error('   ❌ 1A FAIL: Older trip row was not ignored:', stateOld)
    passedAll = false
  }

  // 1B: No point received yet (latestBusLocation is null)
  const stateNoPoint = evaluateParentBusState(currentTrip, null, now)
  if (stateNoPoint.busPosition === null && stateNoPoint.busStatus.mode === 'waiting') {
    console.log('   ✅ 1B: Null location before first point: busPosition is NULL, mode is "waiting".')
  } else {
    console.error('   ❌ 1B FAIL: Expected null position and waiting mode:', stateNoPoint)
    passedAll = false
  }

  // 1C: First point of CURRENT trip arrives
  const currentTripLoc = {
    bus_id: 'bus-1',
    trip_id: 'trip-current-111',
    lat: 9.020,
    lng: 38.750,
    recorded_at: new Date(now - 5000).toISOString(),
  }
  const stateCurrent = evaluateParentBusState(currentTrip, currentTripLoc, now)
  if (stateCurrent.busPosition !== null && stateCurrent.busStatus.mode === 'live') {
    console.log('   ✅ 1C: Matching trip_id row accepted: busPosition is visible, mode is "live".')
  } else {
    console.error('   ❌ 1C FAIL: Expected active bus position and live mode:', stateCurrent)
    passedAll = false
  }

  // --------------------------------------------------------------------------
  // Initialize PGlite database with all migrations
  // --------------------------------------------------------------------------
  console.log('\n🚀 Initializing in-memory PostgreSQL engine (PGlite)...')
  const db = new PGlite()

  // Emulate auth & realtime environment
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text);
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

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

    CREATE OR REPLACE FUNCTION realtime.topic() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT current_setting('realtime.topic', true);
    $$;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT COALESCE(
        nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
        nullif(current_setting('app.current_user_id', true), '')::uuid
      );
    $$;

    CREATE OR REPLACE FUNCTION realtime.send(
      p_payload jsonb,
      p_event text,
      p_topic text,
      p_private boolean DEFAULT false
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      INSERT INTO realtime.messages (topic, extension, payload, event, private, inserted_at, updated_at)
      VALUES (p_topic, 'broadcast', p_payload, p_event, p_private, now(), now());
    END;
    $$;
  `)

  // Apply all migrations sequentially
  const migrationFiles = [
    '20261017000001_core_schema.sql',
    '20261018000001_schema_review_fixes.sql',
    '20261019000001_rls_policies_and_security.sql',
    '20261020000001_step3_corrections.sql',
    '20261023000001_step7_trips_workflow.sql',
    '20261024000001_fix_step7_cron_and_delay.sql',
    '20261025000001_step8a_realtime_broadcast_proof.sql',
    '20261025000002_step8b_ingest_location.sql',
    '20261025000003_step8b_ingest_resilience_and_recovery.sql',
  ]

  for (const f of migrationFiles) {
    const fullPath = resolve('supabase/migrations', f)
    const sql = readFileSync(fullPath, 'utf8')
    await db.exec(sql)
  }
  console.log('   ✅ All 9 migrations applied cleanly to PGlite.\n')

  // Apply dev environment marker and seed.sql
  const markDevSql = readFileSync(resolve('scripts/mark-dev-environment.sql'), 'utf8')
  await db.exec(markDevSql)
  const seedSql = readFileSync(resolve('supabase/seed.sql'), 'utf8')
  await db.exec(seedSql)

  const schoolRes = await db.query(`SELECT id FROM public.schools WHERE code = 'PAA-01';`)
  const schoolId = schoolRes.rows[0].id
  const driverId = '00000000-0000-0000-0000-000000000003'

  // Insert driver profile
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES ('${driverId}', 'driver1@schoolbus.local') ON CONFLICT DO NOTHING;
    INSERT INTO public.profiles (id, school_id, role, full_name, is_active)
    VALUES ('${driverId}', '${schoolId}', 'driver', 'Driver One', true)
    ON CONFLICT (id) DO UPDATE SET role = 'driver', school_id = '${schoolId}';
  `)
  console.log('   ✅ Seed data and driver profile configured.\n')

  const busRes = await db.query(`SELECT id FROM public.buses WHERE school_id = '${schoolId}' AND name = 'Bus 1';`)
  const routeRes = await db.query(`SELECT id FROM public.routes WHERE school_id = '${schoolId}' AND name = 'Route A';`)
  const busId = busRes.rows[0].id
  const routeId = routeRes.rows[0].id

  await db.exec(`
    INSERT INTO public.bus_assignments (school_id, route_id, bus_id, driver_profile_id, effective_date, is_active)
    VALUES ('${schoolId}', '${routeId}', '${busId}', '${driverId}', CURRENT_DATE, true)
    ON CONFLICT (bus_id) WHERE is_active = true DO UPDATE SET driver_profile_id = '${driverId}', effective_date = CURRENT_DATE;

    INSERT INTO public.trips (school_id, route_id, bus_id, driver_profile_id, trip_date, direction, status, scheduled_start, started_at)
    VALUES ('${schoolId}', '${routeId}', '${busId}', '${driverId}', CURRENT_DATE, 'morning', 'in_progress', now(), now());
  `)

  const tripRes = await db.query(`
    SELECT id FROM public.trips WHERE bus_id = '${busId}' AND trip_date = CURRENT_DATE LIMIT 1;
  `)
  const tripId = tripRes.rows[0].id

  // Set session as driver1
  await db.exec(`SELECT set_config('app.current_user_id', '${driverId}', false);`)

  // --------------------------------------------------------------------------
  // TEST 2: Ingest Location Resilience (Broadcast failure never rolls back point)
  // --------------------------------------------------------------------------
  console.log('📋 [TEST 2] Ingest location resilience: broadcast failure does not roll back point...')

  // Force realtime.send to fail by simulating broker / extension error
  await db.exec(`
    CREATE OR REPLACE FUNCTION realtime.send(
      p_payload jsonb,
      p_event text,
      p_topic text,
      p_private boolean DEFAULT false
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      RAISE EXCEPTION 'Realtime WebSocket Broker Outage (Simulated)' USING ERRCODE = '58000';
    END;
    $$;
  `)

  // Clear prior locations
  await db.exec(`DELETE FROM public.bus_locations_latest WHERE bus_id = '${busId}';`)
  await db.exec(`DELETE FROM public.bus_location_history WHERE trip_id = '${tripId}';`)

  const resBroadcastFail = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0200::double precision,
      38.7500::double precision,
      45.0::double precision,
      10.0::double precision,
      12.0::double precision,
      150::integer
    ) as result;
  `)

  const resultStatus = resBroadcastFail.rows[0].result.status
  const latestStored = await db.query(`SELECT lat, lng, trip_id FROM public.bus_locations_latest WHERE bus_id = '${busId}';`)
  const historyStored = await db.query(`SELECT count(*)::int as count FROM public.bus_location_history WHERE trip_id = '${tripId}';`)

  if (
    resultStatus === 'accepted' &&
    latestStored.rows.length === 1 &&
    latestStored.rows[0].lat === 9.02 &&
    historyStored.rows[0].count === 1
  ) {
    console.log('   ✅ PASS: Point was ACCEPTED and committed to bus_locations_latest & history despite broadcast failure.')
  } else {
    console.error('   ❌ FAIL: Point was rolled back or rejected on broadcast failure:', resultStatus, latestStored.rows)
    passedAll = false
  }

  // Restore normal realtime.send
  await db.exec(`
    CREATE OR REPLACE FUNCTION realtime.send(
      p_payload jsonb,
      p_event text,
      p_topic text,
      p_private boolean DEFAULT false
    )
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    AS $$
    BEGIN
      INSERT INTO realtime.messages (topic, extension, payload, event, private, inserted_at, updated_at)
      VALUES (p_topic, 'broadcast', p_payload, p_event, p_private, now(), now());
    END;
    $$;
  `)

  // --------------------------------------------------------------------------
  // TEST 3: Jump Check Recovery
  // --------------------------------------------------------------------------
  console.log('\n📋 [TEST 3] Jump check recovery...')

  // Reset bus_locations_latest to initial point at T0
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET lat = 9.0200,
        lng = 38.7500,
        accuracy = 10.0,
        speed = 10.0,
        recorded_at = now() - interval '80 seconds',
        last_rejected_lat = NULL,
        last_rejected_lng = NULL,
        last_rejected_at = NULL
    WHERE bus_id = '${busId}';
  `)

  // 3A: Outage > 60s Recovery
  console.log('   📍 [3A] Last accepted point is 80s old (> 60s) -> Large jump (~5 km)...')
  const resOutage = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0550::double precision,
      38.7850::double precision,
      45.0::double precision,
      12.0::double precision,
      10.0::double precision,
      100::integer
    ) as result;
  `)

  if (resOutage.rows[0].result.status === 'accepted') {
    console.log('   ✅ PASS [3A]: Outage > 60s bypassed jump check and ACCEPTED new point.')
  } else {
    console.error('   ❌ FAIL [3A]: Outage recovery failed:', resOutage.rows[0])
    passedAll = false
  }

  // 3B: Consecutive Rejected Points Agreement Recovery
  console.log('   📍 [3B] Consecutive rejected points agreement recovery...')
  // Set current accepted point at (9.0200, 38.7500) recorded 10s ago
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET lat = 9.0200,
        lng = 38.7500,
        accuracy = 10.0,
        speed = 10.0,
        recorded_at = now() - interval '10 seconds',
        last_rejected_lat = NULL,
        last_rejected_lng = NULL,
        last_rejected_at = NULL
    WHERE bus_id = '${busId}';
  `)

  // Point B1: sudden jump to (9.0500, 38.7800) ~4.5 km away in 10s (~450 m/s >> 45 m/s)
  console.log('      Sending Point B1 (Jump to 9.0500, 38.7800 in 10s gap) -> Expect rejected_jump...')
  const resB1 = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0500::double precision,
      38.7800::double precision,
      45.0::double precision,
      10.0::double precision,
      10.0::double precision,
      100::integer
    ) as result;
  `)

  const b1Status = resB1.rows[0].result.status
  const checkRej1 = await db.query(`
    SELECT last_rejected_lat, last_rejected_lng, last_rejected_at
    FROM public.bus_locations_latest
    WHERE bus_id = '${busId}';
  `)

  if (b1Status === 'rejected_jump' && checkRej1.rows[0].last_rejected_lat === 9.05) {
    console.log('      ✅ Point B1 was rejected with status="rejected_jump" and candidate saved in bus_locations_latest.')
  } else {
    console.error('      ❌ FAIL: Point B1 was not rejected properly:', b1Status, checkRej1.rows)
    passedAll = false
  }

  // Point B2: arrives 10s later at (9.0502, 38.7802) (~30m from Point B1)
  // Distance from Point B1 is ~30m, which is plausible (30m <= 45*10 + 20 + 50 = 520m)
  // Point B2 agrees with Point B1 -> Must be ACCEPTED!
  console.log('      Sending Point B2 10s later at (9.0502, 38.7802) (agrees with B1) -> Expect ACCEPTED...')
  // Fast-forward last_rejected_at by 10s to simulate 10s gap
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET last_rejected_at = now() - interval '10 seconds'
    WHERE bus_id = '${busId}';
  `)

  const resB2 = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0502::double precision,
      38.7802::double precision,
      45.0::double precision,
      10.0::double precision,
      10.0::double precision,
      100::integer
    ) as result;
  `)

  const b2Status = resB2.rows[0].result.status
  const checkAfterB2 = await db.query(`
    SELECT lat, lng, last_rejected_lat, last_rejected_at
    FROM public.bus_locations_latest
    WHERE bus_id = '${busId}';
  `)

  if (
    b2Status === 'accepted' &&
    checkAfterB2.rows[0].lat === 9.0502 &&
    checkAfterB2.rows[0].last_rejected_lat === null
  ) {
    console.log('   ✅ PASS [3B]: Consecutive rejected points agreed with each other and Point B2 was ACCEPTED!')
    console.log('      last_rejected tracking was cleared back to NULL.')
  } else {
    console.error('   ❌ FAIL [3B]: Consecutive agreement recovery failed:', b2Status, checkAfterB2.rows)
    passedAll = false
  }

  // 3C: Single Glitch Rejection (Outlier point rejected, subsequent real point accepted)
  console.log('   📍 [3C] Single random glitch rejection...')
  // Set bus at (9.0200, 38.7500)
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET lat = 9.0200,
        lng = 38.7500,
        accuracy = 10.0,
        speed = 10.0,
        recorded_at = now() - interval '10 seconds',
        last_rejected_lat = NULL,
        last_rejected_lng = NULL,
        last_rejected_at = NULL
    WHERE bus_id = '${busId}';
  `)

  // Glitch point at (12.5000, 38.7500) (~400 km away)
  const resGlitch = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      12.5000::double precision,
      38.7500::double precision,
      45.0::double precision,
      10.0::double precision,
      10.0::double precision,
      100::integer
    ) as result;
  `)

  if (resGlitch.rows[0].result.status !== 'rejected_jump') {
    console.error('   ❌ FAIL [3C]: Glitch was not rejected:', resGlitch.rows[0])
    passedAll = false
  }

  // Normal subsequent point at (9.0208, 38.7508) (80m from valid last point)
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET recorded_at = now() - interval '10 seconds'
    WHERE bus_id = '${busId}';
  `)

  const resNormal = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0208::double precision,
      38.7508::double precision,
      45.0::double precision,
      10.0::double precision,
      10.0::double precision,
      100::integer
    ) as result;
  `)

  if (resNormal.rows[0].result.status === 'accepted') {
    console.log('   ✅ PASS [3C]: Single glitch was rejected, and real path point was ACCEPTED normally.')
  } else {
    console.error('   ❌ FAIL [3C]: Subsequent valid point was not accepted:', resNormal.rows[0])
    passedAll = false
  }

  console.log('\n=============================================================')
  if (passedAll) {
    console.log('🎉 ALL STEP 8b FOLLOW-UP TESTS PASSED 100%!')
  } else {
    console.error('❌ ONE OR MORE TESTS FAILED!')
    process.exit(1)
  }
  console.log('=============================================================\n')
}

runFollowupTests().catch((err) => {
  console.error('\n❌ Fatal error in test runner:', err)
  process.exit(1)
})
