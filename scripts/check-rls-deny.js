import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envPath = resolve(process.cwd(), '.env')

if (!existsSync(envPath)) {
  console.error('\n❌ [RLS Check] .env file not found.')
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
  console.error('\n❌ [RLS Check] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing in .env')
  process.exit(1)
}

const supabase = createClient(url, anonKey)

const tables = [
  'schools',
  'profiles',
  'buses',
  'routes',
  'route_schedules',
  'stops',
  'students',
  'guardians',
  'student_stops',
  'bus_assignments',
  'trips',
  'bus_locations_latest',
  'bus_location_history',
  'absences',
  'alert_events',
  'push_subscriptions',
  'trip_summaries',
  'audit_log',
]

console.log(`\n🔒 [RLS Check] Hardened verification: Testing anon key across all ${tables.length} tables...`)
console.log(`   Operations tested: SELECT, INSERT, UPDATE, DELETE`)
console.log(`   Supabase URL: ${url}\n`)

let allProtected = true
const failures = []

for (const table of tables) {
  const pkCol = table === 'bus_locations_latest' ? 'bus_id' : 'id'
  const dummyUuid = '00000000-0000-0000-0000-000000000000'

  // 1. Test SELECT: must return 2xx status AND exactly 0 rows. Any HTTP error or non-2xx is a FAIL.
  const selectRes = await supabase.from(table).select('*').limit(5)
  let selectOk = false

  if (selectRes.error) {
    failures.push(`Table "${table}" SELECT failed with error: [${selectRes.error.code || selectRes.status}] ${selectRes.error.message}`)
  } else if (selectRes.status < 200 || selectRes.status >= 300) {
    failures.push(`Table "${table}" SELECT returned non-2xx status: ${selectRes.status}`)
  } else if (selectRes.data && selectRes.data.length > 0) {
    failures.push(`🚨 DATA LEAK: Table "${table}" returned ${selectRes.data.length} row(s) to unauthenticated anon key!`)
  } else if (Array.isArray(selectRes.data) && selectRes.data.length === 0) {
    selectOk = true
  } else {
    failures.push(`Table "${table}" SELECT returned invalid or missing data payload`)
  }

  // 2. Test INSERT: must be rejected (error returned, or non-2xx status). If insert succeeds, it is a FAIL.
  const insertRes = await supabase.from(table).insert({ [pkCol]: dummyUuid }).select()
  let insertOk = false

  if (!insertRes.error && insertRes.data && insertRes.data.length > 0) {
    failures.push(`🚨 WRITE LEAK: Anon key successfully INSERTED a row into table "${table}"!`)
  } else if (insertRes.error || insertRes.status >= 400) {
    insertOk = true
  } else {
    failures.push(`Table "${table}" INSERT neither returned an error nor confirmed rejection (status: ${insertRes.status})`)
  }

  // 3. Test UPDATE: must not modify any rows.
  const updateRes = await supabase.from(table).update({ [pkCol]: dummyUuid }).neq(pkCol, dummyUuid).select()
  let updateOk = false

  if (!updateRes.error && updateRes.data && updateRes.data.length > 0) {
    failures.push(`🚨 UPDATE LEAK: Anon key successfully UPDATED ${updateRes.data.length} row(s) in table "${table}"!`)
  } else if (updateRes.error || (Array.isArray(updateRes.data) && updateRes.data.length === 0)) {
    updateOk = true
  } else {
    failures.push(`Table "${table}" UPDATE unexpected state (status: ${updateRes.status})`)
  }

  // 4. Test DELETE: must not delete any rows.
  const deleteRes = await supabase.from(table).delete().neq(pkCol, dummyUuid).select()
  let deleteOk = false

  if (!deleteRes.error && deleteRes.data && deleteRes.data.length > 0) {
    failures.push(`🚨 DELETE LEAK: Anon key successfully DELETED ${deleteRes.data.length} row(s) from table "${table}"!`)
  } else if (deleteRes.error || (Array.isArray(deleteRes.data) && deleteRes.data.length === 0)) {
    deleteOk = true
  } else {
    failures.push(`Table "${table}" DELETE unexpected state (status: ${deleteRes.status})`)
  }

  if (selectOk && insertOk && updateOk && deleteOk) {
    console.log(`   ✅ Table "${table}": SELECT (0 rows) | INSERT (blocked) | UPDATE (0 rows) | DELETE (0 rows)`)
  } else {
    allProtected = false
    console.log(`   ❌ Table "${table}": FAILED verification!`)
  }
}

if (!allProtected || failures.length > 0) {
  console.log('\n❌ [RLS Check] Hardened verification FAILED with the following issues:')
  for (const f of failures) {
    console.error(`   - ${f}`)
  }
  console.log('')
  process.exit(1)
}

console.log('\n🎉 [RLS Check] SUCCESS: All 18 tables strictly enforce default-deny across SELECT, INSERT, UPDATE, and DELETE for anon.\n')
