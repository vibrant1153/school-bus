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

  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://debcrfoznffbcwmwporw.supabase.co'
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_tCiLVFj76LGQ7YEF5wLsGQ_MRvHOFtb'
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlYmNyZm96bmZmYmN3bXdwb3J3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc5MjIzODg2OSwiZXhwIjoyMTA3ODE0ODY5fQ.fQ1zFbxLFY0Mv7EKj07TzZgtcXdOgR7oZ6H3NLKhVHI'

  try {
    let body = req.body
    if (typeof body === 'string') {
      try { body = JSON.parse(body) } catch {}
    }

    const { token, phone, password, full_name } = body || {}
    if (!token) {
      return res.status(400).json({ error: 'Missing invitation token.' })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex')

    // 1. Fetch invitation record
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
        students (
          id,
          full_name
        )
      `)
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (fetchErr || !invite) {
      return res.status(404).json({ error: 'This invitation link is invalid or does not exist.' })
    }

    if (invite.revoked_at) {
      return res.status(410).json({ error: 'This invitation has been revoked by the school.' })
    }

    if (invite.used_at) {
      return res.status(410).json({ error: 'This invitation has already been claimed and used.' })
    }

    if (new Date() >= new Date(invite.expires_at)) {
      return res.status(410).json({ error: 'This invitation link has expired. Please contact your school administrator.' })
    }

    // 2. Check caller identity: Is user already logged in?
    let parentUserId = null
    const authHeader = req.headers.authorization
    if (authHeader) {
      const clientSupabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user } } = await clientSupabase.auth.getUser()
      if (user) {
        parentUserId = user.id
      }
    }

    // Normalize phone numbers for verification
    const cleanInputPhone = (phone || '').replace(/\D/g, '')
    const cleanInvitePhone = (invite.phone_number || '').replace(/\D/g, '')

    if (right(cleanInputPhone, 9) !== right(cleanInvitePhone, 9)) {
      return res.status(400).json({
        error: 'The entered phone number does not match the invitation registered by the school.',
      })
    }

    // 3. If parent is NOT logged in: Create or sign in user
    let userEmail = `user_${cleanInvitePhone}@schoolbus.local`

    if (!parentUserId) {
      if (!password || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters long.' })
      }

      // Check if user already exists in auth
      const { data: existingUsers } = await adminSupabase.auth.admin.listUsers({ perPage: 100 })
      const foundUser = existingUsers?.users?.find(
        (u) => u.email === userEmail || u.phone === invite.phone_number
      )

      if (foundUser) {
        return res.status(409).json({
          already_registered: true,
          error: 'An account with this phone number already exists. Please log in with your password to link your child.',
        })
      }

      // Create new user in Supabase auth
      const { data: newUser, error: createErr } = await adminSupabase.auth.admin.createUser({
        email: userEmail,
        password: password,
        email_confirm: true,
        phone: invite.phone_number,
        user_metadata: {
          full_name: full_name?.trim() || 'Parent Guardian',
          role: 'parent',
          school_id: invite.school_id,
        },
      })

      if (createErr || !newUser?.user) {
        console.error('Error creating auth user:', createErr)
        return res.status(400).json({ error: createErr?.message || 'Failed to create parent account.' })
      }

      parentUserId = newUser.user.id
    }

    // 4. Atomic claim execution via RPC or single-transaction update
    // Try app_security.claim_parent_invitation RPC first
    const { data: rpcRes, error: rpcErr } = await adminSupabase.rpc('claim_parent_invitation', {
      p_token_hash: tokenHash,
      p_parent_id: parentUserId,
      p_phone: invite.phone_number,
      p_full_name: full_name?.trim() || 'Parent Guardian',
    })

    if (!rpcErr && rpcRes && rpcRes.success) {
      return res.status(200).json({
        success: true,
        student_id: rpcRes.student_id,
        student_name: rpcRes.student_name || invite.students?.full_name,
        email: userEmail,
      })
    }

    // Fallback: If RPC not yet created in remote DB, execute atomic table writes directly with service role
    // Atomic update on invite: ensures single-use with optimistic concurrency
    const { data: updatedInvite, error: updateErr } = await adminSupabase
      .from('parent_invites')
      .update({ used_at: new Date().toISOString() })
      .eq('id', invite.id)
      .is('used_at', null)
      .is('revoked_at', null)
      .select('id')
      .single()

    if (updateErr || !updatedInvite) {
      return res.status(409).json({
        error: 'This invitation has already been claimed or revoked.',
      })
    }

    // Upsert into parent_student
    await adminSupabase.from('parent_student').upsert({
      parent_id: parentUserId,
      student_id: invite.student_id,
      school_id: invite.school_id,
      status: 'active',
    })

    // Upsert into guardians (backward compatibility for parent home, live map, absence report)
    await adminSupabase.from('guardians').upsert({
      school_id: invite.school_id,
      student_id: invite.student_id,
      profile_id: parentUserId,
      relationship: 'parent',
      is_primary: true,
      alert_radius_m: 500,
    }, { onConflict: 'student_id,profile_id' })

    // Ensure profiles record
    await adminSupabase.from('profiles').upsert({
      id: parentUserId,
      school_id: invite.school_id,
      role: 'parent',
      full_name: full_name?.trim() || 'Parent Guardian',
      phone: invite.phone_number,
      language_pref: 'en',
    })

    return res.status(200).json({
      success: true,
      student_id: invite.student_id,
      student_name: invite.students?.full_name,
      email: userEmail,
    })
  } catch (err) {
    console.error('claim-invite error:', err)
    return res.status(500).json({ error: err.message || 'Server error claiming invitation.' })
  }
}

function right(str, n) {
  if (!str) return ''
  return str.length <= n ? str : str.slice(str.length - n)
}
