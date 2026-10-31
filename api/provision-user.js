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

    // 2. Verify caller is active Platform Owner or Manager
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const { data: callerProfile, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, role, is_active')
      .eq('id', user.id)
      .single()

    if (profErr || !callerProfile || !callerProfile.is_active) {
      return res.status(403).json({ error: 'Forbidden: Inactive or unauthorized profile.' })
    }

    if (callerProfile.role !== 'owner' && callerProfile.role !== 'manager') {
      return res.status(403).json({ error: 'Forbidden: Only owners and managers can provision user accounts.' })
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
    const {
      full_name,
      email,
      phone,
      temp_password,
      relationship = 'Parent',
      student_id,
    } = body || {}

    let role = body?.role || 'manager'
    let school_id = body?.school_id

    // If caller is manager, force school_id to their school
    if (callerProfile.role === 'manager') {
      school_id = callerProfile.school_id
      if (role !== 'parent' && role !== 'driver') {
        role = 'parent'
      }
    }

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
      return res.status(404).json({ error: 'School not found.' })
    }

    // 5. If provisioning manager: Invariant of single manager per school
    if (role === 'manager') {
      if (callerProfile.role !== 'owner') {
        return res.status(403).json({ error: 'Only Platform Owners can provision school managers.' })
      }
      const { data: existingManager } = await adminSupabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('school_id', school_id)
        .eq('role', 'manager')
        .eq('is_active', true)
        .maybeSingle()

      if (existingManager) {
        return res.status(409).json({
          error: `"${school.name}" already has an assigned manager (${existingManager.full_name}). Each school operates under one primary manager account. You do not need to create another account—use "Reset Password" to update their login credentials.`,
        })
      }
    }

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

    // Resolve login email
    let cleanEmail = email?.trim()?.toLowerCase() || ''
    if (!cleanEmail && cleanPhone) {
      cleanEmail = `user_${cleanPhone.replace('+', '')}@schoolbus.local`
    }

    if (!cleanEmail) {
      return res.status(400).json({ error: 'Either email or phone number is required.' })
    }

    // 6. Check if user profile already exists with this phone or email in this school
    let existingProfile = null
    if (cleanPhone) {
      const { data: byPhone } = await adminSupabase
        .from('profiles')
        .select('id, school_id, full_name, phone, role')
        .eq('phone', cleanPhone)
        .maybeSingle()
      if (byPhone) existingProfile = byPhone
    }

    // If user profile already exists with this phone number
    if (existingProfile) {
      if (role === 'driver') {
        const isSelf = existingProfile.id === callerProfile.id
        return res.status(409).json({
          error: isSelf
            ? `The phone number ${cleanPhone} is already assigned to your manager account (${callerProfile.full_name}). Each school bus driver must have their own unique phone number for driver app login.`
            : `The phone number ${cleanPhone} is already registered to "${existingProfile.full_name}" (${existingProfile.role}). Please provide a unique phone number for this driver.`,
        })
      }

      if (role === 'parent' && student_id) {
        if (existingProfile.school_id !== school_id) {
          return res.status(409).json({
            error: `This phone number (${cleanPhone}) is registered to a user in another school. In SchoolBus Connect, parent accounts are isolated per school.`,
          })
        }

        // Link to student in guardians table
        const { data: guardianRow, error: guardErr } = await adminSupabase
        .from('guardians')
        .upsert({
          school_id,
          student_id,
          profile_id: existingProfile.id,
          relationship: relationship || 'Parent',
          alert_radius_m: 500,
        }, { onConflict: 'student_id,profile_id' })
        .select()
        .single()

      if (guardErr) {
        return res.status(400).json({ error: `Could not link parent to student: ${guardErr.message}` })
      }

      return res.status(200).json({
        success: true,
        already_existed: true,
        user_id: existingProfile.id,
        full_name: existingProfile.full_name,
        email: cleanEmail,
        phone: cleanPhone,
        role: 'parent',
        linked_student_id: student_id,
        guardian_id: guardianRow?.id,
        message: `Linked existing parent "${existingProfile.full_name}" to student.`,
      })
    }

    // 7. Generate secure temp password
    const finalPassword = temp_password?.trim() || (() => {
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'
      let pwd = ''
      for (let i = 0; i < 10; i++) {
        pwd += chars.charAt(Math.floor(Math.random() * chars.length))
      }
      return pwd
    })()

    // 8. Create user in Supabase auth
    const { data: createdAuth, error: createAuthErr } = await adminSupabase.auth.admin.createUser({
      email: cleanEmail,
      password: finalPassword,
      email_confirm: true,
      user_metadata: {
        phone: cleanPhone,
        full_name: full_name?.trim() || (role === 'manager' ? 'School Manager' : 'Parent'),
      },
      app_metadata: {
        must_change_password: true,
      },
    })

    if (createAuthErr) {
      const msg = createAuthErr.message?.toLowerCase() || ''
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return res.status(409).json({
          error: `An account with the email "${cleanEmail}" already exists. Please choose a different email or phone.`,
        })
      }
      return res.status(400).json({ error: `Could not create authentication account: ${createAuthErr.message}` })
    }

    const newUserId = createdAuth.user.id

    // 9. Insert profile
    const { error: profileInsertErr } = await adminSupabase
      .from('profiles')
      .insert({
        id: newUserId,
        school_id,
        role,
        full_name: full_name?.trim() || (role === 'manager' ? 'School Manager' : 'Parent Guardian'),
        phone: cleanPhone,
        is_active: true,
      })

    if (profileInsertErr) {
      await adminSupabase.auth.admin.deleteUser(newUserId)
      const errDetail = profileInsertErr.message || ''
      if (errDetail.includes('idx_profiles_phone_unique') || profileInsertErr.code === '23505') {
        return res.status(409).json({
          error: `The phone number ${cleanPhone || phone} is already registered in SchoolBus Connect. Please use a unique phone number or leave the phone field blank.`,
        })
      }
      return res.status(400).json({
        error: `Could not create profile: ${profileInsertErr.message}`,
      })
    }

    // 10. If provisioning parent for a student, link them in guardians table!
    let guardianId = null
    if (role === 'parent' && student_id) {
      const { data: gData, error: gErr } = await adminSupabase
        .from('guardians')
        .insert({
          school_id,
          student_id,
          profile_id: newUserId,
          relationship: relationship || 'Parent',
          alert_radius_m: 500,
        })
        .select('id')
        .single()

      if (gErr) {
        console.warn('Parent user created, but guardian link failed:', gErr.message)
      } else {
        guardianId = gData?.id
      }
    }

    // 11. Log audit entry
    await adminSupabase.from('audit_log').insert({
      school_id,
      performed_by: callerProfile.id,
      action: 'PROVISION_USER',
      details_json: {
        actor_id: user.id,
        actor_role: callerProfile.role,
        target_user_id: newUserId,
        target_role: role,
        target_email: cleanEmail,
        student_id: student_id || null,
      },
    })

    return res.status(200).json({
      success: true,
      user_id: newUserId,
      email: cleanEmail,
      temp_password: finalPassword,
      full_name: full_name?.trim() || 'Parent Guardian',
      role,
      school_name: school.name,
      school_code: school.code,
      linked_student_id: student_id || null,
      guardian_id: guardianId,
    })
  } catch (err) {
    console.error('Unhandled error in provision-user handler:', err)
    return res.status(500).json({ error: err.message || 'Internal server error provisioning user.' })
  }
}
