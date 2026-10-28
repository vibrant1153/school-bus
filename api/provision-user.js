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
      return res.status(403).json({ error: 'Forbidden: Only active Platform Owners can provision school managers.' })
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
    const { school_id, full_name, email, phone, temp_password } = body || {}

    if (!school_id) {
      return res.status(400).json({ error: 'Missing required parameter: school_id' })
    }
    if (!email?.trim()) {
      return res.status(400).json({ error: 'Missing required parameter: email' })
    }

    // 4. Verify school exists
    const { data: school, error: schoolErr } = await adminSupabase
      .from('schools')
      .select('id, name, code')
      .eq('id', school_id)
      .single()

    if (schoolErr || !school) {
      return res.status(404).json({ error: 'School not found.' })
    }

    // 5. Invariant: Each school can only have one active manager account
    const { data: existingManager } = await adminSupabase
      .from('profiles')
      .select('id, full_name, phone')
      .eq('school_id', school_id)
      .eq('role', 'manager')
      .eq('is_active', true)
      .maybeSingle()

    if (existingManager) {
      return res.status(409).json({
        error: `"${school.name}" already has an assigned manager (${existingManager.full_name}). Each school operates under one primary manager account. You do not need to create another account—use "Reset Password" to update their login credentials.`
      })
    }

    // 6. Generate secure temp password if not provided
    const finalPassword = temp_password?.trim() || (() => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'
      let pwd = ''
      for (let i = 0; i < 10; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return pwd
    })()

    // Normalize phone if provided
    let cleanPhone = null
    if (phone?.trim()) {
      let digits = phone.trim().replace(/\D/g, '')
      if (digits.startsWith('09') || digits.startsWith('07')) {
        digits = '251' + digits.slice(1)
      } else if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
        digits = '251' + digits
      }
      if (digits.startsWith('251') && digits.length === 12) {
        cleanPhone = `+${digits}`
      } else if (phone.trim().startsWith('+')) {
        cleanPhone = phone.trim()
      } else {
        cleanPhone = `+${digits}`
      }
    }

    // 7. Create user in Supabase auth
    const { data: createdAuth, error: createAuthErr } = await adminSupabase.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: finalPassword,
      email_confirm: true,
      user_metadata: {
        phone: cleanPhone,
        full_name: full_name?.trim() || 'School Manager',
      },
      app_metadata: {
        must_change_password: true,
      },
    })

    if (createAuthErr) {
      const msg = createAuthErr.message?.toLowerCase() || ''
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return res.status(409).json({
          error: `An account with the email "${email.trim().toLowerCase()}" already exists. Please choose a different email address.`
        })
      }
      return res.status(400).json({ error: `Could not create authentication account: ${createAuthErr.message}` })
    }

    const newUserId = createdAuth.user.id

    // 8. Insert profile with role 'manager'
    const { error: profileInsertErr } = await adminSupabase
      .from('profiles')
      .insert({
        id: newUserId,
        school_id,
        role: 'manager',
        full_name: full_name?.trim() || 'School Manager',
        phone: cleanPhone,
        is_active: true,
      })

    if (profileInsertErr) {
      // Rollback auth user
      await adminSupabase.auth.admin.deleteUser(newUserId)
      const errDetail = profileInsertErr.message || ''
      if (errDetail.includes('idx_profiles_phone_unique') || profileInsertErr.code === '23505') {
        return res.status(409).json({
          error: `The phone number ${cleanPhone || phone} is already linked to another account in SchoolBus Connect. Please use a unique phone number or leave the phone field blank.`
        })
      }
      return res.status(400).json({
        error: 'Could not create manager profile. Please check that the email and phone number are unique.'
      })
    }

    // 8. Log audit entry
    await adminSupabase.from('audit_log').insert({
      school_id,
      performed_by: null,
      action: 'PROVISION_USER',
      details_json: {
        actor_id: user.id,
        actor_role: 'owner',
        created_user_id: newUserId,
        created_role: 'manager',
        email: email.trim().toLowerCase(),
        full_name: full_name?.trim() || 'School Manager',
      },
    })

    return res.status(200).json({
      success: true,
      user_id: newUserId,
      email: email.trim().toLowerCase(),
      temp_password: finalPassword,
      role: 'manager',
      school_id,
      school_name: school.name,
    })
  } catch (err) {
    console.error('Unhandled error in provision-user:', err)
    return res.status(500).json({ error: err.message || 'Internal server error provisioning manager.' })
  }
}
