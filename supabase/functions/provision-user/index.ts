import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function generateTempPassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$'
  let pwd = ''
  for (let i = 0; i < length; i++) {
    pwd += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return pwd
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured on Edge Function runtime.')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Authenticate the caller using standard anon client with the caller's JWT
    const clientSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: callerUser }, error: callerError } = await clientSupabase.auth.getUser()
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid caller token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Query caller profile to verify manager/owner role
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: callerProfile, error: profileErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, role, is_active')
      .eq('id', callerUser.id)
      .single()

    if (profileErr || !callerProfile) {
      return new Response(JSON.stringify({ error: 'Forbidden: Caller profile not found' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!callerProfile.is_active || !['manager', 'owner'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: Insufficient privileges to provision users' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Parse request payload
    const body = await req.json()
    const { phone, role: targetRole, full_name, temp_password } = body
    let { email, school_id: targetSchoolId } = body

    // Managers can only provision users within their own school
    if (callerProfile.role === 'manager') {
      targetSchoolId = callerProfile.school_id
    }

    if (!targetRole || !['driver', 'parent', 'manager'].includes(targetRole)) {
      return new Response(JSON.stringify({ error: 'Invalid role. Must be driver, parent, or manager.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (!targetSchoolId) {
      return new Response(JSON.stringify({ error: 'Missing target school_id.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Validate and normalize phone to E.164 (+251...)
    let cleanPhone = null
    if (phone) {
      let digits = phone.replace(/\D/g, '')
      if (digits.startsWith('09') || digits.startsWith('07')) {
        digits = '251' + digits.slice(1)
      } else if ((digits.startsWith('9') || digits.startsWith('7')) && digits.length === 9) {
        digits = '251' + digits
      }
      if (digits.startsWith('251') && digits.length === 12) {
        cleanPhone = `+${digits}`
      } else if (phone.startsWith('+')) {
        cleanPhone = phone.trim()
      } else {
        cleanPhone = `+${digits}`
      }
    }

    if (!cleanPhone && !email) {
      return new Response(JSON.stringify({ error: 'Either email or phone number is required.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // If no email supplied, generate username representation from normalized phone
    if (!email && cleanPhone) {
      const sanitizedPhone = cleanPhone.replace('+', '')
      email = `user_${sanitizedPhone}@schoolbus.local`
    }

    const finalTempPassword = temp_password || generateTempPassword(10)

    // 4. Create user in auth.users via admin API
    const { data: createdAuth, error: createAuthErr } = await adminSupabase.auth.admin.createUser({
      email,
      password: finalTempPassword,
      email_confirm: true,
      user_metadata: {
        phone: cleanPhone,
        full_name: full_name?.trim() || '',
      },
      app_metadata: {
        must_change_password: true,
      },
    })

    if (createAuthErr) {
      return new Response(JSON.stringify({ error: `Auth creation failed: ${createAuthErr.message}` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const newUserId = createdAuth.user.id

    // 5. Insert public.profiles entry via admin client
    const { error: insertProfileErr } = await adminSupabase
      .from('profiles')
      .insert({
        id: newUserId,
        school_id: targetSchoolId,
        role: targetRole,
        full_name: full_name?.trim() || email,
        phone: cleanPhone,
        is_active: true,
      })

    if (insertProfileErr) {
      // Rollback auth user if profile insertion failed
      await adminSupabase.auth.admin.deleteUser(newUserId)
      return new Response(JSON.stringify({ error: `Profile creation failed: ${insertProfileErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 6. Record audit_log entry
    await adminSupabase
      .from('audit_log')
      .insert({
        school_id: targetSchoolId,
        performed_by: callerProfile.id,
        action: 'PROVISION_USER',
        details_json: {
          target_user_id: newUserId,
          email,
          phone: cleanPhone,
          role: targetRole,
          full_name,
        },
      })

    return new Response(
      JSON.stringify({
        success: true,
        user_id: newUserId,
        email,
        temp_password: finalTempPassword,
        role: targetRole,
        school_id: targetSchoolId,
      }),
      {
        status: 201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
