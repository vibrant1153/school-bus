import { createClient } from '@supabase/supabase-js'

const rawUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Strip any trailing slashes or /rest/v1 suffix if accidentally pasted
export const supabaseUrl = rawUrl
  ? rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/+$/, '')
  : ''

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project-ref.supabase.co' &&
  supabaseAnonKey !== 'your-anon-key-here' &&
  !supabaseUrl.includes('your-project-ref')
)

// In dev mode when env vars are not yet populated, createClient with placeholders
// would throw an error if URL is not a valid URL format. We safeguard that.
const safeUrl = isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co'
const safeKey = isSupabaseConfigured ? supabaseAnonKey : 'placeholder-anon-key'

export const supabase = createClient(safeUrl, safeKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
})

/**
 * Verifies network connectivity and authentication against the configured Supabase instance.
 * Does not require tables to be created yet (Phase 2, Step 2).
 */
export async function testSupabaseConnection() {
  if (!isSupabaseConfigured) {
    return {
      ok: false,
      configured: false,
      message: 'Supabase credentials are missing or placeholder in .env. Create your .env file with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    }
  }

  try {
    const { error } = await supabase.auth.getSession()
    if (error) {
      return {
        ok: false,
        configured: true,
        message: `Supabase returned an authentication error: ${error.message}`,
      }
    }

    return {
      ok: true,
      configured: true,
      message: `Successfully connected to Supabase (${supabaseUrl})!`,
    }
  } catch (err) {
    return {
      ok: false,
      configured: true,
      message: `Network error connecting to Supabase: ${err.message}`,
    }
  }
}
