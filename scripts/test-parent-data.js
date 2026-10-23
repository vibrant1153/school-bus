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

let url = env.VITE_SUPABASE_URL
if (url) {
  url = url.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
}
const anonKey = env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.error('❌ VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing in .env')
  process.exit(1)
}

console.log(`\n👨‍👩‍👧 [Parent Real Data Test] Connecting to: ${url}\n`)

let passed = 0
let failed = 0

async function assertTest(name, fn) {
  try {
    await fn()
    passed++
    console.log(`   ✅ PASS: ${name}`)
  } catch (err) {
    failed++
    console.error(`   ❌ FAIL: ${name}`)
    console.error(`      Error: ${err.message}`)
  }
}

async function run() {
  const supabase = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  const parentPwd = env.TEST_PARENT1_PASSWORD || env.TEST_DEFAULT_PASSWORD
  if (!parentPwd) {
    console.error('❌ TEST_PARENT1_PASSWORD or TEST_DEFAULT_PASSWORD missing in .env')
    process.exit(1)
  }

  // Sign in as parent1
  let parentUser = null
  let parentProfile = null
  await assertTest('Parent 1 authentication (parent1@schoolbus.local)', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'parent1@schoolbus.local',
      password: parentPwd,
    })
    if (error || !data.session) throw new Error(error?.message || 'No session returned')
    parentUser = data.user

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', parentUser.id)
      .single()
    if (profErr || !profile) throw new Error(profErr?.message || 'Failed to fetch profile')
    if (profile.role !== 'parent') throw new Error(`Expected role 'parent', got '${profile.role}'`)
    parentProfile = profile
  })

  // 1. Fetch assigned students through guardians table
  let assignedStudentId = null
  let guardianRecordId = null
  let schoolId = parentProfile?.school_id
  await assertTest('Parent can read assigned students and school details via RLS', async () => {
    const { data: guardians, error } = await supabase
      .from('guardians')
      .select(`
        id,
        student_id,
        alert_radius_m,
        relationship,
        is_primary,
        students (
          id,
          school_id,
          full_name,
          grade,
          is_active,
          schools (
            id,
            name,
            contact_phone
          )
        )
      `)
      .eq('profile_id', parentUser.id)

    if (error) throw new Error(error.message)
    if (!guardians || guardians.length === 0) throw new Error('No assigned student found for parent1')
    guardianRecordId = guardians[0].id
    assignedStudentId = guardians[0].student_id
    if (!guardians[0].students) throw new Error('Student relation could not be resolved')
    if (guardians[0].students.school_id !== schoolId) {
      throw new Error(`School mismatch: student has ${guardians[0].students.school_id}, expected ${schoolId}`)
    }
  })

  // 2. Cross-tenant isolation: Parent cannot query students from School 2 (or other schools)
  await assertTest('Parent cannot query unassigned students or cross-school students', async () => {
    const { data: allStudents, error } = await supabase
      .from('students')
      .select('id, full_name, school_id')

    if (error) throw new Error(error.message)
    // Parent should ONLY see their own child's student row due to RLS
    if (allStudents.length !== 1 || allStudents[0].id !== assignedStudentId) {
      throw new Error(`RLS violation! Expected exactly assigned child [${assignedStudentId}], got ${JSON.stringify(allStudents)}`)
    }
  })

  // 3. Parent can read stops assigned to child
  await assertTest('Parent can query assigned stops and route information', async () => {
    const { data: studentStops, error } = await supabase
      .from('student_stops')
      .select(`
        id,
        direction,
        stops (
          id,
          name,
          lat,
          lng,
          sequence_morning,
          routes (
            id,
            name,
            code,
            start_time
          )
        )
      `)
      .eq('student_id', assignedStudentId)

    if (error) throw new Error(error.message)
    if (!studentStops || studentStops.length === 0) {
      throw new Error('No stops assigned to student')
    }
    const morningStop = studentStops.find((s) => s.direction === 'morning') || studentStops[0]
    if (!morningStop.stops?.lat || !morningStop.stops?.lng) {
      throw new Error('Stop coordinates are missing')
    }
  })

  // 4. Parent updates alert radius preference
  await assertTest('Parent can update their own alert radius preference (500 -> 1000 -> 500)', async () => {
    const { error: updErr1 } = await supabase
      .from('guardians')
      .update({ alert_radius_m: 1000 })
      .eq('id', guardianRecordId)

    if (updErr1) throw new Error(`Update to 1000 failed: ${updErr1.message}`)

    const { data: checkRow1 } = await supabase
      .from('guardians')
      .select('alert_radius_m')
      .eq('id', guardianRecordId)
      .single()
    if (checkRow1?.alert_radius_m !== 1000) {
      throw new Error(`Expected 1000, got ${checkRow1?.alert_radius_m}`)
    }

    // Revert to 500
    const { error: updErr2 } = await supabase
      .from('guardians')
      .update({ alert_radius_m: 500 })
      .eq('id', guardianRecordId)
    if (updErr2) throw new Error(`Revert to 500 failed: ${updErr2.message}`)
  })

  // 5. Parent cannot update another guardian's record (or arbitrary guardian id)
  await assertTest('Parent cannot update another guardian record (RLS denial)', async () => {
    const dummyId = '00000000-0000-0000-0000-000000000999'
    const { data, error } = await supabase
      .from('guardians')
      .update({ alert_radius_m: 200 })
      .eq('id', dummyId)
      .select()

    // Under RLS, updating a non-matching row returns empty array (0 rows updated)
    if (data && data.length > 0) {
      throw new Error('RLS breach! Successfully updated non-owned guardian')
    }
  })

  // 6. Parent reports a future absence
  const futureTestDate = '2026-11-15'
  let createdAbsenceId = null
  await assertTest('Parent can report a future absence with reason', async () => {
    // Clean up any pre-existing test record first
    await supabase
      .from('absences')
      .delete()
      .eq('student_id', assignedStudentId)
      .eq('trip_date', futureTestDate)

    const { data: newAbs, error: absErr } = await supabase
      .from('absences')
      .insert({
        school_id: schoolId,
        student_id: assignedStudentId,
        trip_date: futureTestDate,
        direction: 'both',
        reported_by: parentUser.id,
      })
      .select()
      .single()

    if (absErr) throw new Error(absErr.message)
    createdAbsenceId = newAbs.id

    // Insert reason in absence_reasons
    const { error: reasonErr } = await supabase
      .from('absence_reasons')
      .insert({
        absence_id: createdAbsenceId,
        school_id: schoolId,
        reason: 'Family appointment (Automated Test)',
      })

    if (reasonErr) throw new Error(`Reason insert failed: ${reasonErr.message}`)
  })

  // 7. Cross-tenant / unauthorized absence rejection
  await assertTest('Parent cannot report an absence for an unassigned student (RLS rejection)', async () => {
    const fakeStudentId = '00000000-0000-0000-0000-000000000888'
    const { data, error } = await supabase
      .from('absences')
      .insert({
        school_id: schoolId,
        student_id: fakeStudentId,
        trip_date: futureTestDate,
        direction: 'both',
        reported_by: parentUser.id,
      })
      .select()

    if (!error) {
      throw new Error('Expected RLS violation when inserting absence for unassigned student, but succeeded!')
    }
  })

  // 8. Parent can read the recorded absence and its reason
  await assertTest('Parent can read recorded absences and absence reasons', async () => {
    const { data: absList, error: readErr } = await supabase
      .from('absences')
      .select(`
        id,
        trip_date,
        direction,
        student_id
      `)
      .eq('id', createdAbsenceId)
      .single()

    if (readErr || !absList) throw new Error(readErr?.message || 'Could not read absence')

    const { data: reasonRows, error: rErr } = await supabase
      .from('absence_reasons')
      .select('reason')
      .eq('absence_id', createdAbsenceId)
      .single()

    if (rErr || !reasonRows) throw new Error(rErr?.message || 'Could not read absence reason')
    if (reasonRows.reason !== 'Family appointment (Automated Test)') {
      throw new Error(`Unexpected reason: ${reasonRows.reason}`)
    }
  })

  // 9. Parent can cancel (delete) the future absence
  await assertTest('Parent can cancel (delete) future absence before trip start', async () => {
    const { error: delErr } = await supabase
      .from('absences')
      .delete()
      .eq('id', createdAbsenceId)

    if (delErr) throw new Error(`Cancel absence failed: ${delErr.message}`)

    // Verify deletion
    const { data: checkDel } = await supabase
      .from('absences')
      .select('id')
      .eq('id', createdAbsenceId)
      .maybeSingle()

    if (checkDel) {
      throw new Error('Absence still exists after deletion!')
    }
  })

  // 10. Parent can query alert_events for their student's school/routes
  await assertTest('Parent can query alert events feed', async () => {
    const { data: alerts, error: alertErr } = await supabase
      .from('alert_events')
      .select('*')
      .limit(10)

    if (alertErr) throw new Error(alertErr.message)
    // Query succeeds under RLS
  })

  // 11. Parent can query trips and bus locations (returns data or empty without error)
  await assertTest('Parent can query active trips and bus_locations_latest', async () => {
    const { data: trips, error: tripErr } = await supabase
      .from('trips')
      .select('id, bus_id, route_id, status')
      .limit(5)

    if (tripErr) throw new Error(tripErr.message)

    const { data: busLocs, error: locErr } = await supabase
      .from('bus_locations_latest')
      .select('*')
      .limit(5)

    if (locErr) throw new Error(locErr.message)
  })

  await supabase.auth.signOut()

  console.log('\n======================================================')
  console.log(`🎉 PARENT DATA TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) {
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('Unhandled parent test failure:', err)
  process.exit(1)
})
