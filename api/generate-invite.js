import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

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
    // 1. Authenticate manager
    const clientSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authErr } = await clientSupabase.auth.getUser()
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid authentication session.' })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    // 2. Verify caller is manager or owner
    const { data: callerProfile, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, role, is_active')
      .eq('id', user.id)
      .single()

    if (profErr || !callerProfile || !callerProfile.is_active) {
      return res.status(403).json({ error: 'Forbidden: Inactive or unauthorized profile.' })
    }

    if (callerProfile.role !== 'manager' && callerProfile.role !== 'owner') {
      return res.status(403).json({ error: 'Only school managers can generate parent invitations.' })
    }

    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch {}
    }

    const { student_id, phone_number } = body || {}
    if (!student_id) {
      return res.status(400).json({ error: 'student_id is required.' })
    }

    // 3. Verify student belongs to manager's school
    let studentQuery = adminSupabase
      .from('students')
      .select('id, school_id, full_name, parent_phone')
      .eq('id', student_id)

    if (callerProfile.role === 'manager') {
      studentQuery = studentQuery.eq('school_id', callerProfile.school_id)
    }

    let { data: student, error: studentErr } = await studentQuery.single()

    // Fallback if parent_phone column does not exist yet (migration pending)
    if (studentErr && (studentErr.code === '42703' || studentErr.message?.includes('parent_phone'))) {
      let fallbackQuery = adminSupabase
        .from('students')
        .select('id, school_id, full_name')
        .eq('id', student_id)

      if (callerProfile.role === 'manager') {
        fallbackQuery = fallbackQuery.eq('school_id', callerProfile.school_id)
      }
      const fallbackRes = await fallbackQuery.single()
      student = fallbackRes.data
      studentErr = fallbackRes.error
    }

    if (studentErr || !student) {
      return res.status(404).json({ error: 'Student not found in your school.' })
    }

    const targetPhone = (phone_number || student.parent_phone || '').trim()
    if (!targetPhone) {
      return res.status(400).json({
        error: 'A parent phone number is required to generate an invitation link. Please provide the phone number.',
      })
    }

    // Normalize phone number (Ethiopia format: +251...)
    let digits = targetPhone.replace(/\D/g, '')
    if (digits.startsWith('09') || digits.startsWith('07')) {
      digits = '251' + digits.slice(1)
    } else if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
      digits = '251' + digits
    }
    const cleanPhone = digits.startsWith('251') && digits.length === 12 ? `+${digits}` : targetPhone

    // Update student.parent_phone if empty (ignoring if column pending migration)
    if (!student.parent_phone) {
      try {
        await adminSupabase
          .from('students')
          .update({ parent_phone: cleanPhone })
          .eq('id', student.id)
      } catch {}
    }

    // 4. Revoke previous unused pending invites for this student
    try {
      await adminSupabase
        .from('parent_invites')
        .update({ revoked_at: new Date().toISOString() })
        .eq('student_id', student.id)
        .is('used_at', null)
        .is('revoked_at', null)
    } catch {}

    // 5. Generate cryptographically secure random token (32 bytes = 64 hex characters)
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')

    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() // 72 hours

    // 6. Insert into parent_invites
    const { data: newInvite, error: insertErr } = await adminSupabase
      .from('parent_invites')
      .insert({
        school_id: student.school_id,
        student_id: student.id,
        phone_number: cleanPhone,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by: callerProfile.id,
      })
      .select('id, expires_at')
      .single()

    if (insertErr) {
      console.error('Invite insert error:', insertErr)
      if (insertErr.code === 'PGRST205' || insertErr.message?.includes('parent_invites')) {
        return res.status(500).json({
          error: 'The parent_invites database table is missing. Please run the migration script in your Supabase SQL Editor: supabase/migrations/20261121000001_parent_invitations_and_linking.sql'
        })
      }
      return res.status(500).json({ error: 'Failed to record parent invitation in database.' })
    }
        expires_at: expiresAt,
        created_by: callerProfile.id,
      })
      .select('id, student_id, phone_number, expires_at, created_at')
      .single()

    if (insertErr) {
      console.error('Error inserting parent_invite:', insertErr)
      return res.status(500).json({ error: 'Failed to create invitation: ' + insertErr.message })
    }

    return res.status(200).json({
      success: true,
      invite_id: newInvite.id,
      token: rawToken, // ONLY returned once to the manager
      student_id: student.id,
      student_name: student.full_name,
      phone_number: cleanPhone,
      expires_at: expiresAt,
    })
  } catch (err) {
    console.error('generate-invite error:', err)
    return res.status(500).json({ error: err.message || 'Server error generating invitation.' })
  }
}
