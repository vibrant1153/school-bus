import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    return res.status(200).end()
  }

  res.setHeader('Access-Control-Allow-Origin', '*')

  const token = req.method === 'GET' ? req.query?.token : (req.body?.token || req.query?.token)
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ valid: false, error: 'Missing invitation token.' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://debcrfoznffbcwmwporw.supabase.co'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlYmNyZm96bmZmYmN3bXdwb3J3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjIzODg2OSwiZXhwIjoyMTA3ODE0ODY5fQ.fQ1zFbxLFY0Mv7EKj07TzZgtcXdOgR7oZ6H3NLKhVHI'

  try {
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex')

    const { data: invite, error: fetchErr } = await adminSupabase
      .from('parent_invites')
      .select(`
        id,
        school_id,
        student_id,
        phone_number,
        expires_at,
        used_at,
        revoked_at,
        schools (
          name
        )
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (fetchErr || !invite) {
      return res.status(404).json({
        valid: false,
        error: 'This invitation link is invalid or does not exist.',
      })
    }

    if (invite.revoked_at) {
      return res.status(410).json({
        valid: false,
        error: 'This invitation has been revoked by the school administrator.',
      })
    }

    if (invite.used_at) {
      return res.status(410).json({
        valid: false,
        error: 'This invitation has already been used and cannot be claimed again.',
      })
    }

    const now = new Date()
    const exp = new Date(invite.expires_at)
    if (now >= exp) {
      return res.status(410).json({
        valid: false,
        error: 'This invitation link has expired. Please ask your school administrator to generate a new invitation.',
      })
    }

    // Mask phone number for display (e.g. "+251 ••• •• 3344")
    const phone = invite.phone_number
    let maskedPhone = phone
    if (phone.length >= 7) {
      const start = phone.slice(0, 4)
      const end = phone.slice(-4)
      maskedPhone = `${start} ••• •• ${end}`
    }

    // Check if a parent user already exists with this phone number
    let isExistingUser = false
    const { data: existingProf } = await adminSupabase
      .from('profiles')
      .select('id, full_name')
      .eq('phone', invite.phone_number)
      .maybeSingle()

    if (existingProf) {
      isExistingUser = true
    }

    // Safe return: do not expose child full name or student ID before successful claim
    return res.status(200).json({
      valid: true,
      school_name: invite.schools?.name || 'School Bus Transit',
      phone_number: invite.phone_number,
      phone_masked: maskedPhone,
      is_existing_user: isExistingUser,
      expires_at: invite.expires_at,
    })
  } catch (err) {
    console.error('validate-invite error:', err)
    return res.status(500).json({ valid: false, error: 'Server error validating invitation.' })
  }
}
