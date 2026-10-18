import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const envPath = resolve(process.cwd(), '.env')

if (!existsSync(envPath)) {
  console.log('\n❌ [Supabase Check] .env file not found.')
  console.log('   Please copy .env.example to .env and add your VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.\n')
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
const key = env.VITE_SUPABASE_ANON_KEY

if (!url || !key || url.includes('your-project-ref') || key.includes('your-anon-key')) {
  console.log('\n⚠️  [Supabase Check] .env exists, but placeholder values are still set.')
  console.log('   Please update VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY with your real Supabase project credentials.\n')
  process.exit(1)
}

console.log(`\n🔍 [Supabase Check] Connecting to: ${url}...`)

try {
  const supabase = createClient(url, key)
  const { error } = await supabase.auth.getSession()
  if (error) {
    console.error(`❌ [Supabase Check] Auth error: ${error.message}\n`)
    process.exit(1)
  }
  console.log('✅ [Supabase Check] Connection SUCCESSFUL! Supabase client connected properly.\n')
} catch (err) {
  console.error(`❌ [Supabase Check] Network error: ${err.message}\n`)
  process.exit(1)
}
