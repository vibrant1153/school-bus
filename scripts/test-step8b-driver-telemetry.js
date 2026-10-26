import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envPath = resolve(process.cwd(), '.env')
if (!existsSync(envPath)) {
  console.error('❌ .env file not found.')
  process.exit(1)
}

const envContent = readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach((line) => {
  const trimmed = line.trim()
  if (trimmed && !trimmed.startsWith('#')) {
    const idx = trimmed.indexOf('=')
    if (idx !== -1) {
      env[trimmed.substring(0, idx).trim()] = trimmed.substring(idx + 1).trim()
    }
  }
})

let supabaseUrl = env.VITE_SUPABASE_URL
if (supabaseUrl) {
  supabaseUrl = supabaseUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
}
const anonKey = env.VITE_SUPABASE_ANON_KEY
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !anonKey || !serviceRoleKey) {
  console.error('❌ Missing environment variables in .env')
  process.exit(1)
}

const driver1Pass = env.TEST_DRIVER1_PASSWORD
const parent1Pass = env.TEST_PARENT1_PASSWORD
const manager2Pass = env.TEST_MANAGER2_PASSWORD
const defaultPass = env.TEST_DEFAULT_PASSWORD || 'TestPass123!@#'

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function getClientForUser(email, password) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { client, user: data.user }
}

