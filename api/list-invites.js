import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    return res.status(200).end()
  }

  res.setHeader('Access-Control-Allow-Origin', '*')

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed. Use GET.' })
  }

  const authHeader = req.headers.authorization
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing Authorization header.' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://debcrfoznffbcwmwporw.supabase.co'
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_tCiLVFj76LGQ7YEF5wLsGQ_MRvHOFtb'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlYmNyZm96bmZmYmN3bXdwb3J3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjIzODg2OSwiZXhwIjoyMTA3ODE0ODY5fQ.fQ1zFbxLFY0Mv7EKj07TzZgtcXdOgR7oZ6H3NLKhVHI'

  try {
    const clientSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authErr } = await clientSupabase.auth.getUser()
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid authentication session.' })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    const { data: callerProfile, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, role, is_active')
      .eq('id', user.id)
      .single()

    if (profErr || !callerProfile || !callerProfile.is_active) {
      return res.status(403).json({ error: 'Forbidden: Inactive or unauthorized profile.' })
    }

    if (callerProfile.role !== 'manager' && callerProfile.role !== 'owner') {
      return res.status(403).json({ error: 'Only school managers can view parent invitations.' })
    }

    let query = adminSupabase
      .from('parent_invites')
      .select('id, school_id, student_id, phone_number, expires_at, used_at, revoked_at, created_at')
      .order('created_at', { ascending: false })

    if (callerProfile.role === 'manager') {
      query = query.eq('school_id', callerProfile.school_id)
    }

    const { data: invites, error: inviteErr } = await query

    if (inviteErr) {
      return res.status(500).json({ error: inviteErr.message, invites: [] })
    }

    return res.status(200).json({ success: true, invites: invites || [] })
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Server error', invites: [] })
  }
}
