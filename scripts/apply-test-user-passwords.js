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
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('❌ VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in .env')
  process.exit(1)
}

const adminSupabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const defaultPwd = env.TEST_DEFAULT_PASSWORD

const userPasswords = {
  'owner@schoolbus.local': env.TEST_OWNER_PASSWORD || defaultPwd,
  'manager1@schoolbus.local': env.TEST_MANAGER1_PASSWORD || defaultPwd,
  'driver1@schoolbus.local': env.TEST_DRIVER1_PASSWORD || defaultPwd,
  'parent1@schoolbus.local': env.TEST_PARENT1_PASSWORD || defaultPwd,
  'manager2@schoolbus.local': env.TEST_MANAGER2_PASSWORD || defaultPwd,
}

async function run() {
  console.log(`🔐 Updating test user passwords on remote dev: ${url}`)
  const { data: users, error: listErr } = await adminSupabase.auth.admin.listUsers({ perPage: 100 })
  if (listErr) {
    console.error('Failed to list users:', listErr.message)
    process.exit(1)
  }

  for (const user of users.users) {
    const targetPassword = userPasswords[user.email]
    if (targetPassword) {
      console.log(`  Updating password for ${user.email}...`)
      const { error: updErr } = await adminSupabase.auth.admin.updateUserById(user.id, {
        password: targetPassword,
        app_metadata: {
          must_change_password: false,
        },
      })
      if (updErr) {
        console.error(`  ❌ Failed for ${user.email}:`, updErr.message)
      } else {
        console.log(`  ✅ Successfully updated ${user.email}`)
      }
    }
  }

  console.log('\nAll test user passwords updated from .env!')
}

run().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
