import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import crypto from 'node:crypto'
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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !anonKey) {
  console.error('❌ VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing in .env')
  process.exit(1)
}

const defaultPwd = env.TEST_DEFAULT_PASSWORD
const ownerPwd = env.TEST_OWNER_PASSWORD || defaultPwd
const manager1Pwd = env.TEST_MANAGER1_PASSWORD || defaultPwd
const driver1Pwd = env.TEST_DRIVER1_PASSWORD || defaultPwd
const parent1Pwd = env.TEST_PARENT1_PASSWORD || defaultPwd
const manager2Pwd = env.TEST_MANAGER2_PASSWORD || defaultPwd

if (!ownerPwd || !manager1Pwd || !driver1Pwd || !parent1Pwd || !manager2Pwd) {
  console.error('❌ Test passwords missing in .env. Please set TEST_DEFAULT_PASSWORD or role-specific passwords.')
  process.exit(1)
}

console.log(`\n🔐 [Auth Test] Testing Supabase Authentication against: ${url}\n`)

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

  // Admin client used ONLY for test cleanup
  const adminSupabase = serviceKey
    ? createClient(url, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null

  // 1. Sign in as Platform Owner
  await assertTest('Sign in as Platform Owner (owner@schoolbus.local)', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'owner@schoolbus.local',
      password: ownerPwd,
    })
    if (error || !data.session) throw new Error(error?.message || 'No session returned')

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()
    if (profErr || !profile) throw new Error(profErr?.message || 'Profile fetch failed')
    if (profile.role !== 'owner') throw new Error(`Expected role 'owner', got '${profile.role}'`)
    if (profile.school_id !== null) throw new Error(`Expected owner school_id to be NULL, got '${profile.school_id}'`)

    await supabase.auth.signOut()
  })

  // 2. Sign in as School 1 Manager
  let managerSessionToken = null
  let managerSchoolId = null
  await assertTest('Sign in as School 1 Manager (manager1@schoolbus.local)', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'manager1@schoolbus.local',
      password: manager1Pwd,
    })
    if (error || !data.session) throw new Error(error?.message || 'No session returned')
    managerSessionToken = data.session.access_token

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()
    if (profErr || !profile) throw new Error(profErr?.message || 'Profile fetch failed')
    if (profile.role !== 'manager') throw new Error(`Expected role 'manager', got '${profile.role}'`)
    if (!profile.school_id) throw new Error('Manager profile missing school_id')
    managerSchoolId = profile.school_id

    await supabase.auth.signOut()
  })

  // 3. Sign in as School 1 Driver
  await assertTest('Sign in as School 1 Driver (driver1@schoolbus.local)', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'driver1@schoolbus.local',
      password: driver1Pwd,
    })
    if (error || !data.session) throw new Error(error?.message || 'No session returned')

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()
    if (profErr || !profile) throw new Error(profErr?.message || 'Profile fetch failed')
    if (profile.role !== 'driver') throw new Error(`Expected role 'driver', got '${profile.role}'`)

    await supabase.auth.signOut()
  })

  // 4. Sign in as School 1 Parent
  await assertTest('Sign in as School 1 Parent (parent1@schoolbus.local)', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'parent1@schoolbus.local',
      password: parent1Pwd,
    })
    if (error || !data.session) throw new Error(error?.message || 'No session returned')

    const { data: profile, error: profErr } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single()
    if (profErr || !profile) throw new Error(profErr?.message || 'Profile fetch failed')
    if (profile.role !== 'parent') throw new Error(`Expected role 'parent', got '${profile.role}'`)

    await supabase.auth.signOut()
  })

  // 5. Negative Test: Wrong password rejected
  await assertTest('Reject invalid password with error', async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'parent1@schoolbus.local',
      password: 'DefinitiveWrongPassword!999',
    })
    if (!error) throw new Error('Expected authentication error for wrong password!')
  })

  // 6. Test Edge Function: provision-user via Manager 1 session
  let provisionedUserId = null
  await assertTest('Manager calls provision-user Edge Function to create driver', async () => {
    const { data: mgrAuth, error: mgrAuthErr } = await supabase.auth.signInWithPassword({
      email: 'manager1@schoolbus.local',
      password: manager1Pwd,
    })
    if (mgrAuthErr || !mgrAuth.session) throw new Error(mgrAuthErr?.message || 'Manager login failed')
    managerSessionToken = mgrAuth.session.access_token

    const uniqueDigits = Math.floor(10000000 + Math.random() * 90000000)
    const testPhone = `09${uniqueDigits}` // Raw local Ethiopian format to test normalization
    const randomTempPwd = 'Temp_' + crypto.randomBytes(8).toString('hex') + '!Aa1'

    const res = await fetch(`${url}/functions/v1/provision-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerSessionToken}`,
      },
      body: JSON.stringify({
        role: 'driver',
        phone: testPhone,
        full_name: 'Test Cleaned Driver',
        temp_password: randomTempPwd,
      }),
    })

    const body = await res.json()
    if (!res.ok) {
      throw new Error(`Edge Function error [${res.status}]: ${body.error || JSON.stringify(body)}`)
    }
    if (!body.success || !body.user_id) {
      throw new Error(`Invalid response payload from provision-user: ${JSON.stringify(body)}`)
    }
    if (body.school_id !== managerSchoolId) {
      throw new Error(`Tenant leak: Expected school_id ${managerSchoolId}, got ${body.school_id}`)
    }
    provisionedUserId = body.user_id
  })

  // 7. Test Edge Function: reset-password via Manager 1 session
  await assertTest('Manager calls reset-password Edge Function on provisioned user', async () => {
    if (!managerSessionToken || !provisionedUserId) throw new Error('Manager session or provisioned user missing')

    const res = await fetch(`${url}/functions/v1/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerSessionToken}`,
      },
      body: JSON.stringify({
        target_profile_id: provisionedUserId,
      }),
    })

    const body = await res.json()
    if (!res.ok) {
      throw new Error(`Edge Function error [${res.status}]: ${body.error || JSON.stringify(body)}`)
    }
    if (!body.success || !body.temp_password) {
      throw new Error(`Invalid response payload from reset-password: ${JSON.stringify(body)}`)
    }
  })

  // 8. Test Edge Function: Cross-tenant password reset rejected
  await assertTest('Manager 1 cannot reset password for School 2 Manager (Cross-tenant 403)', async () => {
    if (!managerSessionToken) throw new Error('Manager session token unavailable')

    const res = await fetch(`${url}/functions/v1/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${managerSessionToken}`,
      },
      body: JSON.stringify({
        target_profile_id: '00000000-0000-0000-0000-000000000007',
      }),
    })

    if (res.status !== 403) {
      const body = await res.json().catch(() => ({}))
      throw new Error(`Expected 403 Forbidden for cross-tenant reset, got ${res.status}: ${JSON.stringify(body)}`)
    }
  })

  // 9. Cleanup: Clean up provisioned test account
  await assertTest('Cleanup provisioned test driver from remote database', async () => {
    if (adminSupabase && provisionedUserId) {
      // 1. Delete audit_log entries referencing target_user_id
      await adminSupabase.from('audit_log').delete().filter('details_json->>target_user_id', 'eq', provisionedUserId)
      // 2. Delete public.profiles
      await adminSupabase.from('profiles').delete().eq('id', provisionedUserId)
      // 3. Delete auth.users
      const { error: delErr } = await adminSupabase.auth.admin.deleteUser(provisionedUserId)
      if (delErr) {
        throw new Error(`Cleanup failed: ${delErr.message}`)
      }
    }
  })

  console.log('\n======================================================')
  console.log(`🎉 AUTH TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`)
  console.log('======================================================\n')

  if (failed > 0) process.exit(1)
}

run().catch((err) => {
  console.error('\nFatal test execution error:', err)
  process.exit(1)
})
