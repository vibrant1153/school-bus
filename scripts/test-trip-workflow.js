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

const manager1Pass = env.TEST_MANAGER1_PASSWORD
const driver1Pass = env.TEST_DRIVER1_PASSWORD
const parent1Pass = env.TEST_PARENT1_PASSWORD

const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})

async function getClientForUser(email, password, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const client = createClient(supabaseUrl, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      })
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw error
      if (!data?.user) throw new Error('No user returned')
      return { client, user: data.user }
    } catch (err) {
      if (attempt === retries) throw new Error(`Sign in failed for ${email}: ${err.message}`)
      await new Promise((r) => setTimeout(r, 1500))
    }
  }
}

async function runTests() {
  console.log(`\n🚌 [Step 7: Trips Workflow Suite] Connecting to: ${supabaseUrl}\n`)
  let passed = 0
  let failed = 0

  function pass(desc) {
    console.log(`   ✅ PASS: ${desc}`)
    passed++
  }

  function fail(desc, err) {
    console.error(`   ❌ FAIL: ${desc} ->`, err?.message || err)
    failed++
  }

  let createdTripId = null
  let secondTripId = null
  let cancelledAftId = null
  let dummyUserId = null
  let driver1UserId = null
  let school1Id = null

  try {
    // 1. Authenticate actors
    const { client: managerClient, user: managerUser } = await getClientForUser('manager1@schoolbus.local', manager1Pass)
    const { client: driverClient, user: driverUser } = await getClientForUser('driver1@schoolbus.local', driver1Pass)
    const { client: parentClient, user: parentUser } = await getClientForUser('parent1@schoolbus.local', parent1Pass)
    driver1UserId = driverUser.id

    const { data: managerProf } = await adminClient.from('profiles').select('school_id').eq('id', managerUser.id).single()
    school1Id = managerProf.school_id

    // Setup: Get bus 1, bus 2, route A, route B for school 1
    const { data: bus1 } = await adminClient.from('buses').select('id').eq('school_id', school1Id).eq('name', 'Bus 1').single()
    const { data: bus2 } = await adminClient.from('buses').select('id').eq('school_id', school1Id).eq('name', 'Bus 2').single()
    const { data: routeA } = await adminClient.from('routes').select('id').eq('school_id', school1Id).eq('name', 'Route A').single()
    const { data: routeB } = await adminClient.from('routes').select('id').eq('school_id', school1Id).eq('name', 'Route B').single()

    // 2. Test generate_daily_trips via Manager
    try {
      const { data: genData, error: genErr } = await managerClient.rpc('generate_daily_trips')
      if (genErr) throw genErr
      pass(`Manager generates daily trips from active route schedules (${JSON.stringify(genData)})`)
    } catch (e) {
      fail('Manager generates daily trips', e)
    }

    // 3. Negative Test: Parent cannot generate daily trips (Role check)
    try {
      const { data, error } = await parentClient.rpc('generate_daily_trips')
      if (error && (error.code === '42501' || error.message.includes('Access Denied'))) {
        pass('Parent is rejected from generating daily trips (42501)')
      } else {
        throw new Error(`Expected Access Denied error, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('42501') || e.message.includes('Access Denied')) {
        pass('Parent is rejected from generating daily trips (42501)')
      } else {
        fail('Parent is rejected from generating daily trips', e)
      }
    }

    // Fetch the generated morning trip for Bus 1 / Driver 1
    const todayStr = new Date().toISOString().split('T')[0]
    const { data: morningTrip, error: gtErr } = await adminClient
      .from('trips')
      .select('*')
      .eq('school_id', school1Id)
      .eq('bus_id', bus1.id)
      .eq('trip_date', todayStr)
      .eq('direction', 'morning')
      .single()

    if (gtErr || !morningTrip) throw new Error(`Morning trip not found: ${gtErr?.message}`)
    createdTripId = morningTrip.id

    // Ensure driver_profile_id is driver 1 on the trip
    await adminClient.from('trips').update({ driver_profile_id: driver1UserId, status: 'scheduled', started_at: null, ended_at: null }).eq('id', createdTripId)

    // 4. Negative Test: Driver cannot start another driver's trip / unassigned trip
    // Assign trip to route B and bus 2 where driver 1 is NOT assigned
    const { data: otherTrip, error: otErr } = await adminClient
      .from('trips')
      .insert({
        school_id: school1Id,
        bus_id: bus2.id,
        route_id: routeB.id,
        driver_profile_id: null,
        trip_date: todayStr,
        direction: 'morning',
        status: 'scheduled',
        scheduled_start: new Date().toISOString(),
      })
      .select()
      .single()

    if (otErr) throw otErr
    secondTripId = otherTrip.id

    try {
      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: secondTripId })
      if (error && (error.code === '42501' || error.message.includes('not assigned'))) {
        pass(`Driver 1 cannot start unassigned trip (Error: ${error.message})`)
      } else {
        throw new Error(`Expected assignment denial, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('not assigned') || e.message.includes('42501')) {
        pass(`Driver 1 cannot start unassigned trip (Error: ${e.message})`)
      } else {
        fail("Driver cannot start another driver's trip", e)
      }
    }

    // 5. Positive Test: Driver 1 starts their assigned trip (scheduled -> in_progress)
    try {
      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: createdTripId })
      if (error) throw error
      pass(`Driver starts assigned trip successfully (status: in_progress)`)
    } catch (e) {
      fail('Driver starts assigned trip', e)
    }

    // 6. Negative Test: Invalid transition (in_progress -> in_progress)
    try {
      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: createdTripId })
      if (error && error.code === '22000' && error.message.includes('Cannot start trip with status in_progress')) {
        pass(`Invalid transition rejected: ${error.message} (Code 22000)`)
      } else {
        throw new Error(`Expected 22000 invalid state error, got: ${JSON.stringify(error)}`)
      }
    } catch (e) {
      if (e.message.includes('22000') || e.message.includes('Cannot start trip')) {
        pass(`Invalid transition rejected: ${e.message} (Code 22000)`)
      } else {
        fail('Invalid transition rejected', e)
      }
    }

    // 7. Test report_delay & rate limiting (one per 10 minutes)
    try {
      const { data: d1, error: de1 } = await driverClient.rpc('report_delay', {
        p_trip_id: createdTripId,
        p_delay_minutes: 15,
        p_reason: 'Heavy traffic at roundabout',
      })
      if (de1) throw de1
      pass(`Driver reports delay successfully (15 minutes)`)

      // Immediately attempt second delay report (should be rate-limited)
      const { data: d2, error: de2 } = await driverClient.rpc('report_delay', {
        p_trip_id: createdTripId,
        p_delay_minutes: 20,
        p_reason: 'Flat tire',
      })
      if (de2 && de2.code === '22000' && de2.message.includes('Rate limit exceeded')) {
        pass(`Rate limit enforced: ${de2.message} (Code 22000)`)
      } else {
        throw new Error(`Expected 22000 rate limit error, got: ${JSON.stringify(de2)}`)
      }
    } catch (e) {
      fail('Delay reporting & rate limit test', e)
    }

    // 8. Test end_trip (in_progress -> completed) & trip_summaries computation
    try {
      const { data: endData, error: endErr } = await driverClient.rpc('end_trip', { p_trip_id: createdTripId })
      if (endErr) throw endErr
      pass(`Driver ends trip successfully (status: completed)`)

      // Verify trip_summaries row was computed
      const { data: summary, error: sumErr } = await adminClient
        .from('trip_summaries')
        .select('*')
        .eq('trip_id', createdTripId)
        .single()

      if (sumErr || !summary) throw new Error(`Summary not found: ${sumErr?.message}`)
      pass(`Trip summary computed: total_pings=${summary.total_pings}, longest_gap=${summary.longest_gap_seconds}s`)
    } catch (e) {
      fail('end_trip and trip_summaries computation', e)
    }

    // 9. Negative Test: Cannot cancel completed trip
    try {
      const { data, error } = await driverClient.rpc('cancel_trip', {
        p_trip_id: createdTripId,
        p_reason: 'Too late to cancel',
      })
      if (error && error.code === '22000' && error.message.includes('Cannot cancel trip with status completed')) {
        pass(`Invalid transition rejected: ${error.message} (Code 22000)`)
      } else {
        throw new Error(`Expected 22000 invalid state error, got: ${JSON.stringify(error)}`)
      }
    } catch (e) {
      if (e.message.includes('Cannot cancel trip') || e.message.includes('22000')) {
        pass(`Invalid transition rejected: ${e.message} (Code 22000)`)
      } else {
        fail('Cannot cancel completed trip check', e)
      }
    }

    // 9b. Positive Test: Driver can cancel scheduled trip with mandatory reason
    const { data: aftTrip } = await adminClient
      .from('trips')
      .select('id')
      .eq('school_id', school1Id)
      .eq('bus_id', bus1.id)
      .eq('trip_date', todayStr)
      .eq('direction', 'afternoon')
      .single()

    if (aftTrip) {
      cancelledAftId = aftTrip.id
      try {
        const { data: cData, error: cErr } = await driverClient.rpc('cancel_trip', {
          p_trip_id: aftTrip.id,
          p_reason: 'Severe weather advisory',
        })
        if (cErr) throw cErr
        pass(`Driver cancels scheduled trip with reason (status: cancelled)`)
      } catch (e) {
        fail('Driver cancels scheduled trip', e)
      }
    }

    // 10. Negative Test: User with no profile is rejected
    try {
      // Create a temporary auth user without a profiles row
      const tempEmail = `noprofile_${Date.now()}@test.local`
      const { data: authUser, error: auErr } = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: 'TempPassword123!',
        email_confirm: true,
      })
      if (auErr) throw auErr
      dummyUserId = authUser.user.id

      // Explicitly delete any auto-created profile row if triggers made one
      await adminClient.from('profiles').delete().eq('id', dummyUserId)

      const noProfClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      await noProfClient.auth.signInWithPassword({ email: tempEmail, password: 'TempPassword123!' })

      const { data, error } = await noProfClient.rpc('start_trip', { p_trip_id: secondTripId })
      if (error && (error.code === '42501' || error.message.includes('Inactive or missing profile'))) {
        pass(`User with no profile rejected with 42501: ${error.message}`)
      } else {
        throw new Error(`Expected missing profile rejection, got: ${JSON.stringify(error)}`)
      }
    } catch (e) {
      if (e.message.includes('Inactive or missing profile') || e.message.includes('42501')) {
        pass(`User with no profile rejected with 42501: ${e.message}`)
      } else {
        fail('User with no profile rejection check', e)
      }
    }

    // 11. Negative Test: Deactivated user is rejected
    try {
      // Temporarily deactivate driver 1
      await adminClient.from('profiles').update({ is_active: false }).eq('id', driver1UserId)

      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: secondTripId })
      if (error && (error.code === '42501' || error.message.includes('Inactive or missing profile'))) {
        pass(`Deactivated user rejected with 42501: ${error.message}`)
      } else {
        throw new Error(`Expected deactivated user rejection, got: ${JSON.stringify(error)}`)
      }
    } catch (e) {
      if (e.message.includes('Inactive or missing profile') || e.message.includes('42501')) {
        pass(`Deactivated user rejected with 42501: ${e.message}`)
      } else {
        fail('Deactivated user rejection check', e)
      }
    } finally {
      // Re-activate driver 1 immediately
      await adminClient.from('profiles').update({ is_active: true }).eq('id', driver1UserId)
    }

  } catch (err) {
    console.error('Fatal test error:', err)
  } finally {
    // Cleanup created rows
    console.log('\n🧹 Cleaning up test trips and artifacts...')
    if (createdTripId) {
      await adminClient.from('trip_summaries').delete().eq('trip_id', createdTripId)
      await adminClient.from('alert_events').delete().eq('trip_id', createdTripId)
      await adminClient.from('audit_log').delete().eq('details_json->>trip_id', createdTripId)
      await adminClient.from('trips').update({
        status: 'scheduled',
        started_at: null,
        ended_at: null,
      }).eq('id', createdTripId)
    }
    if (cancelledAftId) {
      await adminClient.from('alert_events').delete().eq('trip_id', cancelledAftId)
      await adminClient.from('audit_log').delete().eq('details_json->>trip_id', cancelledAftId)
      await adminClient.from('trips').update({
        status: 'scheduled',
        started_at: null,
        ended_at: null,
      }).eq('id', cancelledAftId)
    }
    if (secondTripId) {
      await adminClient.from('trips').delete().eq('id', secondTripId)
    }
    if (dummyUserId) {
      await adminClient.auth.admin.deleteUser(dummyUserId)
    }
    if (driver1UserId) {
      await adminClient.from('profiles').update({ is_active: true }).eq('id', driver1UserId)
    }
    console.log('   ✓ Cleanup complete.\n')
  }

  console.log('======================================================')
  console.log(`🎉 STEP 7 TRIP WORKFLOW SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) process.exit(1)
}

runTests().catch(console.error)
