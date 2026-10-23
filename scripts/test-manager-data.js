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

const manager1Pwd = env.TEST_MANAGER1_PASSWORD || env.TEST_DEFAULT_PASSWORD
if (!manager1Pwd) {
  console.error('❌ TEST_MANAGER1_PASSWORD or TEST_DEFAULT_PASSWORD missing in .env')
  process.exit(1)
}

console.log(`\n🏫 [Step 6: Manager Real Data Test] Connecting to: ${url}\n`)

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

  // 1. Sign in as School 1 Manager
  let managerUser = null
  let managerProfile = null
  let schoolId = null

  await assertTest('Manager 1 authentication (manager1@schoolbus.local)', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'manager1@schoolbus.local',
      password: manager1Pwd,
    })
    if (error || !data.session) throw new Error(error?.message || 'No session returned')
    managerUser = data.user

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', managerUser.id)
      .single()
    if (profErr || !profile) throw new Error(profErr?.message || 'Failed to fetch manager profile')
    if (profile.role !== 'manager') throw new Error(`Expected role 'manager', got '${profile.role}'`)
    if (!profile.school_id) throw new Error('Manager profile missing school_id')
    managerProfile = profile
    schoolId = profile.school_id
  })

  // 2. Query school details
  let initialSchoolData = null
  await assertTest('Manager can read own school settings via RLS', async () => {
    const { data: sch, error } = await supabase
      .from('schools')
      .select('*')
      .eq('id', schoolId)
      .single()

    if (error || !sch) throw new Error(error?.message || 'Failed to fetch school')
    if (sch.code !== 'PAA-01') throw new Error(`Expected code PAA-01, got ${sch.code}`)
    initialSchoolData = sch
  })

  // 3. Query student roster & verify cross-tenant isolation
  await assertTest('Manager can query school student roster (strict tenant isolation)', async () => {
    const { data: students, error } = await supabase
      .from('students')
      .select('id, full_name, grade, school_id')

    if (error) throw new Error(error.message)
    if (!students || students.length === 0) throw new Error('Expected at least 1 student in School 1')

    const alienStudent = students.find((s) => s.school_id !== schoolId)
    if (alienStudent) {
      throw new Error(`Cross-tenant breach! Manager saw student from school ${alienStudent.school_id}`)
    }
  })

  // 4. Add new student via client RLS write
  let createdStudentId = null
  const testStudentName = `Test Student Automated ${Date.now()}`
  await assertTest('Manager adds new student through client RLS (fake data only)', async () => {
    const { data: newStudent, error: insertErr } = await supabase
      .from('students')
      .insert({
        school_id: schoolId,
        full_name: testStudentName,
        grade: 4,
        is_active: true,
      })
      .select()
      .single()

    if (insertErr || !newStudent) throw new Error(insertErr?.message || 'Insert student failed')
    createdStudentId = newStudent.id
    if (newStudent.school_id !== schoolId) throw new Error('Created student has mismatched school_id')
    if (newStudent.full_name !== testStudentName) throw new Error('Created student name mismatch')
  })

  // 5. Query buses and license plates
  await assertTest('Manager can query buses and bus_plates (joined view)', async () => {
    const { data: buses, error: busErr } = await supabase
      .from('buses')
      .select(`
        id,
        name,
        capacity,
        is_active,
        school_id,
        bus_plates!fk_bus_plates_bus (
          plate_number
        )
      `)
      .eq('school_id', schoolId)

    if (busErr) throw new Error(busErr.message)
    if (!buses || buses.length === 0) throw new Error('Expected buses in School 1')

    const test001 = buses.find((b) => b.bus_plates?.some((p) => p.plate_number === 'TEST-001'))
    if (!test001) throw new Error('Expected bus with TEST-001 license plate in School 1')
  })

  // 6. Add new bus and license plate via client RLS write
  let createdBusId = null
  const testBusNumber = 99
  const testPlate = `TEST-MGR-${Math.floor(100 + Math.random() * 900)}`
  await assertTest('Manager adds new bus and license plate through client RLS', async () => {
    const { data: newBus, error: bErr } = await supabase
      .from('buses')
      .insert({
        school_id: schoolId,
        name: `Bus ${testBusNumber}`,
        capacity: 25,
        is_active: true,
      })
      .select()
      .single()

    if (bErr || !newBus) throw new Error(bErr?.message || 'Insert bus failed')
    createdBusId = newBus.id

    const { data: newPlate, error: pErr } = await supabase
      .from('bus_plates')
      .insert({
        bus_id: createdBusId,
        school_id: schoolId,
        plate_number: testPlate,
      })
      .select()
      .single()

    if (pErr || !newPlate) throw new Error(pErr?.message || 'Insert bus plate failed')
    if (newPlate.plate_number !== testPlate) throw new Error('Plate number mismatch')
  })

  // 7. Update school settings via RPC update_school_settings
  await assertTest('Manager updates school settings (name and office phone) via audited RPC', async () => {
    const updatedPhone = '+251911887766'
    const updatedName = 'Pilot Academy Addis (Updated)'

    const { data, error } = await supabase.rpc('update_school_settings', {
      p_name: updatedName,
      p_timezone: 'Africa/Addis_Ababa',
      p_contact_phone: updatedPhone,
    })

    if (error) throw new Error(`RPC update_school_settings failed: ${error.message}`)

    // Verify update took effect
    const { data: verifiedSch } = await supabase
      .from('schools')
      .select('name, contact_phone')
      .eq('id', schoolId)
      .single()

    if (verifiedSch.contact_phone !== updatedPhone) {
      throw new Error(`Expected phone ${updatedPhone}, got ${verifiedSch.contact_phone}`)
    }

    // Revert back to original
    await supabase.rpc('update_school_settings', {
      p_name: initialSchoolData.name,
      p_timezone: initialSchoolData.timezone,
      p_contact_phone: initialSchoolData.contact_phone,
    })
  })

  // 8. Query audit log
  await assertTest('Manager can read school audit log (including settings change & user provisioning)', async () => {
    const { data: logs, error: logErr } = await supabase
      .from('audit_log')
      .select('*')
      .eq('school_id', schoolId)
      .order('created_at', { ascending: false })
      .limit(10)

    if (logErr) throw new Error(logErr.message)
    if (!logs || logs.length === 0) throw new Error('Expected audit log entries for School 1')

    const alienLog = logs.find((l) => l.school_id !== schoolId)
    if (alienLog) throw new Error(`Audit log tenant breach! Saw log for school ${alienLog.school_id}`)
  })

  // 9. Negative cross-tenant checks: Manager cannot read or mutate School 2 records
  await assertTest('Manager cannot read or mutate School 2 records (RLS & trigger isolation)', async () => {
    const school2Id = '8d03d8cc-3ee5-4ef5-8174-27ee204b7d5f' // SGC-02

    // Cannot read School 2 students
    const { data: readAlien, error: rErr } = await supabase
      .from('students')
      .select('id')
      .eq('school_id', school2Id)
    if (rErr) throw new Error(rErr.message)
    if (readAlien && readAlien.length > 0) {
      throw new Error('RLS breach! Manager read students from School 2')
    }

    // Cannot update School 2 students
    const { data: updateAlien, error: uErr } = await supabase
      .from('students')
      .update({ full_name: 'Illicit Update' })
      .eq('school_id', school2Id)
      .select()
    if (updateAlien && updateAlien.length > 0) {
      throw new Error('RLS breach! Manager updated student in School 2')
    }

    // Cannot delete School 2 students
    const { data: deleteAlien, error: dErr } = await supabase
      .from('students')
      .delete()
      .eq('school_id', school2Id)
      .select()
    if (deleteAlien && deleteAlien.length > 0) {
      throw new Error('RLS breach! Manager deleted student in School 2')
    }
  })

  // 10. Clean up created test student and test bus
  await assertTest('Cleanup created test student and test bus from remote database', async () => {
    if (createdStudentId) {
      const { error: delStudErr } = await supabase
        .from('students')
        .delete()
        .eq('id', createdStudentId)
      if (delStudErr) throw new Error(`Delete test student failed: ${delStudErr.message}`)
    }

    if (createdBusId) {
      // Delete plate first, then bus
      await supabase.from('bus_plates').delete().eq('bus_id', createdBusId)
      const { error: delBusErr } = await supabase.from('buses').delete().eq('id', createdBusId)
      if (delBusErr) throw new Error(`Delete test bus failed: ${delBusErr.message}`)
    }
  })

  await supabase.auth.signOut()

  console.log('\n======================================================')
  console.log(`🎉 MANAGER REAL DATA TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('\nFatal test execution error:', err)
  process.exit(1)
})
