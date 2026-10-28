import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    return res.status(200).end()
  }

  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header.' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://debcrfoznffbcwmwporw.supabase.co'
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_tCiLVFj76LGQ7YEF5wLsGQ_MRvHOFtb'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlYmNyZm96bmZmYmN3bXdwb3J3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjIzODg2OSwiZXhwIjoyMTA3ODE0ODY5fQ.fQ1zFbxLFY0Mv7EKj07TzZgtcXdOgR7oZ6H3NLKhVHI'

  try {
    // 1. Authenticate caller with their bearer token
    const clientSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authErr } = await clientSupabase.auth.getUser()
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid authentication session.' })
    }

    // 2. Verify caller profile has active 'owner' role
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: profile, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', user.id)
      .single()

    if (profErr || !profile || profile.role !== 'owner' || !profile.is_active) {
      return res.status(403).json({ error: 'Forbidden: Only active Platform Owners can delete schools.' })
    }

    // 3. Parse school_id from body
    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        // keep as is
      }
    }
    const { school_id } = body || {}

    if (!school_id) {
      return res.status(400).json({ error: 'Missing required parameter: school_id' })
    }

    // 4. Verify school exists
    const { data: school, error: schoolErr } = await adminSupabase
      .from('schools')
      .select('id, name, code')
      .eq('id', school_id)
      .single()

    if (schoolErr || !school) {
      return res.status(404).json({ error: 'School not found or already deleted.' })
    }

    // 5. Invariant check: ensure no trips are currently in progress
    const { count: activeTrips, error: tripErr } = await adminSupabase
      .from('trips')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', school_id)
      .eq('status', 'in_progress')

    if (!tripErr && activeTrips && activeTrips > 0) {
      return res.status(400).json({
        error: `Cannot delete school while ${activeTrips} trip(s) are actively in progress. Please end all ongoing trips first.`
      })
    }

    // 6. Find all profiles belonging to this school before deletion to clean up auth.users
    const { data: schoolUsers } = await adminSupabase
      .from('profiles')
      .select('id')
      .eq('school_id', school_id)

    // 7. Delete school from schools table (CASCADE removes buses, routes, stops, students, guardians, trips, etc.)
    const { error: delErr } = await adminSupabase
      .from('schools')
      .delete()
      .eq('id', school_id)

    if (delErr) {
      console.error('Failed to delete school record:', delErr)
      return res.status(500).json({ error: `Database deletion failed: ${delErr.message}` })
    }

    // 8. Clean up auth.users accounts for the deleted school's managers, drivers, and parents
    if (schoolUsers && schoolUsers.length > 0) {
      for (const u of schoolUsers) {
        try {
          await adminSupabase.auth.admin.deleteUser(u.id)
        } catch (cleanupErr) {
          console.warn(`Could not remove auth user ${u.id}:`, cleanupErr.message)
        }
      }
    }

    return res.status(200).json({
      success: true,
      school_id,
      deleted_name: school.name,
      deleted_code: school.code,
    })
  } catch (err) {
    console.error('Unhandled error in delete-school:', err)
    return res.status(500).json({ error: err.message || 'Internal server error deleting school.' })
  }
}
