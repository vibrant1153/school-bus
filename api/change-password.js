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
    // 1. Authenticate the caller session
    const clientSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authErr } = await clientSupabase.auth.getUser()
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid authentication session.' })
    }

    // 2. Parse body
    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        // keep as is
      }
    }
    const { new_password } = body || {}

    if (!new_password || typeof new_password !== 'string' || new_password.trim().length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters long.' })
    }

    // 3. Update password via Supabase Admin and clear must_change_password
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    const updatedAppMetadata = {
      ...(user.app_metadata || {}),
      must_change_password: false,
    }

    const { error: updateErr } = await adminSupabase.auth.admin.updateUserById(user.id, {
      password: new_password.trim(),
      app_metadata: updatedAppMetadata,
      user_metadata: {
        ...(user.user_metadata || {}),
        must_change_password: false,
      },
    })

    if (updateErr) {
      console.error('Password update error:', updateErr.message)
      return res.status(400).json({ error: `Failed to update password: ${updateErr.message}` })
    }

    // 4. Fetch profile to write audit log if school_id exists
    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('school_id, role, full_name')
      .eq('id', user.id)
      .maybeSingle()

    if (profile?.school_id) {
      await adminSupabase.from('audit_log').insert({
        school_id: profile.school_id,
        performed_by: user.id,
        action: 'UPDATE_PASSWORD',
        details_json: {
          user_id: user.id,
          role: profile.role,
          full_name: profile.full_name,
        },
      })
    }

    return res.status(200).json({
      success: true,
      message: 'Password successfully updated.',
    })
  } catch (err) {
    console.error('Unhandled error in change-password handler:', err)
    return res.status(500).json({ error: err.message || 'Internal server error while changing password.' })
  }
}
