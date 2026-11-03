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
  if (!serviceRoleKey) {
    return res.status(500).json({ error: 'Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY environment variable is not configured.' })
  }

  try {
    // 1. Authenticate driver
    const clientSupabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authErr } = await clientSupabase.auth.getUser()
    if (authErr || !user) {
      return res.status(401).json({ error: 'Unauthorized: Invalid authentication session.' })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    // 2. Verify driver profile
    const { data: profile, error: profErr } = await adminSupabase
      .from('profiles')
      .select('id, school_id, role, is_active, full_name')
      .eq('id', user.id)
      .single()

    if (profErr || !profile || !profile.is_active) {
      return res.status(403).json({ error: 'Forbidden: Inactive or missing driver profile.' })
    }

    if (profile.role !== 'driver') {
      return res.status(403).json({ error: 'Only assigned drivers can start trips.' })
    }

    // 3. Parse body
    let body = req.body
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body)
      } catch {}
    }
    const requestedDirection = (body?.direction || 'morning').toLowerCase()
    const cleanDirection = requestedDirection === 'afternoon' ? 'afternoon' : 'morning'

    // 4. Retrieve driver active bus assignment
    const { data: assignment, error: assignErr } = await adminSupabase
      .from('bus_assignments')
      .select(`
        id,
        school_id,
        bus_id,
        route_id,
        buses ( id, name, capacity ),
        routes ( id, name, code, start_time )
      `)
      .eq('driver_profile_id', user.id)
      .eq('is_active', true)
      .maybeSingle()

    if (assignErr || !assignment) {
      return res.status(400).json({
        error: 'No active bus assignment found for your driver account. Please ask the school manager to link your bus and route.',
      })
    }

    const todayStr = new Date().toISOString().split('T')[0]

    // 5. Check if an active in-progress trip already exists on this bus
    const { data: existingActive } = await adminSupabase
      .from('trips')
      .select(`
        id, school_id, bus_id, route_id, trip_date, direction, status, scheduled_start, started_at,
        buses ( name ), routes ( name )
      `)
      .eq('bus_id', assignment.bus_id)
      .eq('status', 'in_progress')
      .order('started_at', { ascending: false })
      .limit(1)

    if (existingActive && existingActive.length > 0) {
      return res.status(200).json({
        success: true,
        already_active: true,
        trip: existingActive[0],
      })
    }

    // 6. Look for scheduled trip today for this route & direction
    let targetTripId = null
    const { data: scheduledTrips } = await adminSupabase
      .from('trips')
      .select('id')
      .eq('route_id', assignment.route_id)
      .eq('trip_date', todayStr)
      .eq('direction', cleanDirection)
      .eq('status', 'scheduled')
      .limit(1)

    if (scheduledTrips && scheduledTrips.length > 0) {
      targetTripId = scheduledTrips[0].id
    } else {
      // Create new trip record for today
      const { data: newTrip, error: createTripErr } = await adminSupabase
        .from('trips')
        .insert({
          school_id: assignment.school_id,
          bus_id: assignment.bus_id,
          route_id: assignment.route_id,
          driver_profile_id: user.id,
          trip_date: todayStr,
          direction: cleanDirection,
          status: 'scheduled',
          scheduled_start: new Date().toISOString(),
        })
        .select('id')
        .single()

      if (createTripErr) {
        return res.status(400).json({ error: `Could not create trip record: ${createTripErr.message}` })
      }
      targetTripId = newTrip.id
    }

    // 7. Transition trip to in_progress
    const nowIso = new Date().toISOString()
    const { data: updatedTrip, error: startErr } = await adminSupabase
      .from('trips')
      .update({
        status: 'in_progress',
        started_at: nowIso,
        driver_profile_id: user.id,
        updated_at: nowIso,
      })
      .eq('id', targetTripId)
      .select(`
        id, school_id, bus_id, route_id, trip_date, direction, status, scheduled_start, started_at,
        buses ( name ), routes ( name )
      `)
      .single()

    if (startErr) {
      return res.status(400).json({ error: `Could not start trip: ${startErr.message}` })
    }

    // 8. Emit tripStarted alert event for parents
    await adminSupabase
      .from('alert_events')
      .upsert({
        school_id: assignment.school_id,
        trip_id: targetTripId,
        event_type: 'tripStarted',
        dedupe_key: `started_${targetTripId}`,
        payload_json: {
          started_at: nowIso,
          driver_id: user.id,
          direction: cleanDirection,
          bus_name: updatedTrip?.buses?.name || 'Bus',
          route_name: updatedTrip?.routes?.name || 'Route',
        },
      }, { onConflict: 'school_id,trip_id,dedupe_key' })

    // 9. Audit log entry
    await adminSupabase.from('audit_log').insert({
      school_id: assignment.school_id,
      performed_by: user.id,
      action: 'START_TRIP',
      details_json: {
        trip_id: targetTripId,
        direction: cleanDirection,
        bus_id: assignment.bus_id,
        route_id: assignment.route_id,
        started_at: nowIso,
      },
    })

    return res.status(200).json({
      success: true,
      trip: updatedTrip,
    })
  } catch (err) {
    console.error('API /api/start-trip error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
