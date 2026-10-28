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
    // 1. Authenticate caller
    const clientSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authErr } = await clientSupabase.auth.getUser()
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid authentication session.' })
    }

    // 2. Verify caller is active Platform Owner
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: profile, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, role, is_active')
      .eq('id', user.id)
      .single()

    if (profErr || !profile || profile.role !== 'owner' || !profile.is_active) {
      return res.status(403).json({ error: 'Forbidden: Only active Platform Owners can reset manager passwords.' })
    }

    // 3. Parse payload
    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {
        // keep as is
      }
    }
    const { manager_id, new_password } = body || {}

    if (!manager_id) {
      return res.status(400).json({ error: 'Missing manager_id parameter.' })
    }

    // 4. Verify target user is a manager
    const { data: targetProfile, error: targetProfErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, full_name, role, schools(name, code)')
      .eq('id', manager_id)
      .single()

    if (targetProfErr || !targetProfile || targetProfile.role !== 'manager') {
      return res.status(404).json({ error: 'Manager account not found.' })
    }

    // 5. Generate secure password if not provided
    const finalPassword = new_password?.trim() || (() => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'
      let pwd = ''
      for (let i = 0; i < 10; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return pwd
    })()

    if (finalPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long.' })
    }

    // 6. Update auth user password
    const { data: updatedUser, error: updateErr } = await adminSupabase.auth.admin.updateUserById(manager_id, {
      password: finalPassword,
      app_metadata: {
        must_change_password: true,
      },
    })

    if (updateErr) {
      return res.status(400).json({ error: `Failed to update password: ${updateErr.message}` })
    }

    // 7. Audit log
    await adminSupabase.from('audit_log').insert({
      school_id: targetProfile.school_id,
      performed_by: null,
      action: 'RESET_PASSWORD',
      details_json: {
        actor_id: user.id,
        actor_role: 'owner',
        target_user_id: manager_id,
        target_role: 'manager',
      },
    })

    return res.status(200).json({
      success: true,
      manager_id,
      email: updatedUser.user.email,
      new_password: finalPassword,
      full_name: targetProfile.full_name,
      school_name: targetProfile.schools?.name || 'School',
      school_code: targetProfile.schools?.code || '—',
    })
  } catch (err) {
    console.error('Unhandled error in reset-manager-password:', err)
    return res.status(500).json({ error: err.message || 'Internal server error resetting password.' })
  }
}