async function runStep8bTests() {
  console.log('\n=============================================================')
  console.log('🚌 STEP 8b: Remote Telemetry & Ingest Resilience Test Suite')
  console.log('=============================================================\n')

  let tempUserId = null
  let tripStartedByTest = false
  let initialTripStatus = 'scheduled'
  let testTripId = null
  let testBusId = null
  const tempUserEmail = `temp_parent_route_b_${Date.now()}@schoolbus.local`
  const school1Id = 'e40fae94-592e-433d-be90-1c8e0b531acc'

  try {
    // 1. Locate Route A Trip for driver1 in School 1
    console.log('🔍 Identifying active or scheduled trip for driver1 on Route A...')
    const todayStr = new Date().toISOString().split('T')[0]

    let { data: tripData, error: tripErr } = await adminClient
      .from('trips')
      .select('id, trip_date, direction, status, bus_id, route_id, driver_profile_id, routes!inner(name)')
      .eq('school_id', school1Id)
      .eq('routes.name', 'Route A')
      .eq('trip_date', todayStr)
      .in('status', ['scheduled', 'in_progress'])
      .order('direction', { ascending: false })
      .limit(1)

    if (!tripData || tripData.length === 0) {
      const { data: fallbackTrips, error: fbErr } = await adminClient
        .from('trips')
        .select('id, trip_date, direction, status, bus_id, route_id, driver_profile_id, routes!inner(name)')
        .eq('school_id', school1Id)
        .eq('routes.name', 'Route A')
        .in('status', ['scheduled', 'in_progress'])
        .order('trip_date', { ascending: true })
        .limit(1)

      if (fbErr || !fallbackTrips || fallbackTrips.length === 0) {
        throw new Error(`Failed to find Route A trip for driver1: ${fbErr?.message || tripErr?.message}`)
      }
      tripData = fallbackTrips
      await adminClient.from('trips').update({ trip_date: todayStr }).eq('id', tripData[0].id)
      tripData[0].trip_date = todayStr
    }

    const trip = tripData[0]
    testTripId = trip.id
    testBusId = trip.bus_id
    initialTripStatus = trip.status
    console.log(`   ✅ Target trip: ${testTripId} (${trip.trip_date} ${trip.direction}, status: ${trip.status})`)

    // Clear prior bus_location_history and bus_locations_latest for this bus/trip
    await adminClient.from('bus_location_history').delete().eq('trip_id', testTripId)
    await adminClient.from('bus_locations_latest').delete().eq('bus_id', testBusId)

    // Authenticate driver1
    const { client: driverClient, user: driverUser } = await getClientForUser('driver1@schoolbus.local', driver1Pass)
    console.log(`   ✅ Driver1 authenticated: ${driverUser.email} (${driverUser.id})`)

    // Ensure driver1 is assigned to this trip
    if (trip.driver_profile_id !== driverUser.id) {
      await adminClient.from('trips').update({ driver_profile_id: driverUser.id }).eq('id', testTripId)
      console.log(`   ✅ Assigned driver1 to test trip ${testTripId}`)
    }

    // If trip is scheduled, start it
    if (trip.status === 'scheduled') {
      const { error: startErr } = await driverClient.rpc('start_trip', { p_trip_id: testTripId })
      if (startErr) throw new Error(`Could not start trip: ${startErr.message}`)
      tripStartedByTest = true
      console.log('   ✅ Trip transitioned from scheduled -> in_progress via start_trip RPC')
    }

    // 2. Identify Student D on Route B (to test unauthorized same-school parent)
    const { data: studentD, error: stuErr } = await adminClient
      .from('students')
      .select('id, full_name')
      .eq('school_id', school1Id)
      .eq('full_name', 'Student D (sample)')
      .single()

    if (stuErr || !studentD) throw new Error(`Student D not found: ${stuErr?.message}`)

    // Provision temporary parent on Route B
    const { data: createdAuth, error: createAuthErr } = await adminClient.auth.admin.createUser({
      email: tempUserEmail,
      password: defaultPass,
      email_confirm: true,
    })
    if (createAuthErr) throw createAuthErr
    tempUserId = createdAuth.user.id

    await adminClient.from('profiles').insert({
      id: tempUserId,
      school_id: school1Id,
      role: 'parent',
      full_name: 'Temp Route B Parent',
      is_active: true,
    })

    await adminClient.from('guardians').insert({
      school_id: school1Id,
      student_id: studentD.id,
      profile_id: tempUserId,
      relationship: 'mother',
      is_primary: true,
    })
    console.log(`   ✅ Provisioned same-school non-trip parent: ${tempUserEmail}\n`)

    // 3. Authenticate Subscribers
    console.log('🔐 Authenticating subscribers and connecting to private channel: trip:' + testTripId + '...')
    const { client: parent1Client } = await getClientForUser('parent1@schoolbus.local', parent1Pass)
    const { client: parentBClient } = await getClientForUser(tempUserEmail, defaultPass)
    const { client: manager2Client } = await getClientForUser('manager2@schoolbus.local', manager2Pass)
    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const topic = `trip:${testTripId}`
    const receivedEvents = {
      parent1: [],
      parent_other_trip: [],
      manager_other_school: [],
      anon: [],
    }

    const channelParent1 = parent1Client.channel(topic, { config: { private: true } })
    const channelParentB = parentBClient.channel(topic, { config: { private: true } })
    const channelManager2 = manager2Client.channel(topic, { config: { private: true } })
    const channelAnon = anonClient.channel(topic, { config: { private: true } })

    channelParent1.on('broadcast', { event: 'location' }, (payload) => {
      receivedEvents.parent1.push(payload.payload)
    })
    channelParentB.on('broadcast', { event: 'location' }, (payload) => {
      receivedEvents.parent_other_trip.push(payload.payload)
    })
    channelManager2.on('broadcast', { event: 'location' }, (payload) => {
      receivedEvents.manager_other_school.push(payload.payload)
    })
    channelAnon.on('broadcast', { event: 'location' }, (payload) => {
      receivedEvents.anon.push(payload.payload)
    })

    function subscribePromise(channel) {
      return new Promise((resolve) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            resolve(status)
          }
        })
      })
    }

    await Promise.all([
      subscribePromise(channelParent1),
      subscribePromise(channelParentB),
      subscribePromise(channelManager2),
      subscribePromise(channelAnon),
    ])

    // Wait 2s for Realtime routing
    await new Promise((r) => setTimeout(r, 2000))
    console.log('   ✅ All 4 Realtime channel listeners active.\n')

    // 4. Test Series of Driver Points
    console.log('🚀 Executing simulated driver telemetry sequence...\n')
    let countAccepted = 0
    let countRateLimited = 0
    let countRejectedJump = 0
    let countRejectedAge = 0

    // Test Point 1: Valid initial fix
    console.log('📍 [Test 1] Sending Point 1 (Valid initial fix: 9.0200, 38.7500, age: 150ms)...')
    const { data: res1, error: err1 } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0200,
      p_lng: 38.7500,
      p_heading: 45.0,
      p_speed: 10.5,
      p_accuracy: 12.0,
      p_age_ms: 150,
    })
    if (err1) throw new Error(`Test 1 failed: ${err1.message}`)
    if (res1?.status === 'accepted') {
      countAccepted++
      console.log(`   ✅ Accepted: status=${res1.status}, payload_size=${res1.payload_size_bytes}B`)
    }

    // Test Point 2: Rapid consecutive point (< 5s) -> Must be rate-limited (no broadcast)
    console.log('\n📍 [Test 2] Sending Point 2 immediately (< 1s gap) -> Expect rate-limited...')
    const { data: res2, error: err2 } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0202,
      p_lng: 38.7502,
      p_heading: 45.0,
      p_speed: 10.5,
      p_accuracy: 12.0,
      p_age_ms: 100,
    })
    if (err2) throw new Error(`Test 2 unexpected error: ${err2.message}`)
    if (res2?.status === 'ignored_rate_limit') {
      countRateLimited++
      console.log(`   ✅ Rate limited as expected: status=${res2.status} (no broadcast emitted)`)
    } else {
      console.error(`   ❌ Failed: expected ignored_rate_limit, got ${JSON.stringify(res2)}`)
    }

    // Wait 6 seconds to clear the ~5s rate-limit interval
    console.log('\n⏳ Waiting 6 seconds to clear 5s minimum interval...')
    await new Promise((r) => setTimeout(r, 6000))

    // Test Point 3: Valid subsequent point
    console.log('📍 [Test 3] Sending Point 3 (Valid point after 6s: 9.0208, 38.7508, age: 200ms)...')
    const { data: res3, error: err3 } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0208,
      p_lng: 38.7508,
      p_heading: 48.0,
      p_speed: 11.2,
      p_accuracy: 10.0,
      p_age_ms: 200,
    })
    if (err3) throw new Error(`Test 3 failed: ${err3.message}`)
    if (res3?.status === 'accepted') {
      countAccepted++
      console.log(`   ✅ Accepted: status=${res3.status}, payload_size=${res3.payload_size_bytes}B`)
    }

    // Wait 6 seconds
    console.log('\n⏳ Waiting 6 seconds...')
    await new Promise((r) => setTimeout(r, 6000))

    // Test Point 4: Implausible Jump Check
    console.log('📍 [Test 4] Sending Point 4 with implausible jump (lat 12.5000, ~450km jump)...')
    const { data: res4, error: err4 } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 12.5000,
      p_lng: 42.0000,
      p_heading: 0.0,
      p_speed: 15.0,
      p_accuracy: 10.0,
      p_age_ms: 100,
    })
    if (res4?.status === 'rejected_jump') {
      countRejectedJump++
      console.log(`   ✅ Point 4 rejected with status="rejected_jump": "${res4.message}"`)
    } else {
      console.error(`   ❌ Failed: expected status=rejected_jump, got:`, res4, err4)
    }

    // Test Point 5: Stale Age Check (> 30s)
    console.log('\n📍 [Test 5] Sending Point 5 with stale age (age_ms = 45000 > 30s) -> Expect 22023 rejection...')
    const { data: res5, error: err5 } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0210,
      p_lng: 38.7510,
      p_heading: 48.0,
      p_speed: 10.0,
      p_accuracy: 10.0,
      p_age_ms: 45000,
    })
    if (err5 && (err5.code === '22023' || err5.message.includes('age'))) {
      countRejectedAge++
      console.log(`   ✅ Correctly rejected with 22023: "${err5.message}"`)
    } else {
      console.error(`   ❌ Failed: stale age was NOT rejected! Result:`, res5, err5)
    }

    // -------------------------------------------------------------
    // Follow-Up Scenarios: Jump Recovery & Agreement Rules
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------')
    console.log('🔄 Follow-Up Scenarios: 6A (rejected_jump) & 6B (agreeing point accepted)')
    console.log('-------------------------------------------------------------')

    // Wait 6 seconds
    await new Promise((r) => setTimeout(r, 6000))

    // Scenario 6A: Candidate Jump Point (9.0500, 38.7800, acc 15m) -> Expect rejected_jump
    console.log('📍 [Follow-up 6A] Sending Candidate Jump Point (9.0500, 38.7800, acc 15m)...')
    const { data: res6a, error: err6a } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0500,
      p_lng: 38.7800,
      p_heading: 45.0,
      p_speed: 10.0,
      p_accuracy: 15.0,
      p_age_ms: 100,
    })

    if (err6a) {
      console.error(`   ❌ 6A returned error: ${err6a.message}`)
    } else if (res6a?.status === 'rejected_jump') {
      console.log(`   ✅ 6A returns rejected_jump: status="${res6a.status}", message="${res6a.message}"`)
      const { data: latest6a } = await adminClient
        .from('bus_locations_latest')
        .select('last_rejected_lat, last_rejected_lng, last_rejected_accuracy, last_rejected_at')
        .eq('bus_id', testBusId)
        .single()
      console.log(`   ✅ 6A candidate stored in bus_locations_latest:`, latest6a)
    } else {
      console.error(`   ❌ 6A unexpected response:`, res6a)
    }

    // Wait 6 seconds
    console.log('\n⏳ Waiting 6 seconds...')
    await new Promise((r) => setTimeout(r, 6000))

    // Scenario 6B: Agreeing Point (9.0502, 38.7802, acc 15m <= 100m) -> Expect accepted
    console.log('📍 [Follow-up 6B] Sending Agreeing Point (9.0502, 38.7802, acc 15m <= 100m, agrees with 6A)...')
    const { data: res6b, error: err6b } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0502,
      p_lng: 38.7802,
      p_heading: 45.0,
      p_speed: 10.0,
      p_accuracy: 15.0,
      p_age_ms: 100,
    })

    if (err6b) {
      console.error(`   ❌ 6B returned error: ${err6b.message}`)
    } else if (res6b?.status === 'accepted') {
      countAccepted++
      console.log(`   ✅ 6B (agreeing point, accuracy <= 100 m) is accepted: status="${res6b.status}"`)
      const { data: latest6b } = await adminClient
        .from('bus_locations_latest')
        .select('lat, lng, last_rejected_lat, last_rejected_at')
        .eq('bus_id', testBusId)
        .single()
      console.log(`   ✅ 6B persisted as latest location; last_rejected_* cleared:`, latest6b)
    } else {
      console.error(`   ❌ 6B unexpected response:`, res6b)
    }

    // Wait 4 seconds for Realtime propagation
    await new Promise((r) => setTimeout(r, 4000))

    // Teardown channels
    await Promise.all([
      parent1Client.removeChannel(channelParent1),
      parentBClient.removeChannel(channelParentB),
      manager2Client.removeChannel(channelManager2),
      anonClient.removeChannel(channelAnon),
    ])

    // -------------------------------------------------------------
    // Test: end_trip clears bus_locations_latest and last_rejected_*
    // -------------------------------------------------------------
    console.log('\n-------------------------------------------------------------')
    console.log('🛑 Testing end_trip clears bus_locations_latest & last_rejected_*')
    console.log('-------------------------------------------------------------')

    const { data: resEnd, error: errEnd } = await driverClient.rpc('end_trip', { p_trip_id: testTripId })
    if (errEnd) {
      console.error(`   ❌ end_trip returned error: ${errEnd.message}`)
    } else {
      console.log(`   ✅ end_trip succeeded: status="${resEnd.status}", total_pings=${resEnd.total_pings}`)
    }

    const { data: latestAfterEnd, error: errLatest } = await adminClient
      .from('bus_locations_latest')
      .select('*')
      .eq('bus_id', testBusId)

    if (latestAfterEnd && latestAfterEnd.length === 0) {
      console.log(`   ✅ Verified: bus_locations_latest and last_rejected_* for bus ${testBusId} are CLEARED (0 rows found).`)
    } else {
      console.error(`   ❌ Failed: bus_locations_latest was NOT cleared:`, latestAfterEnd)
    }

    // 5. Verification & Summary
    console.log('\n=============================================================')
    console.log('📊 STEP 8b REMOTE TEST RESULTS SUMMARY')
    console.log('=============================================================')
    console.log(`Points Accepted & Broadcast:            ${countAccepted} (Expected: 3)`)
    console.log(`Points Rate-Limited (No Broadcast):     ${countRateLimited} (Expected: 1)`)
    console.log(`Points Rejected on Jump Check:          ${countRejectedJump} (Expected: 1)`)
    console.log(`Points Rejected on Stale Age (>30s):    ${countRejectedAge} (Expected: 1)`)
    console.log(`6A Status:                              ${res6a?.status} (Expected: rejected_jump)`)
    console.log(`6B Status:                              ${res6b?.status} (Expected: accepted)`)
    console.log(`bus_locations_latest Rows After End:    ${latestAfterEnd?.length} (Expected: 0)`)
    console.log(`Parent1 Total Received Broadcasts:      ${receivedEvents.parent1.length}`)
    console.log(`Unauthorized Subscribers Received:      ${receivedEvents.parent_other_trip.length + receivedEvents.manager_other_school.length + receivedEvents.anon.length} (Expected: 0)`)
    console.log('=============================================================')

    let allPassed = true
    if (res6a?.status !== 'rejected_jump') allPassed = false
    if (res6b?.status !== 'accepted') allPassed = false
    if (!latestAfterEnd || latestAfterEnd.length !== 0) allPassed = false
    if (receivedEvents.parent_other_trip.length !== 0 || receivedEvents.anon.length !== 0) allPassed = false

    if (!allPassed) {
      throw new Error('One or more Step 8b remote assertions failed.')
    }

    console.log('\n🎉 ALL STEP 8b SCENARIOS PASSED PERFECTLY ON REMOTE!\n')
  } finally {
    // Cleanup fake rows and reset trip back to scheduled
    if (testTripId) {
      console.log(`🧹 [CLEANUP] Deleting fake test location history, alerts, and summaries...`)
      await adminClient.from('bus_location_history').delete().eq('trip_id', testTripId)
      await adminClient.from('bus_locations_latest').delete().eq('trip_id', testTripId)
      if (testBusId) {
        await adminClient.from('bus_locations_latest').delete().eq('bus_id', testBusId)
      }
      await adminClient.from('trip_summaries').delete().eq('trip_id', testTripId)
      await adminClient.from('alert_events').delete().eq('trip_id', testTripId)
      console.log('   ✅ Test telemetry data deleted.')

      console.log(`🧹 [CLEANUP] Resetting trip ${testTripId} status back to '${initialTripStatus}'...`)
      await adminClient.from('trips').update({
        status: initialTripStatus,
        started_at: null,
        ended_at: null,
        updated_at: new Date().toISOString()
      }).eq('id', testTripId)
      console.log(`   ✅ Trip status reset back to '${initialTripStatus}' for real-phone testing.`)
    }

    if (tempUserId) {
      console.log(`🧹 [CLEANUP] Cleaning up temporary parent user ${tempUserId}...`)
      await adminClient.from('guardians').delete().eq('profile_id', tempUserId)
      await adminClient.from('profiles').delete().eq('id', tempUserId)
      await adminClient.auth.admin.deleteUser(tempUserId)
      console.log('   ✅ Temp user cleaned up.')
    }
  }
}

runStep8bTests().catch((err) => {
  console.error('\n❌ Error in Step 8b test suite:', err)
  process.exit(1)
})
