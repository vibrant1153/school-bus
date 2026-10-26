import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Load environment variables
const envFile = readFileSync(resolve('.env'), 'utf8')
const env = {}
envFile.split('\n').forEach((line) => {
  const trimmed = line.trim()
  if (trimmed && !trimmed.startsWith('#')) {
    const [k, ...v] = trimmed.split('=')
    env[k.trim()] = v.join('=').trim()
  }
})

const supabaseUrl = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY

const adminClient = createClient(supabaseUrl, serviceRoleKey)
const anonClient = createClient(supabaseUrl, anonKey)

const passwords = {
  owner: env.TEST_OWNER_PASSWORD || env.TEST_DEFAULT_PASSWORD,
  manager1: env.TEST_MANAGER1_PASSWORD || env.TEST_DEFAULT_PASSWORD,
  manager2: env.TEST_MANAGER2_PASSWORD || env.TEST_DEFAULT_PASSWORD,
  driver1: env.TEST_DRIVER1_PASSWORD || env.TEST_DEFAULT_PASSWORD,
  parent1: env.TEST_PARENT1_PASSWORD || env.TEST_DEFAULT_PASSWORD,
}

async function getClientForUser(email, password) {
  const client = createClient(supabaseUrl, anonKey)
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Login failed for ${email}: ${error.message}`)
  return { client, user: data.user }
}

async function runMasterTestSuite() {
  console.log('\n======================================================================')
  console.log('🌟 COMPREHENSIVE MULTI-ROLE & FULL FUNCTIONALITY MASTER TEST SUITE')
  console.log('   Testing: Platform Owner, School Manager, Bus Driver, Student Parent, Anon')
  console.log('   Target Supabase Instance: ' + supabaseUrl)
  console.log('======================================================================\n')

  let totalTests = 0
  let passedTests = 0
  let failedTests = 0

  function assert(condition, description, detail = '') {
    totalTests++
    if (condition) {
      passedTests++
      console.log(`   ✅ PASS: ${description}`)
    } else {
      failedTests++
      console.error(`   ❌ FAIL: ${description} ${detail ? `(${detail})` : ''}`)
    }
  }

  const school1Id = 'e40fae94-592e-433d-be90-1c8e0b531acc' // PAA-01 (School 1)
  const school2Id = '8d03d8cc-3ee5-4ef5-8174-27ee204b7d5f' // SGC-02 (School 2)
  const todayStr = new Date().toISOString().split('T')[0]

  try {
    // ========================================================================
    // 👑 1. PLATFORM OWNER FUNCTIONALITIES
    // ========================================================================
    console.log('\n👑 [1. PLATFORM OWNER ROLE] Testing Platform Oversight & Management...')

    const { client: ownerClient, user: ownerUser } = await getClientForUser('owner@schoolbus.local', passwords.owner)
    assert(ownerUser.email === 'owner@schoolbus.local', 'Owner successfully authenticated via Supabase Auth')

    // 1A. Owner Profile
    const { data: ownerProfile, error: opErr } = await ownerClient
      .from('profiles')
      .select('id, role, school_id, full_name')
      .eq('id', ownerUser.id)
      .single()
    assert(!opErr && ownerProfile?.role === 'owner' && ownerProfile?.school_id === null,
      'Owner profile is global (role = "owner", school_id IS NULL)')

    // 1B. Global Multi-School Visibility
    const { data: allSchools, error: asErr } = await ownerClient
      .from('schools')
      .select('id, name, code, timezone')
      .order('name')
    assert(!asErr && allSchools?.length >= 2,
      `Owner can view all schools in network (found ${allSchools?.length || 0} schools: ${allSchools?.map(s => s.code).join(', ')})`)

    // 1C. Platform Health Metrics RPC
    const { data: healthMetrics, error: hmErr } = await ownerClient.rpc('get_school_health_metrics')
    assert(!hmErr && Array.isArray(healthMetrics) && healthMetrics.length >= 2,
      `Owner can execute get_school_health_metrics RPC (returned metrics for ${healthMetrics?.length || 0} schools)`)

    // 1D. Create School RPC
    const testSchoolCode = `TEST_${Date.now().toString().slice(-4)}`
    const { data: createdSchoolId, error: csErr } = await ownerClient.rpc('create_school', {
      name: `Temporary Academy ${testSchoolCode}`,
      code: testSchoolCode,
      timezone: 'Africa/Addis_Ababa',
      phone: '+251119998888', // Strict E.164 required
    })
    assert(!csErr && !!createdSchoolId, `Owner can register new school via create_school RPC (code: ${testSchoolCode})`, csErr?.message)

    // Clean up created test school
    if (createdSchoolId) {
      await adminClient.from('schools').delete().eq('id', createdSchoolId)
    }

    // 1E. Cross-Tenant Audit Log Visibility
    const { data: auditEntries, error: aeErr } = await ownerClient
      .from('audit_log')
      .select('id, school_id, action, performed_by')
      .limit(5)
    assert(!aeErr && Array.isArray(auditEntries), 'Owner has platform-wide audit log query capability')

    // 1F. Owner Privacy & Negative Controls
    const { data: ownerStudents } = await ownerClient.from('students').select('id')
    assert(!ownerStudents || ownerStudents.length === 0, 'Owner CANNOT view students (RLS returns 0 rows)')

    const { data: ownerAbsenceReasons } = await ownerClient.from('absence_reasons').select('absence_id')
    assert(!ownerAbsenceReasons || ownerAbsenceReasons.length === 0, 'Owner CANNOT view student absence reasons (RLS returns 0 rows)')

    const { data: ownerBusAssignments } = await ownerClient.from('bus_assignments').select('id')
    assert(!ownerBusAssignments || ownerBusAssignments.length === 0, 'Owner CANNOT query bus_assignments directly (RLS returns 0 rows)')

    const { error: ownerStartErr } = await ownerClient.rpc('start_trip', {
      p_trip_id: '00000000-0000-0000-0000-000000000000',
    })
    assert(ownerStartErr && (ownerStartErr.code === '42501' || ownerStartErr.message.includes('Access Denied')),
      'Owner CANNOT execute driver start_trip RPC (Access Denied 42501)')


    // ========================================================================
    // 🏫 2. SCHOOL MANAGER FUNCTIONALITIES
    // ========================================================================
    console.log('\n🏫 [2. SCHOOL MANAGER ROLE] Testing Tenant Administration & Isolation...')

    const { client: manager1Client, user: manager1User } = await getClientForUser('manager1@schoolbus.local', passwords.manager1)
    assert(manager1User.email === 'manager1@schoolbus.local', 'School 1 Manager authenticated successfully')

    // 2A. Read Own School Settings
    const { data: sch1Data, error: sch1Err } = await manager1Client
      .from('schools')
      .select('id, name, code, timezone, contact_phone')
      .eq('id', school1Id)
      .single()
    assert(!sch1Err && sch1Data?.code === 'PAA-01',
      `Manager 1 can read own school settings (${sch1Data?.name}, code: ${sch1Data?.code})`)

    // 2B. Update School Settings via Audited RPC
    const originalPhone = sch1Data?.contact_phone || '+251111234567'
    const updatedPhone = '+25111' + Math.floor(1000000 + Math.random() * 9000000)
    const { error: updSchErr } = await manager1Client.rpc('update_school_settings', {
      p_name: sch1Data?.name || 'Pilot Academy Addis',
      p_timezone: sch1Data?.timezone || 'Africa/Addis_Ababa',
      p_contact_phone: updatedPhone,
    })
    assert(!updSchErr, `Manager 1 updates school settings via audited RPC (phone -> ${updatedPhone})`, updSchErr?.message)

    // Revert phone back
    await manager1Client.rpc('update_school_settings', {
      p_name: sch1Data?.name || 'Pilot Academy Addis',
      p_timezone: sch1Data?.timezone || 'Africa/Addis_Ababa',
      p_contact_phone: originalPhone,
    })

    // 2C. Manager Roster Query & Student Enrollment
    const testStudentName = `Test Cadet ${Date.now().toString().slice(-4)}`
    const { data: newStudent, error: addStuErr } = await manager1Client
      .from('students')
      .insert({
        school_id: school1Id,
        full_name: testStudentName,
        grade: 4,
        is_active: true,
      })
      .select('id, full_name, school_id')
      .single()
    assert(!addStuErr && newStudent?.full_name === testStudentName,
      `Manager 1 can enroll a new student (${testStudentName})`)

    // Clean up test student
    if (newStudent?.id) {
      await adminClient.from('students').delete().eq('id', newStudent.id)
    }

    // 2D. Manager Fleet & License Plate Query
    const { data: buses1, error: b1Err } = await manager1Client
      .from('buses')
      .select(`
        id,
        name,
        capacity,
        is_active,
        bus_plates!fk_bus_plates_bus (
          plate_number
        )
      `)
      .eq('school_id', school1Id)
    assert(!b1Err && buses1?.length > 0 && buses1[0].bus_plates?.length > 0,
      `Manager 1 queries school fleet with license plates (found ${buses1?.length || 0} buses, plate: ${buses1?.[0]?.bus_plates?.[0]?.plate_number})`)

    // 2E. Manager Bus Assignments & Routes
    const { data: mgrAssignments, error: maErr2 } = await manager1Client
      .from('bus_assignments')
      .select('id, bus_id, driver_profile_id, route_id')
      .eq('school_id', school1Id)
    assert(!maErr2 && mgrAssignments?.length > 0,
      `Manager 1 queries driver bus assignments (found ${mgrAssignments?.length || 0} active assignments)`)

    const { data: mgrRoutes, error: mrErr } = await manager1Client
      .from('routes')
      .select('id, name, code, stops(id, name, lat, lng)')
      .eq('school_id', school1Id)
    assert(!mrErr && mgrRoutes?.length > 0,
      `Manager 1 queries school routes and stops (found ${mgrRoutes?.length || 0} routes)`)

    // 2F. Trip Schedule Generation via RPC
    const { data: genTripsRes, error: genTripsErr } = await manager1Client.rpc('generate_daily_trips', {
      p_school_id: school1Id,
      p_date: todayStr,
    })
    assert(!genTripsErr && genTripsRes !== undefined,
      `Manager 1 can generate daily trips for school via generate_daily_trips RPC (result: ${JSON.stringify(genTripsRes)})`)

    // 2G. Manager Trip Cancellation RPC & Trip-Level Alert Creation
    const { data: tempCancelTrip } = await adminClient.from('trips').insert({
      school_id: school1Id,
      route_id: 'e55f2fdf-7eb9-4d56-8a70-bb1186a61d1b', // Route A
      bus_id: 'c189c746-f25f-4b84-bffc-7587156ffb26',
      trip_date: '2026-10-29',
      direction: 'morning',
      status: 'scheduled',
      scheduled_start: new Date().toISOString(),
    }).select().single()

    if (tempCancelTrip) {
      const { data: cancelData, error: cancelErr } = await manager1Client.rpc('cancel_trip', {
        p_trip_id: tempCancelTrip.id,
        p_reason: 'Inclement Weather Cancellation',
      })
      assert(!cancelErr && cancelData?.status === 'cancelled',
        'Manager 1 cancels scheduled trip via cancel_trip RPC (status -> cancelled)')

      // Verify tripCancelled alert event was created
      const { data: tripAlerts } = await adminClient
        .from('alert_events')
        .select('id, event_type, trip_id, student_id')
        .eq('trip_id', tempCancelTrip.id)
      assert(tripAlerts?.length > 0 && tripAlerts[0].event_type === 'tripCancelled' && tripAlerts[0].student_id === null,
        'cancel_trip generates trip-level alert_event with student_id = NULL')

      // Clean up temp trip & alert
      await adminClient.from('alert_events').delete().eq('trip_id', tempCancelTrip.id)
      await adminClient.from('trips').delete().eq('id', tempCancelTrip.id)
    }

    // 2H. Manager Audit Log Query
    const { data: mgrAudit, error: maErr } = await manager1Client
      .from('audit_log')
      .select('id, action, created_at')
      .eq('school_id', school1Id)
      .limit(3)
    assert(!maErr && Array.isArray(mgrAudit),
      `Manager 1 can inspect school audit log (retrieved ${mgrAudit?.length || 0} entries)`)

    // 2I. Manager Strict Multi-Tenant Isolation Controls
    const { data: crossStudents, error: csErr2 } = await manager1Client
      .from('students')
      .select('id, full_name')
      .eq('school_id', school2Id)
    assert(!csErr2 && crossStudents?.length === 0,
      'Manager 1 CANNOT query School 2 students (RLS returns 0 rows)')

    const { data: updateAlien } = await manager1Client
      .from('students')
      .update({ full_name: 'Hacked' })
      .eq('school_id', school2Id)
      .select()
    assert(!updateAlien || updateAlien?.length === 0,
      'Manager 1 CANNOT mutate School 2 students (RLS denies cross-tenant write)')

    // 2J. Manager Direct bus_location_history Select Denial
    const { data: directLocHistory } = await manager1Client
      .from('bus_location_history')
      .select('id')
      .limit(1)
    assert(!directLocHistory || directLocHistory.length === 0,
      'Manager 1 CANNOT select bus_location_history directly (RLS policy enforces audited RPC retrieval only)')


    // ========================================================================
    // 🚌 3. BUS DRIVER FUNCTIONALITIES
    // ========================================================================
    console.log('\n🚌 [3. BUS DRIVER ROLE] Testing Trip Lifecycle, Telemetry & Operations...')

    const { client: driverClient, user: driverUser } = await getClientForUser('driver1@schoolbus.local', passwords.driver1)
    assert(driverUser.email === 'driver1@schoolbus.local', 'Driver 1 authenticated successfully')

    // 3A. Locate or create clean Route A Trip for driver1 today
    const { data: driverTrips, error: dtErr } = await adminClient
      .from('trips')
      .select('id, status, trip_date, direction, bus_id, route_id, routes!inner(name)')
      .eq('school_id', school1Id)
      .eq('routes.name', 'Route A')
      .eq('trip_date', todayStr)
      .limit(1)

    let testTripId = driverTrips?.[0]?.id
    const busId = driverTrips?.[0]?.bus_id || 'c189c746-f25f-4b84-bffc-7587156ffb26'
    const tripDirection = driverTrips?.[0]?.direction || 'afternoon'

    if (!testTripId) {
      const { data: fallbackTrip } = await adminClient
        .from('trips')
        .select('id, bus_id, route_id, direction')
        .eq('school_id', school1Id)
        .eq('routes.name', 'Route A')
        .limit(1)
      testTripId = fallbackTrip[0].id
    }

    // Complete any dangling in-progress trip on this bus to satisfy idx_trips_one_active_per_bus
    await adminClient
      .from('trips')
      .update({ status: 'completed', ended_at: new Date().toISOString() })
      .eq('bus_id', busId)
      .eq('status', 'in_progress')
      .neq('id', testTripId)

    // Reset test trip to scheduled for today with driver1 assigned
    await adminClient
      .from('trips')
      .update({
        trip_date: todayStr,
        status: 'scheduled',
        driver_profile_id: driverUser.id,
        started_at: null,
        ended_at: null,
      })
      .eq('id', testTripId)

    // Clear prior locations for this trip
    await adminClient.from('bus_locations_latest').delete().eq('bus_id', busId)
    await adminClient.from('bus_location_history').delete().eq('trip_id', testTripId)

    // 3B. Start Trip RPC
    const { data: startRes, error: startErr } = await driverClient.rpc('start_trip', { p_trip_id: testTripId })
    assert(!startErr && startRes?.status === 'in_progress',
      `Driver 1 starts assigned trip via start_trip RPC (status -> in_progress)`, startErr?.message)

    // Attempt invalid re-start transition
    const { error: invalidStartErr } = await driverClient.rpc('start_trip', { p_trip_id: testTripId })
    assert(invalidStartErr && invalidStartErr.code === '22000',
      'Driver 1 cannot start an already in-progress trip (Invalid transition 22000)')

    // 3C. Location Ingest RPC (Valid point)
    const { data: ingRes1, error: ingErr1 } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0205,
      p_lng: 38.7505,
      p_heading: 45.0,
      p_speed: 12.0,
      p_accuracy: 10.0,
      p_age_ms: 120,
    })
    assert(!ingErr1 && ingRes1?.status === 'accepted',
      `Driver 1 ingests valid location fix via ingest_location RPC (status: accepted, size: ${ingRes1?.payload_size_bytes}B)`)

    // 3D. Rate Limiting (< 5s interval)
    const { data: ingRes2, error: ingErr2 } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0206,
      p_lng: 38.7506,
      p_heading: 45.0,
      p_speed: 12.0,
      p_accuracy: 10.0,
      p_age_ms: 50,
    })
    assert(!ingErr2 && ingRes2?.status === 'ignored_rate_limit',
      'Rapid consecutive ping (< 5s) throttled with status = "ignored_rate_limit" without broadcast')

    // 3E. Stale GPS Age Rejection (> 30s)
    const { error: staleErr } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0210,
      p_lng: 38.7510,
      p_heading: 45.0,
      p_speed: 10.0,
      p_accuracy: 10.0,
      p_age_ms: 45000, // 45s > 30s limit
    })
    assert(staleErr && (staleErr.code === '22023' || staleErr.message.includes('0-30s')),
      'Stale GPS fix (age > 30s) correctly rejected with SQL 22023')

    // 3F. Driver Report Delay RPC
    const { data: delayRes, error: delayErr } = await driverClient.rpc('report_delay', {
      p_trip_id: testTripId,
      p_reason: 'traffic',
      p_delay_minutes: 15,
    })
    assert(!delayErr, `Driver 1 reports trip delay via report_delay RPC (traffic, 15m)`, delayErr?.message)

    // Report delay rate-limiting (< 10 min throttle)
    const { error: rapidDelayErr } = await driverClient.rpc('report_delay', {
      p_trip_id: testTripId,
      p_reason: 'other',
      p_delay_minutes: 20,
    })
    assert(rapidDelayErr && rapidDelayErr.code === '22000',
      'Consecutive delay reports within 10 min throttled with rate limit error (Code 22000)')

    // 3G. Driver Student Absence Check via RPC (Privacy Preserved)
    const studentOnTripId = '96e24769-d268-4b8e-bb69-3824e60a2600' // Student A on Route A
    const { data: isAbsent, error: absCheckErr } = await driverClient.rpc('is_student_absent', {
      p_student_id: studentOnTripId,
      p_trip_date: todayStr,
      p_direction: tripDirection,
    })
    assert(!absCheckErr && typeof isAbsent === 'boolean',
      `Driver 1 checks student absence flag via is_student_absent RPC (status: ${isAbsent})`)

    // Driver denied checking student NOT on trip
    const { error: alienStudentAbsErr } = await driverClient.rpc('is_student_absent', {
      p_student_id: '00000000-0000-0000-0000-000000000000',
      p_trip_date: todayStr,
      p_direction: tripDirection,
    })
    assert(alienStudentAbsErr && (alienStudentAbsErr.code === '42501' || alienStudentAbsErr.code === 'P0002'),
      'Driver 1 denied checking absence flag for student not assigned to trip')

    // 3H. Driver Absence Reasons Direct Select Denial
    const { data: driverReasons } = await driverClient.from('absence_reasons').select('absence_id, reason')
    assert(!driverReasons || driverReasons.length === 0,
      'Driver 1 CANNOT read absence reasons table directly (RLS privacy protection returns 0 rows)')

    const { data: driverAbsences } = await driverClient.from('absences').select('id')
    assert(!driverAbsences || driverAbsences.length === 0,
      'Driver 1 CANNOT read absences table directly (RLS returns 0 rows)')

    // 3I. Driver Authorization Enforcement (Cannot operate School 2 trip)
    const { data: sch2Trips } = await adminClient
      .from('trips')
      .select('id')
      .eq('school_id', school2Id)
      .limit(1)

    const unassignedTripId = sch2Trips?.[0]?.id || '11111111-2222-3333-4444-555555555555'
    const { error: unassignedStartErr } = await driverClient.rpc('start_trip', {
      p_trip_id: unassignedTripId,
    })
    assert(unassignedStartErr && (unassignedStartErr.code === '42501' || unassignedStartErr.code === 'P0002'),
      'Driver 1 CANNOT operate an unassigned trip (Access Denied 42501 / Not Found)')


    // ========================================================================
    // 👨‍👩‍👧 4. STUDENT PARENT FUNCTIONALITIES
    // ========================================================================
    console.log('\n👨‍👩‍👧 [4. STUDENT PARENT ROLE] Testing Child Tracking, Absences & Privacy...')

    const { client: parentClient, user: parentUser } = await getClientForUser('parent1@schoolbus.local', passwords.parent1)
    assert(parentUser.email === 'parent1@schoolbus.local', 'Parent 1 authenticated successfully')

    // 4A. Query Assigned Students
    const { data: parentStudents, error: psErr } = await parentClient
      .from('guardians')
      .select('id, alert_radius_m, relationship, student:students(id, full_name, grade, school_id)')
      .eq('profile_id', parentUser.id)
    assert(!psErr && parentStudents?.length > 0,
      `Parent 1 can query assigned children via RLS (found child: ${parentStudents?.[0]?.student?.full_name})`)

    const student1Id = parentStudents[0].student.id
    const guardianId = parentStudents[0].id

    // 4B. Query Assigned Stops & Route
    const { data: studentStops, error: ssErr } = await parentClient
      .from('student_stops')
      .select('direction, stop:stops(id, name, lat, lng, routes(id, name, code))')
      .eq('student_id', student1Id)
    assert(!ssErr && studentStops?.length > 0,
      `Parent 1 can query child's assigned stops and route (Stop: ${studentStops?.[0]?.stop?.name})`)

    // 4C. Update Alert Radius Preference
    const originalRadius = parentStudents[0].alert_radius_m || 500
    const newRadius = originalRadius === 500 ? 1000 : 500
    const { error: updRadiusErr } = await parentClient
      .from('guardians')
      .update({ alert_radius_m: newRadius })
      .eq('id', guardianId)
    assert(!updRadiusErr, `Parent 1 updates proximity alert radius (${originalRadius}m -> ${newRadius}m)`)

    // Revert alert radius
    await parentClient.from('guardians').update({ alert_radius_m: originalRadius }).eq('id', guardianId)

    // 4D. Report Child Absence & Reason
    const tomorrowStr = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const { data: newAbsence, error: absErr } = await parentClient
      .from('absences')
      .insert({
        school_id: school1Id,
        student_id: student1Id,
        trip_date: tomorrowStr,
        direction: 'morning',
        reported_by: parentUser.id,
      })
      .select('id')
      .single()
    assert(!absErr && !!newAbsence?.id, `Parent 1 reports child absence for ${tomorrowStr} morning`)

    if (newAbsence?.id) {
      // Record absence reason
      const { error: reasonErr } = await parentClient
        .from('absence_reasons')
        .insert({
          school_id: school1Id,
          absence_id: newAbsence.id,
          reason: 'Doctor checkup',
        })
      assert(!reasonErr, 'Parent 1 records absence reason ("Doctor checkup")')

      // Verify parent can read back own absence reason
      const { data: ownReasons, error: ownReasErr } = await parentClient
        .from('absence_reasons')
        .select('absence_id, reason')
        .eq('absence_id', newAbsence.id)
      assert(!ownReasErr && ownReasons?.length === 1 && ownReasons[0].reason === 'Doctor checkup',
        'Parent 1 can read back their own reported absence reason')

      // 4E. Duplicate Absence Rejection
      const { error: dupAbsErr } = await parentClient
        .from('absences')
        .insert({
          school_id: school1Id,
          student_id: student1Id,
          trip_date: tomorrowStr,
          direction: 'morning',
          reported_by: parentUser.id,
        })
      assert(dupAbsErr && (dupAbsErr.code === '23505' || dupAbsErr.message.includes('unique')),
        'Duplicate absence report for same student/date/direction rejected by unique constraint')

      // 4F. Cancel Absence Before Trip Start
      const { error: cancelAbsErr } = await parentClient
        .from('absences')
        .delete()
        .eq('id', newAbsence.id)
      assert(!cancelAbsErr, 'Parent 1 cancels (deletes) reported absence cleanly before trip execution')
    }

    // 4G. Query Bus Latest Location & Active Trip
    const { data: latestLoc, error: locErr } = await parentClient
      .from('bus_locations_latest')
      .select('bus_id, trip_id, lat, lng, speed, accuracy, recorded_at')
      .eq('trip_id', testTripId)
      .maybeSingle()
    assert(!locErr, `Parent 1 queries bus_locations_latest for active trip (${latestLoc ? `lat: ${latestLoc.lat}, lng: ${latestLoc.lng}` : 'no point yet'})`)

    // 4H. Parent Strict Isolation (Cannot view other children)
    const { data: allStudents, error: allStuErr } = await parentClient
      .from('students')
      .select('id, full_name')
    const unassignedCount = (allStudents || []).filter(s => s.id !== student1Id).length
    assert(!allStuErr && unassignedCount === 0,
      'Parent 1 CANNOT query students not assigned to them (strict guardian RLS filter)')

    const { data: parentBusAssignments } = await parentClient
      .from('bus_assignments')
      .select('id')
    assert(!parentBusAssignments || parentBusAssignments.length === 0,
      'Parent 1 CANNOT access bus_assignments (RLS returns 0 rows)')

    // 4I. Parent Negative Controls
    const { error: parentStartErr } = await parentClient.rpc('start_trip', { p_trip_id: testTripId })
    assert(parentStartErr && (parentStartErr.code === '42501' || parentStartErr.message.includes('Access Denied')),
      'Parent 1 CANNOT execute driver start_trip RPC (Access Denied 42501)')

    const { error: parentIngestErr } = await parentClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.02,
      p_lng: 38.75,
      p_heading: 0,
      p_speed: 0,
      p_accuracy: 10,
      p_age_ms: 100,
    })
    assert(parentIngestErr && (parentIngestErr.code === '42501' || parentIngestErr.message.includes('Access Denied')),
      'Parent 1 CANNOT call ingest_location RPC (Access Denied 42501)')


    // ========================================================================
    // 🏁 5. TRIP CONCLUSION & AUDITED OPERATIONS (Driver, Manager, Parent)
    // ========================================================================
    console.log('\n🏁 [5. TRIP CONCLUSION & AUDITED OPERATIONS] Testing End Trip & Location History...')

    // 5A. Manager Audited Location History Retrieval RPC
    const { data: tlhData, error: tlhErr } = await manager1Client.rpc('get_trip_location_history', {
      p_trip_id: testTripId,
    })
    assert(!tlhErr && Array.isArray(tlhData) && tlhData.length > 0,
      `Manager 1 retrieves location history via audited RPC (retrieved ${tlhData?.length || 0} pings)`)

    // Verify audit log entry was created for location history retrieval
    const { data: historyAudit } = await manager1Client
      .from('audit_log')
      .select('id, action')
      .eq('action', 'SELECT_LOCATION_HISTORY')
      .order('created_at', { ascending: false })
      .limit(1)
    assert(historyAudit?.length > 0, 'SELECT_LOCATION_HISTORY was recorded in school audit_log')

    // 5B. Driver Ends Trip RPC
    const { data: endTripRes, error: endTripErr } = await driverClient.rpc('end_trip', {
      p_trip_id: testTripId,
    })
    assert(!endTripErr && endTripRes?.status === 'completed',
      `Driver 1 ends trip via end_trip RPC (status -> completed)`, endTripErr?.message)

    // 5C. Duplicate End Trip Rejection
    const { error: reEndErr } = await driverClient.rpc('end_trip', {
      p_trip_id: testTripId,
    })
    assert(reEndErr && reEndErr.code === '22000',
      'Driver 1 cannot end an already completed trip (Invalid state transition 22000)')

    // 5D. Ingest Location on Completed Trip Rejection
    const { error: postEndIngestErr } = await driverClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0205,
      p_lng: 38.7505,
      p_heading: 0,
      p_speed: 10,
      p_accuracy: 10,
      p_age_ms: 100,
    })
    assert(postEndIngestErr && (postEndIngestErr.code === '22000' || postEndIngestErr.message.includes('not in_progress')),
      'Driver 1 CANNOT ingest location on completed trip (Status must be in_progress)')


    // ========================================================================
    // 🛡️ 6. UNAUTHENTICATED / ANON CLIENT CONTROLS
    // ========================================================================
    console.log('\n🛡️ [6. UNAUTHENTICATED ANON CONTROLS] Testing Zero-Trust Security Perimeter...')

    // 6A. Anon Read Access Denials
    const { data: anonAudit } = await anonClient.from('audit_log').select('id')
    assert(anonAudit === null || anonAudit?.length === 0, 'Anon client denied read access on audit_log')

    const { data: anonProfiles } = await anonClient.from('profiles').select('id')
    assert(anonProfiles === null || anonProfiles?.length === 0, 'Anon client denied read access on profiles')

    const { data: anonStudents } = await anonClient.from('students').select('id')
    assert(anonStudents === null || anonStudents?.length === 0, 'Anon client denied read access on students')

    const { data: anonTrips } = await anonClient.from('trips').select('id')
    assert(anonTrips === null || anonTrips?.length === 0, 'Anon client denied read access on trips')

    // 6B. Anon RPC Execution Denials
    const { error: anonIngestErr } = await anonClient.rpc('ingest_location', {
      p_trip_id: testTripId,
      p_lat: 9.0,
      p_lng: 38.0,
      p_heading: 0,
      p_speed: 0,
      p_accuracy: 10,
      p_age_ms: 100,
    })
    assert(anonIngestErr && (anonIngestErr.code === '42501' || anonIngestErr.message.includes('Authentication required')),
      'Anon client denied execution of ingest_location RPC (Authentication required 42501)')

    const { error: anonStartTripErr } = await anonClient.rpc('start_trip', { p_trip_id: testTripId })
    assert(anonStartTripErr && anonStartTripErr.code === '42501',
      'Anon client denied execution of start_trip RPC (42501)')

    const { error: anonEndTripErr } = await anonClient.rpc('end_trip', { p_trip_id: testTripId })
    assert(anonEndTripErr && anonEndTripErr.code === '42501',
      'Anon client denied execution of end_trip RPC (42501)')

    const { error: anonUpdateSchErr } = await anonClient.rpc('update_school_settings', {
      p_name: 'Hacked School',
      p_timezone: 'Africa/Addis_Ababa',
      p_contact_phone: '+251119990000',
    })
    assert(anonUpdateSchErr && (anonUpdateSchErr.code === '42501' || anonUpdateSchErr.message.includes('Access Denied')),
      'Anon client denied execution of update_school_settings RPC (Access Denied 42501)')

  } catch (err) {
    console.error('\n❌ Fatal error in master test suite execution:', err)
    process.exit(1)
  }

  // ========================================================================
  // FINAL TEST SUITE REPORT
  // ========================================================================
  console.log('\n======================================================================')
  console.log('📊 MASTER TEST SUITE RESULTS SUMMARY')
  console.log('======================================================================')
  console.log(`Total Operations Tested:  ${totalTests}`)
  console.log(`Operations Passed:        ${passedTests}`)
  console.log(`Operations Failed:        ${failedTests}`)
  console.log('======================================================================')

  if (failedTests === 0) {
    console.log('🎉 ALL OPERATIONS FOR OWNER, MANAGER, DRIVER, AND PARENT PASSED 100%!\n')
  } else {
    console.error(`❌ ${failedTests} TEST(S) FAILED! Check logs above.\n`)
    process.exit(1)
  }
}

runMasterTestSuite().catch((err) => {
  console.error('\n❌ Runner exited with unhandled error:', err)
  process.exit(1)
})
