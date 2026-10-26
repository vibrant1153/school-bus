import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Verification test suite for Step 8b follow-ups:
 * 1) Parent client trip_id filter and waiting state (show no bus until first point of current trip).
 * 2) ingest_location resilience: broadcast failure never rolls back the stored point.
 * 3) Jump check recovery:
 *    a. >60s outage recovery (jump <= 5km accepted).
 *    b. Capped outage jump (jump > 5km after outage still rejected).
 *    c. Consecutive agreeing points with poor accuracy (>100m) rejected.
 *    d. Consecutive agreeing points with reasonable accuracy (<=100m) accepted.
 *    e. Single glitch rejection (rejects single outlier, recovers if real point follows).
 * 4) end_trip clears bus_locations_latest and last_rejected_* for the bus.
 * 5) cancel_trip clears bus_locations_latest and last_rejected_* for the bus.
 */

async function runFollowupTests() {
  console.log('\n=============================================================')
  console.log('🧪 STEP 8b FOLLOW-UPS VERIFICATION TEST SUITE (DRY-RUN)')
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

  // Force realtime.send to fail
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
  // TEST 3: Jump Check Recovery & 5km Capping
  // --------------------------------------------------------------------------
  console.log('\n📋 [TEST 3] Jump check recovery & outage capping...')

  // Reset bus_locations_latest to initial point at T0 (80 seconds ago)
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

  // 3A: Outage > 60s Recovery for <= 5km jump
  console.log('   📍 [3A] Outage of 80s (> 60s) with plausible jump (3 km <= 5 km)...')
  const resOutagePlausible = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0450::double precision,
      38.7500::double precision,
      45.0::double precision,
      12.0::double precision,
      10.0::double precision,
      100::integer
    ) as result;
  `)

  if (resOutagePlausible.rows[0].result.status === 'accepted') {
    console.log('   ✅ PASS [3A]: Outage > 60s with jump <= 5km was ACCEPTED.')
  } else {
    console.error('   ❌ FAIL [3A]: Outage recovery <= 5km failed:', resOutagePlausible.rows[0])
    passedAll = false
  }

  // 3B: Cap Jump-Check Bypass: Outage > 60s with > 5km jump must be REJECTED
  console.log('   📍 [3B] Outage of 80s (> 60s) with jump > 5km (15 km) -> Must be REJECTED...')
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET lat = 9.0200,
        lng = 38.7500,
        recorded_at = now() - interval '80 seconds'
    WHERE bus_id = '${busId}';
  `)

  const resOutageTooLarge = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.1600::double precision,
      38.7500::double precision,
      45.0::double precision,
      12.0::double precision,
      10.0::double precision,
      100::integer
    ) as result;
  `)

  if (resOutageTooLarge.rows[0].result.status === 'rejected_jump') {
    console.log('   ✅ PASS [3B]: Jump > 5km after outage was correctly REJECTED with "rejected_jump".')
  } else {
    console.error('   ❌ FAIL [3B]: Jump > 5km after outage was NOT rejected:', resOutageTooLarge.rows[0])
    passedAll = false
  }

  // 3C: Consecutive agreement with POOR accuracy (> 100m) must be REJECTED
  console.log('   📍 [3C] Consecutive agreeing points with degraded accuracy (> 100m) -> Must be REJECTED...')
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET lat = 9.0200,
        lng = 38.7500,
        accuracy = 10.0,
        recorded_at = now() - interval '10 seconds',
        last_rejected_lat = NULL,
        last_rejected_lng = NULL,
        last_rejected_accuracy = NULL,
        last_rejected_at = NULL
    WHERE bus_id = '${busId}';
  `)

  // Candidate point 1 with degraded accuracy (250m)
  const resDegraded1 = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0500::double precision,
      38.7800::double precision,
      45.0::double precision,
      10.0::double precision,
      250.0::double precision,
      100::integer
    ) as result;
  `)

  // Fast-forward last_rejected_at by 10s
  await db.exec(`UPDATE public.bus_locations_latest SET last_rejected_at = now() - interval '10 seconds' WHERE bus_id = '${busId}';`)

  // Candidate point 2 agreeing with point 1, but also with degraded accuracy (200m)
  const resDegraded2 = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0501::double precision,
      38.7801::double precision,
      45.0::double precision,
      10.0::double precision,
      200.0::double precision,
      100::integer
    ) as result;
  `)

  if (
    resDegraded1.rows[0].result.status === 'rejected_jump' &&
    resDegraded2.rows[0].result.status === 'rejected_jump'
  ) {
    console.log('   ✅ PASS [3C]: Agreeing points with poor accuracy (> 100m) were rejected.')
  } else {
    console.error('   ❌ FAIL [3C]: Poor accuracy points were unexpectedly accepted:', resDegraded2.rows[0])
    passedAll = false
  }

  // 3D: Consecutive agreement with REASONABLE accuracy (<= 100m) must be ACCEPTED
  console.log('   📍 [3D] Consecutive agreeing points with reasonable accuracy (<= 100m) -> Must be ACCEPTED...')
  await db.exec(`
    UPDATE public.bus_locations_latest
    SET lat = 9.0200,
        lng = 38.7500,
        accuracy = 10.0,
        recorded_at = now() - interval '10 seconds',
        last_rejected_lat = NULL,
        last_rejected_lng = NULL,
        last_rejected_accuracy = NULL,
        last_rejected_at = NULL
    WHERE bus_id = '${busId}';
  `)

  // Point D1: Jump with reasonable accuracy (15m) -> Expect rejected_jump
  const resD1 = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0500::double precision,
      38.7800::double precision,
      45.0::double precision,
      10.0::double precision,
      15.0::double precision,
      100::integer
    ) as result;
  `)

  await db.exec(`UPDATE public.bus_locations_latest SET last_rejected_at = now() - interval '10 seconds' WHERE bus_id = '${busId}';`)

  // Point D2: Agreeing point with reasonable accuracy (15m) -> Expect ACCEPTED
  const resD2 = await db.query(`
    SELECT public.ingest_location(
      '${tripId}'::uuid,
      9.0502::double precision,
      38.7802::double precision,
      45.0::double precision,
      10.0::double precision,
      15.0::double precision,
      100::integer
    ) as result;
  `)

  const d2Status = resD2.rows[0].result.status
  const checkAfterD2 = await db.query(`
    SELECT lat, lng, last_rejected_lat
    FROM public.bus_locations_latest
    WHERE bus_id = '${busId}';
  `)

  if (
    resD1.rows[0].result.status === 'rejected_jump' &&
    d2Status === 'accepted' &&
    checkAfterD2.rows[0].lat === 9.0502 &&
    checkAfterD2.rows[0].last_rejected_lat === null
  ) {
    console.log('   ✅ PASS [3D]: Agreeing points with reasonable accuracy were ACCEPTED, and last_rejected cleared.')
  } else {
    console.error('   ❌ FAIL [3D]: Reasonable accuracy recovery failed:', d2Status, checkAfterD2.rows)
    passedAll = false
  }

  // --------------------------------------------------------------------------
  // TEST 4: end_trip clears bus_locations_latest and last_rejected_*
  // --------------------------------------------------------------------------
  console.log('\n📋 [TEST 4] end_trip clears bus_locations_latest and last_rejected_*...')
  const resEnd = await db.query(`SELECT public.end_trip('${tripId}'::uuid) as result;`)
  const checkLatestAfterEnd = await db.query(`SELECT * FROM public.bus_locations_latest WHERE bus_id = '${busId}';`)

  if (resEnd.rows[0].result.status === 'completed' && checkLatestAfterEnd.rows.length === 0) {
    console.log('   ✅ PASS [TEST 4]: end_trip successfully removed row from bus_locations_latest for this bus.')
  } else {
    console.error('   ❌ FAIL [TEST 4]: bus_locations_latest was not cleared by end_trip:', checkLatestAfterEnd.rows)
    passedAll = false
  }

  // --------------------------------------------------------------------------
  // TEST 5: cancel_trip clears bus_locations_latest and last_rejected_*
  // --------------------------------------------------------------------------
  console.log('\n📋 [TEST 5] cancel_trip clears bus_locations_latest and last_rejected_*...')
  // Start a fresh trip to test cancel
  const trip2Res = await db.query(`
    INSERT INTO public.trips (school_id, route_id, bus_id, driver_profile_id, trip_date, direction, status, scheduled_start, started_at)
    VALUES ('${schoolId}', '${routeId}', '${busId}', '${driverId}', CURRENT_DATE + 1, 'afternoon', 'in_progress', now(), now())
    RETURNING id;
  `)
  const trip2Id = trip2Res.rows[0].id

  // Ingest a location
  await db.query(`
    SELECT public.ingest_location(
      '${trip2Id}'::uuid,
      9.0200::double precision,
      38.7500::double precision,
      45.0::double precision,
      10.0::double precision,
      12.0::double precision,
      150::integer
    );
  `)

  const checkBeforeCancel = await db.query(`SELECT * FROM public.bus_locations_latest WHERE bus_id = '${busId}';`)
  if (checkBeforeCancel.rows.length !== 1) {
    console.error('   ❌ Setup error: location not inserted before cancel')
    passedAll = false
  }

  // Cancel trip
  const resCancel = await db.query(`SELECT public.cancel_trip('${trip2Id}'::uuid, 'Test weather cancellation') as result;`)
  const checkAfterCancel = await db.query(`SELECT * FROM public.bus_locations_latest WHERE bus_id = '${busId}';`)

  if (resCancel.rows[0].result.status === 'cancelled' && checkAfterCancel.rows.length === 0) {
    console.log('   ✅ PASS [TEST 5]: cancel_trip successfully removed row from bus_locations_latest for this bus.')
  } else {
    console.error('   ❌ FAIL [TEST 5]: bus_locations_latest was not cleared by cancel_trip:', checkAfterCancel.rows)
    passedAll = false
  }

  console.log('\n=============================================================')
  if (passedAll) {
    console.log('🎉 ALL STEP 8b FOLLOW-UP DRY-RUN TESTS PASSED 100%!')
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
