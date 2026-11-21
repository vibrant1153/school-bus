import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
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
    const clientSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authErr } = await clientSupabase.auth.getUser()
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized.' })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: callerProfile } = await adminSupabase
      .from('profiles')
      .select('id, school_id, role, is_active')
      .eq('id', user.id)
      .single()

    if (!callerProfile || !callerProfile.is_active || (callerProfile.role !== 'manager' && callerProfile.role !== 'owner')) {
      return res.status(403).json({ error: 'Only school managers can revoke invitations.' })
    }

    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch {}
    }

    const { student_id, invite_id } = body || {}
    if (!student_id && !invite_id) {
      return res.status(400).json({ error: 'student_id or invite_id is required.' })
    }

    const updateQuery = adminSupabase
      .from('parent_invites')
      .update({ revoked_at: new Date().toISOString() })
      .is('used_at', null)
      .is('revoked_at', null)

    if (invite_id) {
      updateQuery.eq('id', invite_id)
    } else {
      updateQuery.eq('student_id', student_id)
    }

    if (callerProfile.role === 'manager') {
      updateQuery.eq('school_id', callerProfile.school_id)
    }

    const { error: updateErr } = await updateQuery
    if (updateErr) {
      return res.status(500).json({ error: 'Failed to revoke invitation: ' + updateErr.message })
    }

    return res.status(200).json({ success: true, message: 'Invitation revoked successfully.' })
  } catch (err) {
    console.error('revoke-invite error:', err)
    return res.status(500).json({ error: err.message || 'Server error revoking invitation.' })
  }
}
