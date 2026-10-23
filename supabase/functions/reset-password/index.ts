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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Supabase environment variables not configured.')
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Authenticate the caller
    const clientSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user: callerUser }, error: callerError } = await clientSupabase.auth.getUser()
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 2. Fetch caller profile to verify manager/owner status
    const adminSupabase = createClient(supabaseUrl, supabaseServiceKey)
    const { data: callerProfile, error: callerProfErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, role, is_active')
      .eq('id', callerUser.id)
      .single()

    if (callerProfErr || !callerProfile || !callerProfile.is_active || !['manager', 'owner'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: Only managers and owners can reset user passwords' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Parse request payload
    const body = await req.json()
    const { target_profile_id } = body
    if (!target_profile_id) {
      return new Response(JSON.stringify({ error: 'Missing target_profile_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Verify target user profile exists within manager's school
    const { data: targetProfile, error: targetProfErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, full_name, role')
      .eq('id', target_profile_id)
      .single()

    if (targetProfErr || !targetProfile) {
      return new Response(JSON.stringify({ error: 'Target profile not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (callerProfile.role === 'manager' && targetProfile.school_id !== callerProfile.school_id) {
      return new Response(JSON.stringify({ error: 'Cross-tenant violation: Cannot reset password for another school' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Manager can only reset passwords for parents and drivers in their school
    if (!['parent', 'driver'].includes(targetProfile.role)) {
      return new Response(JSON.stringify({ error: 'Forbidden: Password reset may target only parent and driver users' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Generate temporary password and update auth user (with app_metadata)
    const tempPassword = generateTempPassword(10)
    const { error: updateAuthErr } = await adminSupabase.auth.admin.updateUserById(target_profile_id, {
      password: tempPassword,
      app_metadata: { must_change_password: true },
    })

    if (updateAuthErr) {
      return new Response(JSON.stringify({ error: `Auth password update failed: ${updateAuthErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Revoke all active sessions for target user
    try {
      await fetch(`${supabaseUrl}/auth/v1/admin/users/${target_profile_id}/logout`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${supabaseServiceKey}`,
          apikey: supabaseServiceKey,
        },
      })
    } catch (logoutErr: any) {
      console.warn('Session revocation notice:', logoutErr.message)
    }

    // 6. Record in audit_log
    await adminSupabase
      .from('audit_log')
      .insert({
        school_id: targetProfile.school_id,
        performed_by: callerProfile.id,
        action: 'RESET_PASSWORD',
        details_json: {
          target_user_id: target_profile_id,
          target_name: targetProfile.full_name,
          target_role: targetProfile.role,
        },
      })

    return new Response(
      JSON.stringify({
        success: true,
        target_profile_id,
        temp_password: tempPassword,
      }),
      {
        status: 200,
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
