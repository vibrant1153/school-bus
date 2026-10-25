import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execSync } from 'node:child_process'
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

const manager1Pass = env.TEST_MANAGER1_PASSWORD
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

async function runRealtimeProof() {
  console.log('\n=============================================================')
  console.log('📡 STEP 8a: Supabase Realtime Private Broadcast Proof Test')
  console.log('    Extended with 2 Positive Controls + 3 Negative Controls')
  console.log('=============================================================\n')

  let tempUserId = null
  const tempUserEmail = `temp_parent_route_b_${Date.now()}@schoolbus.local`
  const school1Id = 'e40fae94-592e-433d-be90-1c8e0b531acc'

  try {
    // 1. Identify Target Trip on Route A in School 1
    console.log('🔍 Finding test trip on Route A in School 1...')
    const { data: tripData, error: tripErr } = await adminClient
      .from('trips')
      .select('id, trip_date, direction, school_id, route:routes!inner(id, name, code)')
      .eq('school_id', school1Id)
      .eq('routes.name', 'Route A')
      .eq('direction', 'morning')
      .order('trip_date', { ascending: false })
      .limit(1)

    if (tripErr || !tripData || tripData.length === 0) {
      throw new Error(`Failed to find Route A trip: ${tripErr?.message}`)
    }

    const testTrip = tripData[0]
    const testTripId = testTrip.id
    const topic = `trip:${testTripId}`
    console.log(`   ✅ Target trip: ${testTripId} (${testTrip.trip_date} morning, ${testTrip.route.name})`)
    console.log(`   📡 Realtime Topic: "${topic}"\n`)

    // 2. Identify Student D on Route B (to link same-school parent on another trip)
    console.log('🔍 Finding Student D on Route B for same-school non-trip parent...')
    const { data: studentD, error: stuErr } = await adminClient
      .from('students')
      .select('id, full_name')
      .eq('school_id', school1Id)
      .eq('full_name', 'Student D (sample)')
      .single()

    if (stuErr || !studentD) {
      throw new Error(`Failed to find Student D: ${stuErr?.message}`)
    }
    console.log(`   ✅ Linked student: ${studentD.full_name} (${studentD.id})\n`)

    // 3. Provision temporary same-school parent on Route B
    console.log(`👤 Provisioning temporary parent for Route B: ${tempUserEmail}...`)
    const { data: createdAuth, error: createAuthErr } = await adminClient.auth.admin.createUser({
      email: tempUserEmail,
      password: defaultPass,
      email_confirm: true,
    })
    if (createAuthErr) throw createAuthErr
    tempUserId = createdAuth.user.id

    // Insert profile
    const { error: profErr } = await adminClient.from('profiles').insert({
      id: tempUserId,
      school_id: school1Id,
      role: 'parent',
      full_name: 'Temp Route B Parent',
      is_active: true,
    })
    if (profErr) throw profErr

    // Insert guardian record linking to Student D
    const { error: guardErr } = await adminClient.from('guardians').insert({
      school_id: school1Id,
      student_id: studentD.id,
      profile_id: tempUserId,
      relationship: 'mother',
      is_primary: true,
    })
    if (guardErr) throw guardErr
    console.log(`   ✅ Created and linked temp parent ID: ${tempUserId}\n`)

    // 4. Authenticate 5 Test Subscribers
    console.log('🔐 Authenticating 5 test subscribers (2 positive controls, 3 negative controls)...')

    // Positive Control 1: parent1 (Child on Route A -> MUST receive trip broadcast)
    const { client: parent1Client } = await getClientForUser('parent1@schoolbus.local', parent1Pass)
    console.log('   ✅ 1. parent1@schoolbus.local (Child on Route A) [POSITIVE CONTROL: EXPECT RECEIVE]')

    // Positive Control 2: manager1 (Manager of SAME School 1 -> MUST receive broadcast)
    const { client: manager1Client } = await getClientForUser('manager1@schoolbus.local', manager1Pass)
    console.log('   ✅ 2. manager1@schoolbus.local (Manager of SAME school) [POSITIVE CONTROL: EXPECT RECEIVE]')

    // Negative Control 1: parent_other_trip (Child on Route B -> MUST NOT receive)
    const { client: parentBClient } = await getClientForUser(tempUserEmail, defaultPass)
    console.log('   ✅ 3. parent_other_trip (Same school, different route) [NEGATIVE CONTROL: EXPECT DENIED]')

    // Negative Control 2: manager2 (Manager of School 2 -> MUST NOT receive)
    const { client: manager2Client } = await getClientForUser('manager2@schoolbus.local', manager2Pass)
    console.log('   ✅ 4. manager2@schoolbus.local (Manager of DIFFERENT school) [NEGATIVE CONTROL: EXPECT DENIED]')

    // Negative Control 3: anon (Unauthenticated -> MUST NOT receive)
    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    console.log('   ✅ 5. anon (Unauthenticated client) [NEGATIVE CONTROL: EXPECT DENIED]\n')

    // 5. Setup Realtime Channels with private: true
    console.log('🔌 Connecting all 5 subscribers to private channel: ' + topic + '...')

    const receivedEvents = {
      parent1: [],
      manager1_same_school: [],
      parent_other_trip: [],
      manager_other_school: [],
      anon: [],
    }

    const channelParent1 = parent1Client.channel(topic, { config: { private: true } })
    const channelManager1 = manager1Client.channel(topic, { config: { private: true } })
    const channelParentB = parentBClient.channel(topic, { config: { private: true } })
    const channelManager2 = manager2Client.channel(topic, { config: { private: true } })
    const channelAnon = anonClient.channel(topic, { config: { private: true } })

    channelParent1.on('broadcast', { event: '*' }, (payload) => {
      console.log('   📩 [parent1 - RIGHT PARENT] RECEIVED TRIP-LEVEL BROADCAST:', payload)
      receivedEvents.parent1.push(payload)
    })

    channelManager1.on('broadcast', { event: '*' }, (payload) => {
      console.log('   📩 [manager1 - SAME SCHOOL MANAGER] RECEIVED BROADCAST:', payload)
      receivedEvents.manager1_same_school.push(payload)
    })

    channelParentB.on('broadcast', { event: '*' }, (payload) => {
      console.log('   🚨 [parent_other_trip] UNEXPECTED BROADCAST RECEIVED:', payload)
      receivedEvents.parent_other_trip.push(payload)
    })

    channelManager2.on('broadcast', { event: '*' }, (payload) => {
      console.log('   🚨 [manager_other_school] UNEXPECTED BROADCAST RECEIVED:', payload)
      receivedEvents.manager_other_school.push(payload)
    })

    channelAnon.on('broadcast', { event: '*' }, (payload) => {
      console.log('   🚨 [anon] UNEXPECTED BROADCAST RECEIVED:', payload)
      receivedEvents.anon.push(payload)
    })

    // Helper to await subscription
    function subscribePromise(channel, name) {
      return new Promise((resolve) => {
        channel.subscribe((status, err) => {
          console.log(`   [${name}] status: ${status}${err ? ' error: ' + JSON.stringify(err) : ''}`)
          if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            resolve(status)
          }
        })
      })
    }

    const [st1, st2, st3, st4, st5] = await Promise.all([
      subscribePromise(channelParent1, 'parent1'),
      subscribePromise(channelManager1, 'manager1_same_school'),
      subscribePromise(channelParentB, 'parent_other_trip'),
      subscribePromise(channelManager2, 'manager_other_school'),
      subscribePromise(channelAnon, 'anon'),
    ])

    console.log('\n   Subscription states established.')
    // Pause to allow WebSocket router to register channel authorizations
    await new Promise((r) => setTimeout(r, 2000))

    // 6. Send trip-level broadcast via realtime.send() in Postgres
    console.log('\n🚀 Triggering trip-level broadcast via realtime.send in PostgreSQL...')
    const broadcastPayload = {
      lat: 9.0234,
      lng: 38.7512,
      speed: 12.4,
      accuracy: 10.0,
      timestamp: Date.now(),
      event_type: 'trip_location_ping',
      proof: 'step8a_extended_verification',
    }

    const tempSqlPath = resolve(process.cwd(), 'scripts', 'temp_trigger_broadcast.sql')
    const sqlContent = `
      SELECT realtime.send(
        '${JSON.stringify(broadcastPayload)}'::jsonb,
        'location',
        'trip:${testTripId}',
        true
      );
    `
    writeFileSync(tempSqlPath, sqlContent, 'utf8')

    try {
      const output = execSync(`npx supabase db query --linked --file "${tempSqlPath}"`, {
        encoding: 'utf8',
      })
      console.log('   ✅ PostgreSQL realtime.send executed successfully.')
      console.log('   Query output:', output.trim())
    } finally {
      if (existsSync(tempSqlPath)) unlinkSync(tempSqlPath)
    }

    // 7. Wait for propagation
    console.log('\n⏳ Waiting 5 seconds for Realtime message routing and policy enforcement...')
    await new Promise((r) => setTimeout(r, 5000))

    // 8. Teardown channels
    await Promise.all([
      parent1Client.removeChannel(channelParent1),
      manager1Client.removeChannel(channelManager1),
      parentBClient.removeChannel(channelParentB),
      manager2Client.removeChannel(channelManager2),
      anonClient.removeChannel(channelAnon),
    ])

    // 9. Report Results
    console.log('\n=============================================================')
    console.log('📊 STEP 8a EXTENDED REALTIME BROADCAST RESULTS')
    console.log('=============================================================')
    console.log(`[+] 1. parent1 (right parent, child on trip):     ${receivedEvents.parent1.length} message(s) received`)
    console.log(`[+] 2. manager1 (SAME school manager):            ${receivedEvents.manager1_same_school.length} message(s) received`)
    console.log(`[-] 3. parent_other_trip (child on Route B):      ${receivedEvents.parent_other_trip.length} message(s) received`)
    console.log(`[-] 4. manager2 (DIFFERENT school manager):       ${receivedEvents.manager_other_school.length} message(s) received`)
    console.log(`[-] 5. anon (unauthenticated client):             ${receivedEvents.anon.length} message(s) received`)
    console.log('=============================================================')

    let allPassed = true

    if (receivedEvents.parent1.length >= 1) {
      console.log('✅ PASS (Positive Control 1): Trip-level message reached the right parent (parent1).')
    } else {
      console.error('❌ FAIL (Positive Control 1): parent1 did NOT receive the message!')
      allPassed = false
    }

    if (receivedEvents.manager1_same_school.length >= 1) {
      console.log('✅ PASS (Positive Control 2): Manager of the SAME school (manager1) received the broadcast.')
    } else {
      console.error('❌ FAIL (Positive Control 2): manager1 did NOT receive the broadcast!')
      allPassed = false
    }

    if (receivedEvents.parent_other_trip.length === 0) {
      console.log('✅ PASS (Negative Control 1): Same-school parent on another trip was DENIED (received 0).')
    } else {
      console.error('❌ FAIL (Negative Control 1): parent_other_trip leaked message!')
      allPassed = false
    }

    if (receivedEvents.manager_other_school.length === 0) {
      console.log('✅ PASS (Negative Control 2): Different-school manager was DENIED (received 0).')
    } else {
      console.error('❌ FAIL (Negative Control 2): manager2 leaked message!')
      allPassed = false
    }

    if (receivedEvents.anon.length === 0) {
      console.log('✅ PASS (Negative Control 3): Anon client was DENIED (received 0).')
    } else {
      console.error('❌ FAIL (Negative Control 3): anon leaked message!')
      allPassed = false
    }

    if (!allPassed) {
      throw new Error('Realtime authorization proof tests failed.')
    }

    console.log('\n🎉 ALL 5 REALTIME AUTHORIZATION PROOFS (2 POSITIVE + 3 NEGATIVE) PASSED!\n')
  } finally {
    if (tempUserId) {
      console.log(`🧹 Cleaning up temporary parent user ${tempUserId}...`)
      await adminClient.from('guardians').delete().eq('profile_id', tempUserId)
      await adminClient.from('profiles').delete().eq('id', tempUserId)
      await adminClient.auth.admin.deleteUser(tempUserId)
      console.log('   ✅ Temp user cleaned up successfully.')
    }
  }
}

runRealtimeProof().catch((err) => {
  console.error('\n❌ Error executing Realtime proof:', err)
  process.exit(1)
})
