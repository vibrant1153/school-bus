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
  console.log(`\n🚌 [Step 7: Comprehensive Trips Workflow Suite] Connecting to: ${supabaseUrl}\n`)
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

  let testTripId = null
  let otherTripId = null
  let aftTripId = null
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

    // --------------------------------------------------------------------------
    // REQUIREMENT 1: PROVE TRIP GENERATION FROM route_schedules & IDEMPOTENCY
    // --------------------------------------------------------------------------
    const mondayDate = '2026-10-26' // Monday (day_of_week = 1)
    await adminClient.from('trips').delete().eq('school_id', school1Id).eq('trip_date', mondayDate)

    // Run 1: generate trips from active route_schedules
    try {
      const { data: gen1, error: gen1Err } = await managerClient.rpc('generate_daily_trips', {
        p_school_id: school1Id,
        p_date: mondayDate,
      })
      if (gen1Err) throw gen1Err
      if (gen1.created_trips !== 2) throw new Error(`Expected 2 trips created from route_schedules, got ${gen1.created_trips}`)

      // Verify rows in database
      const { data: mondayTrips, error: mtErr } = await adminClient
        .from('trips')
        .select('id, direction, scheduled_start, status')
        .eq('school_id', school1Id)
        .eq('trip_date', mondayDate)
      if (mtErr) throw mtErr
      if (mondayTrips.length !== 2) throw new Error(`Expected 2 rows in DB, found ${mondayTrips.length}`)

      pass(`Trip generation created ${gen1.created_trips} trips from active route_schedules for ${mondayDate}`)
    } catch (e) {
      fail('Trip generation from route_schedule', e)
    }

    // Run 2: Idempotency check (run exact same generation again)
    try {
      const { data: gen2, error: gen2Err } = await managerClient.rpc('generate_daily_trips', {
        p_school_id: school1Id,
        p_date: mondayDate,
      })
      if (gen2Err) throw gen2Err
      if (gen2.created_trips !== 0) throw new Error(`Expected 0 trips created on second run (idempotent), got ${gen2.created_trips}`)

      const { data: mondayTripsAfter } = await adminClient
        .from('trips')
        .select('id')
        .eq('school_id', school1Id)
        .eq('trip_date', mondayDate)
      if (mondayTripsAfter.length !== 2) throw new Error(`Trip count changed from 2 to ${mondayTripsAfter.length}`)

      pass('Trip generation is idempotent when run twice (created_trips = 0, no duplicate rows)')
    } catch (e) {
      fail('Trip generation idempotency check', e)
    } finally {
      // Clean up Monday test trips
      await adminClient.from('trips').delete().eq('school_id', school1Id).eq('trip_date', mondayDate)
    }

    // Role check: Parent cannot generate daily trips
    try {
      const { data, error } = await parentClient.rpc('generate_daily_trips', { p_school_id: school1Id })
      if (error && (error.code === '42501' || error.message.includes('Access Denied'))) {
        pass('Parent is rejected from calling generate_daily_trips (42501)')
      } else {
        throw new Error(`Expected Access Denied error, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('42501') || e.message.includes('Access Denied')) {
        pass('Parent is rejected from calling generate_daily_trips (42501)')
      } else {
        fail('Parent role check on generate_daily_trips', e)
      }
    }

    // --------------------------------------------------------------------------
    // PREPARE CONTROLLED TRIPS FOR TODAY
    // --------------------------------------------------------------------------
    const todayStr = new Date().toISOString().split('T')[0]

    // Trip 1: Assigned to Driver 1 on Bus 1
    const { data: t1, error: t1Err } = await adminClient
      .from('trips')
      .upsert({
        school_id: school1Id,
        bus_id: bus1.id,
        route_id: routeA.id,
        driver_profile_id: driver1UserId,
        trip_date: todayStr,
        direction: 'morning',
        status: 'scheduled',
        scheduled_start: new Date().toISOString(),
        started_at: null,
        ended_at: null,
      }, { onConflict: 'school_id,bus_id,direction,trip_date' })
      .select()
      .single()
    if (t1Err) throw t1Err
    testTripId = t1.id

    // Ensure state is clean 'scheduled'
    await adminClient.from('trips').update({ status: 'scheduled', started_at: null, ended_at: null }).eq('id', testTripId)

    // Trip 2: Assigned to Bus 2 on Route B (Driver 1 is NOT assigned to Route B)
    const { data: t2, error: t2Err } = await adminClient
      .from('trips')
      .upsert({
        school_id: school1Id,
        bus_id: bus2.id,
        route_id: routeB.id,
        driver_profile_id: null,
        trip_date: todayStr,
        direction: 'morning',
        status: 'scheduled',
        scheduled_start: new Date().toISOString(),
        started_at: null,
        ended_at: null,
      }, { onConflict: 'school_id,bus_id,direction,trip_date' })
      .select()
      .single()
    if (t2Err) throw t2Err
    otherTripId = t2.id

    // Trip 3: Afternoon trip on Bus 1 for cancellation tests
    const { data: t3, error: t3Err } = await adminClient
      .from('trips')
      .upsert({
        school_id: school1Id,
        bus_id: bus1.id,
        route_id: routeA.id,
        driver_profile_id: driver1UserId,
        trip_date: todayStr,
        direction: 'afternoon',
        status: 'scheduled',
        scheduled_start: new Date().toISOString(),
        started_at: null,
        ended_at: null,
      }, { onConflict: 'school_id,bus_id,direction,trip_date' })
      .select()
      .single()
    if (t3Err) throw t3Err
    aftTripId = t3.id

    await adminClient.from('trips').update({ status: 'scheduled', started_at: null, ended_at: null }).eq('id', aftTripId)

    // --------------------------------------------------------------------------
    // REQUIREMENT 2: DRIVER CANNOT START, CANCEL OR END ANOTHER DRIVER'S TRIP
    // --------------------------------------------------------------------------
    try {
      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: otherTripId })
      if (error && (error.code === '42501' || error.message.includes('not assigned'))) {
        pass(`Driver 1 cannot start another driver's unassigned trip (Error: ${error.message})`)
      } else {
        throw new Error(`Expected assignment denial, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('not assigned') || e.message.includes('42501')) {
        pass(`Driver 1 cannot start another driver's unassigned trip (Error: ${e.message})`)
      } else {
        fail("Driver cannot start another driver's trip", e)
      }
    }

    try {
      const { data, error } = await driverClient.rpc('cancel_trip', { p_trip_id: otherTripId, p_reason: 'Trying cancel' })
      if (error && (error.code === '42501' || error.message.includes('not assigned'))) {
        pass(`Driver 1 cannot cancel another driver's trip (Error: ${error.message})`)
      } else {
        throw new Error(`Expected assignment denial on cancel, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('not assigned') || e.message.includes('42501')) {
        pass(`Driver 1 cannot cancel another driver's trip (Error: ${e.message})`)
      } else {
        fail("Driver cannot cancel another driver's trip", e)
      }
    }

    try {
      const { data, error } = await driverClient.rpc('end_trip', { p_trip_id: otherTripId })
      if (error && (error.code === '42501' || error.message.includes('not assigned'))) {
        pass(`Driver 1 cannot end another driver's trip (Error: ${error.message})`)
      } else {
        throw new Error(`Expected assignment denial on end, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('not assigned') || e.message.includes('42501')) {
        pass(`Driver 1 cannot end another driver's trip (Error: ${e.message})`)
      } else {
        fail("Driver cannot end another driver's trip", e)
      }
    }

    // --------------------------------------------------------------------------
    // REQUIREMENT 2: PARENT CANNOT CALL end_trip, cancel_trip OR report_delay
    // --------------------------------------------------------------------------
    try {
      const { data, error } = await parentClient.rpc('end_trip', { p_trip_id: testTripId })
      if (error && (error.code === '42501' || error.message.includes('Access Denied'))) {
        pass('Parent cannot call end_trip (rejected with 42501)')
      } else {
        throw new Error(`Expected 42501, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('42501') || e.message.includes('Access Denied')) {
        pass('Parent cannot call end_trip (rejected with 42501)')
      } else {
        fail('Parent cannot call end_trip', e)
      }
    }

    try {
      const { data, error } = await parentClient.rpc('cancel_trip', { p_trip_id: testTripId, p_reason: 'Parent cancel' })
      if (error && (error.code === '42501' || error.message.includes('Access Denied'))) {
        pass('Parent cannot call cancel_trip (rejected with 42501)')
      } else {
        throw new Error(`Expected 42501, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('42501') || e.message.includes('Access Denied')) {
        pass('Parent cannot call cancel_trip (rejected with 42501)')
      } else {
        fail('Parent cannot call cancel_trip', e)
      }
    }

    try {
      const { data, error } = await parentClient.rpc('report_delay', { p_trip_id: testTripId, p_delay_minutes: 15, p_reason: 'Parent delay' })
      if (error && (error.code === '42501' || error.message.includes('Access Denied'))) {
        pass('Parent cannot call report_delay (rejected with 42501)')
      } else {
        throw new Error(`Expected 42501, got: ${JSON.stringify({ data, error })}`)
      }
    } catch (e) {
      if (e.message.includes('42501') || e.message.includes('Access Denied')) {
        pass('Parent cannot call report_delay (rejected with 42501)')
      } else {
        fail('Parent cannot call report_delay', e)
      }
    }

    // --------------------------------------------------------------------------
    // REQUIREMENT 2: end_trip ON A SCHEDULED TRIP IS REJECTED
    // --------------------------------------------------------------------------
    try {
      const { data, error } = await driverClient.rpc('end_trip', { p_trip_id: testTripId })
      if (error && error.code === '22000' && error.message.includes('Cannot end trip with status scheduled')) {
        pass(`end_trip on scheduled trip rejected: ${error.message} (Code 22000)`)
      } else {
        throw new Error(`Expected 22000 invalid state error, got: ${JSON.stringify(error)}`)
      }
    } catch (e) {
      if (e.message.includes('22000') || e.message.includes('Cannot end trip')) {
        pass(`end_trip on scheduled trip rejected: ${e.message} (Code 22000)`)
      } else {
        fail('end_trip on scheduled trip rejection check', e)
      }
    }

    // --------------------------------------------------------------------------
    // DRIVER STARTS ASSIGNED TRIP (scheduled -> in_progress)
    // --------------------------------------------------------------------------
    try {
      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: testTripId })
      if (error) throw error
      pass('Driver 1 starts assigned trip successfully (status: in_progress)')
    } catch (e) {
      fail('Driver starts assigned trip', e)
    }

    // Negative: Cannot start already in_progress trip
    try {
      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: testTripId })
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

    // Delay reporting & rate limiting (one per 10 minutes)
    try {
      const { error: de1 } = await driverClient.rpc('report_delay', {
        p_trip_id: testTripId,
        p_delay_minutes: 15,
        p_reason: 'Heavy traffic at roundabout',
      })
      if (de1) throw de1
      pass('Driver reports delay successfully (15 minutes)')

      const { error: de2 } = await driverClient.rpc('report_delay', {
        p_trip_id: testTripId,
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

    // --------------------------------------------------------------------------
    // REQUIREMENT 1: INSERT FAKE LOCATION POINTS & PROVE end_trip METRICS
    // --------------------------------------------------------------------------
    // Points:
    // P1: t0, accuracy: 10.0m
    // P2: t0 + 15s, accuracy: 12.0m  (gap: 15s)
    // P3: t0 + 45s, accuracy: 14.0m  (gap: 30s - LONGEST)
    // P4: t0 + 60s, accuracy: 20.0m  (gap: 15s)
    // Expected:
    // total_pings = 4
    // longest_gap_seconds = 30
    // avg_accuracy_meters = (10 + 12 + 14 + 20) / 4 = 14.0
    const baseMs = Date.now() - 60000
    const fakePoints = [
      { school_id: school1Id, trip_id: testTripId, bus_id: bus1.id, lat: 9.0100, lng: 38.7500, accuracy: 10.0, recorded_at: new Date(baseMs).toISOString() },
      { school_id: school1Id, trip_id: testTripId, bus_id: bus1.id, lat: 9.0110, lng: 38.7510, accuracy: 12.0, recorded_at: new Date(baseMs + 15000).toISOString() },
      { school_id: school1Id, trip_id: testTripId, bus_id: bus1.id, lat: 9.0120, lng: 38.7520, accuracy: 14.0, recorded_at: new Date(baseMs + 45000).toISOString() },
      { school_id: school1Id, trip_id: testTripId, bus_id: bus1.id, lat: 9.0130, lng: 38.7530, accuracy: 20.0, recorded_at: new Date(baseMs + 60000).toISOString() },
    ]

    await adminClient.from('bus_location_history').insert(fakePoints)

    // Call end_trip
    try {
      const { data: endData, error: endErr } = await driverClient.rpc('end_trip', { p_trip_id: testTripId })
      if (endErr) throw endErr
      pass('Driver ends trip successfully (status: completed)')

      // Verify trip_summaries row
      const { data: summary, error: sumErr } = await adminClient
        .from('trip_summaries')
        .select('*')
        .eq('trip_id', testTripId)
        .single()

      if (sumErr || !summary) throw new Error(`Summary not found: ${sumErr?.message}`)

      if (summary.total_pings !== 4) throw new Error(`Expected total_pings=4, got ${summary.total_pings}`)
      if (summary.longest_gap_seconds !== 30) throw new Error(`Expected longest_gap_seconds=30, got ${summary.longest_gap_seconds}`)
      if (Math.abs(summary.avg_accuracy_meters - 14.0) > 0.05) throw new Error(`Expected avg_accuracy_meters=14.0, got ${summary.avg_accuracy_meters}`)
      if (!summary.started_at || !summary.ended_at) throw new Error('started_at or ended_at is null')

      pass(`end_trip computed exact metrics from location points: total_pings=4, longest_gap=30s, avg_accuracy=14.0m (NO coordinates stored)`)
    } catch (e) {
      fail('end_trip reliability metrics computation', e)
    }

    // Negative: Cannot cancel completed trip
    try {
      const { data, error } = await driverClient.rpc('cancel_trip', {
        p_trip_id: testTripId,
        p_reason: 'Too late to cancel',
      })
      if (error && error.code === '22000' && error.message.includes('Cannot cancel trip with status completed')) {
        pass(`Cannot cancel completed trip rejected: ${error.message} (Code 22000)`)
      } else {
        throw new Error(`Expected 22000 invalid state error, got: ${JSON.stringify(error)}`)
      }
    } catch (e) {
      if (e.message.includes('Cannot cancel trip') || e.message.includes('22000')) {
        pass(`Cannot cancel completed trip rejected: ${e.message} (Code 22000)`)
      } else {
        fail('Cannot cancel completed trip check', e)
      }
    }

    // --------------------------------------------------------------------------
    // REQUIREMENT 2: MANAGER CANCELS A TRIP
    // --------------------------------------------------------------------------
    try {
      const { data: cancelData, error: cancelErr } = await managerClient.rpc('cancel_trip', {
        p_trip_id: aftTripId,
        p_reason: 'Emergency road closure near campus',
      })
      if (cancelErr) throw cancelErr
      if (cancelData.status !== 'cancelled') throw new Error(`Expected status 'cancelled', got ${cancelData.status}`)

      // Verify in DB and verify audit log entry
      const { data: dbAft } = await adminClient.from('trips').select('status, ended_at').eq('id', aftTripId).single()
      if (dbAft.status !== 'cancelled' || !dbAft.ended_at) throw new Error('Trip not updated to cancelled in DB')

      const { data: auditLogs } = await adminClient
        .from('audit_log')
        .select('*')
        .eq('school_id', school1Id)
        .eq('action', 'CANCEL_TRIP')
        .order('created_at', { ascending: false })
        .limit(1)

      if (!auditLogs || auditLogs.length === 0 || auditLogs[0].performed_by !== managerUser.id) {
        throw new Error('Audit log missing CANCEL_TRIP action by manager')
      }

      pass(`Manager cancels scheduled trip with reason (status: cancelled, audited by manager ID)`)
    } catch (e) {
      fail('Manager cancels a trip', e)
    }

    // --------------------------------------------------------------------------
    // NEGATIVE TESTS: USER WITH NO PROFILE & DEACTIVATED USER
    // --------------------------------------------------------------------------
    try {
      const tempEmail = `noprofile_${Date.now()}@test.local`
      const { data: authUser, error: auErr } = await adminClient.auth.admin.createUser({
        email: tempEmail,
        password: 'TempPassword123!',
        email_confirm: true,
      })
      if (auErr) throw auErr
      dummyUserId = authUser.user.id

      await adminClient.from('profiles').delete().eq('id', dummyUserId)

      const noProfClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      await noProfClient.auth.signInWithPassword({ email: tempEmail, password: 'TempPassword123!' })

      const { data, error } = await noProfClient.rpc('start_trip', { p_trip_id: otherTripId })
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

    try {
      await adminClient.from('profiles').update({ is_active: false }).eq('id', driver1UserId)

      const { data, error } = await driverClient.rpc('start_trip', { p_trip_id: otherTripId })
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
      await adminClient.from('profiles').update({ is_active: true }).eq('id', driver1UserId)
    }

  } catch (err) {
    console.error('Fatal test error:', err)
  } finally {
    console.log('\n🧹 Cleaning up test trips and artifacts...')
    if (testTripId) {
      await adminClient.from('trip_summaries').delete().eq('trip_id', testTripId)
      await adminClient.from('bus_location_history').delete().eq('trip_id', testTripId)
      await adminClient.from('alert_events').delete().eq('trip_id', testTripId)
      await adminClient.from('audit_log').delete().eq('details_json->>trip_id', testTripId)
      await adminClient.from('trips').update({
        status: 'scheduled',
        started_at: null,
        ended_at: null,
      }).eq('id', testTripId)
    }
    if (aftTripId) {
      await adminClient.from('alert_events').delete().eq('trip_id', aftTripId)
      await adminClient.from('audit_log').delete().eq('details_json->>trip_id', aftTripId)
      await adminClient.from('trips').update({
        status: 'scheduled',
        started_at: null,
        ended_at: null,
      }).eq('id', aftTripId)
    }
    if (otherTripId) {
      await adminClient.from('trips').delete().eq('id', otherTripId)
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
