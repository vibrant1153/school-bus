import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from './supabase.js'
import { useAuth } from './useAuth.js'
import { BUSES as SAMPLE_BUSES, ROUTES as SAMPLE_ROUTES, STUDENTS as SAMPLE_STUDENTS, TRIPS as SAMPLE_TRIPS } from '../manager/managerData.js'

export function useManagerData() {
  const { user, profile } = useAuth()
  const schoolId = profile?.school_id

  const [school, setSchool] = useState(null)
  const [students, setStudents] = useState([])
  const [buses, setBuses] = useState([])
  const [routes, setRoutes] = useState([])
  const [todayTrips, setTodayTrips] = useState([])
  const [auditLogs, setAuditLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isLiveBackend, setIsLiveBackend] = useState(false)
  const [reloadTrigger, setReloadTrigger] = useState(0)

  // 1. Fetch School & Roster Data
  useEffect(() => {
    let ignore = false

    async function fetchManagerData() {
      if (!isSupabaseConfigured || !user || !schoolId) {
        if (!ignore) {
          setSchool({
            id: '00000000-0000-0000-0000-000000000001',
            name: 'Sample Academy',
            code: 'SMP-01',
            timezone: 'Africa/Addis_Ababa',
            contact_phone: '+251911223344',
          })
          setStudents(SAMPLE_STUDENTS.map((s) => ({
            id: s.id,
            fullName: s.name,
            grade: s.grade,
            stopId: s.stopId,
            routeId: s.routeId,
            parentName: s.parent,
          })))
          setBuses(SAMPLE_BUSES.map((b) => ({
            id: b.id,
            busNumber: b.number,
            plateNumber: b.plate,
            driverName: b.driver,
            routeId: b.routeId,
          })))
          setRoutes(SAMPLE_ROUTES)
          setTodayTrips(SAMPLE_TRIPS)
          setAuditLogs([])
          setLoading(false)
          setIsLiveBackend(false)
        }
        return
      }

      try {
        setLoading(true)

        // 1. Fetch School Info
        const { data: schoolData, error: schoolErr } = await supabase
          .from('schools')
          .select('*')
          .eq('id', schoolId)
          .single()

        if (schoolErr) throw schoolErr

        // 2. Fetch Students + Guardians + Assigned Stops
        const { data: studentRows, error: studentErr } = await supabase
          .from('students')
          .select(`
            id,
            full_name,
            grade,
            is_active,
            guardians (
              id,
              profile_id,
              relationship,
              profiles (
                full_name,
                phone
              )
            ),
            student_stops (
              id,
              direction,
              stop_id,
              stops (
                id,
                name,
                route_id,
                routes (
                  id,
                  name
                )
              )
            )
          `)
          .eq('school_id', schoolId)
          .order('full_name')

        if (studentErr) throw studentErr

        // 3. Fetch Buses + Plates + Driver Assignment
        const { data: busRows, error: busErr } = await supabase
          .from('buses')
          .select(`
            id,
            name,
            capacity,
            is_active,
            bus_plates!fk_bus_plates_bus (
              plate_number
            ),
            bus_assignments (
              id,
              route_id,
              driver_profile_id,
              is_active,
              profiles (
                full_name,
                phone
              ),
              routes (
                id,
                name
              )
            )
          `)
          .eq('school_id', schoolId)
          .order('name')

        if (busErr) throw busErr

        // 4. Fetch Routes + Stops
        const { data: routeRows, error: routeErr } = await supabase
          .from('routes')
          .select(`
            id,
            name,
            code,
            is_active,
            stops (
              id,
              name,
              lat,
              lng,
              sequence_morning
            )
          `)
          .eq('school_id', schoolId)
          .order('name')

        if (routeErr) throw routeErr

        // 5. Fetch Today's Trips
        const { data: tripRows, error: tripErr } = await supabase
          .from('trips')
          .select(`
            id,
            bus_id,
            route_id,
            driver_profile_id,
            trip_date,
            direction,
            status,
            started_at,
            completed_at,
            buses (
              name
            ),
            routes (
              name
            ),
            profiles (
              full_name
            )
          `)
          .eq('school_id', schoolId)
          .order('started_at', { ascending: false })
          .limit(20)

        if (tripErr) throw tripErr

        // 6. Fetch Recent Audit Logs
        const { data: auditRows, error: auditErr } = await supabase
          .from('audit_log')
          .select('*')
          .eq('school_id', schoolId)
          .order('created_at', { ascending: false })
          .limit(25)

        if (!auditErr && auditRows) {
          setAuditLogs(auditRows)
        }

        if (!ignore) {
          setSchool(schoolData)

          // Map students
          const mappedStudents = (studentRows || []).map((s) => {
            const guardian = s.guardians?.[0]
            const morningStop = s.student_stops?.find((st) => st.direction === 'morning')?.stops
            const afternoonStop = s.student_stops?.find((st) => st.direction === 'afternoon')?.stops || morningStop

            return {
              id: s.id,
              fullName: s.full_name,
              grade: s.grade,
              isActive: s.is_active,
              parentName: guardian?.profiles?.full_name || 'No parent linked',
              parentPhone: guardian?.profiles?.phone || '',
              morningStop: morningStop ? morningStop.name : null,
              afternoonStop: afternoonStop ? afternoonStop.name : null,
              routeId: morningStop?.route_id || null,
              routeName: morningStop?.routes?.name || 'No route',
              hasStop: Boolean(morningStop || afternoonStop),
            }
          })
          setStudents(mappedStudents)

          // Map buses
          const mappedBuses = (busRows || []).map((b) => {
            const activeAssignment = b.bus_assignments?.find((ba) => ba.is_active)
            return {
              id: b.id,
              name: b.name,
              busNumber: b.name ? b.name.replace(/\D/g, '') || b.name : '—',
              capacity: b.capacity,
              isActive: b.is_active,
              plateNumber: b.bus_plates?.[0]?.plate_number || '—',
              driverName: activeAssignment?.profiles?.full_name || null,
              driverPhone: activeAssignment?.profiles?.phone || null,
              routeId: activeAssignment?.route_id || null,
              routeName: activeAssignment?.routes?.name || 'Unassigned',
            }
          })
          setBuses(mappedBuses)

          setRoutes(routeRows || [])
          setTodayTrips(tripRows || [])
          setIsLiveBackend(true)
          setLoading(false)
        }
      } catch (err) {
        if (!ignore) {
          console.error('Error fetching manager data:', err)
          setError(err.message || 'Failed to load school management data')
          setLoading(false)
        }
      }
    }

    fetchManagerData()
    return () => {
      ignore = true
    }
  }, [user, schoolId, reloadTrigger])

  // Mutation 1: Update School Office Contact & Settings (RPC update_school_settings)
  async function updateSchoolSettings({ name, timezone, contactPhone }) {
    if (!name?.trim()) throw new Error('School name is required.')
    if (!contactPhone?.trim()) throw new Error('Contact phone is required.')

    // Format phone to E.164 if missing leading +
    let formattedPhone = contactPhone.trim()
    if (!formattedPhone.startsWith('+')) {
      if (formattedPhone.startsWith('09')) {
        formattedPhone = `+251${formattedPhone.slice(1)}`
      } else {
        formattedPhone = `+${formattedPhone}`
      }
    }

    const { error: rpcErr } = await supabase.rpc('update_school_settings', {
      p_name: name.trim(),
      p_timezone: timezone || 'Africa/Addis_Ababa',
      p_contact_phone: formattedPhone,
    })

    if (rpcErr) throw rpcErr

    setReloadTrigger((v) => v + 1)
    return { success: true }
  }

  // Mutation 2: Purge Location History of finished trips before today (RPC purge_location_history)
  async function purgeLocationHistory() {
    const { data, error: purgeErr } = await supabase.rpc('purge_location_history')
    if (purgeErr) throw purgeErr

    setReloadTrigger((v) => v + 1)
    return { success: true, purgedCount: data }
  }

  // Mutation 3: Add Student
  async function addStudent({ fullName, grade }) {
    if (!fullName?.trim()) throw new Error('Student name is required.')
    if (!schoolId) throw new Error('Manager must be assigned to a school.')

    const { data, error: insertErr } = await supabase
      .from('students')
      .insert({
        school_id: schoolId,
        full_name: fullName.trim(),
        grade: Number(grade) || null,
        is_active: true,
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    setReloadTrigger((v) => v + 1)
    return { success: true, student: data }
  }

  // Mutation 4: Add Bus & License Plate
  async function addBus({ busNumber, plateNumber, capacity }) {
    if (!busNumber) throw new Error('Bus number is required.')
    if (!schoolId) throw new Error('School ID is missing.')

    const busName = typeof busNumber === 'string' && busNumber.toLowerCase().startsWith('bus')
      ? busNumber.trim()
      : `Bus ${busNumber}`

    const { data: newBus, error: busErr } = await supabase
      .from('buses')
      .insert({
        school_id: schoolId,
        name: busName,
        capacity: Number(capacity) || 30,
        is_active: true,
      })
      .select()
      .single()

    if (busErr) throw busErr

    if (newBus && plateNumber?.trim()) {
      const { error: plateErr } = await supabase
        .from('bus_plates')
        .insert({
          bus_id: newBus.id,
          school_id: schoolId,
          plate_number: plateNumber.trim().toUpperCase(),
        })

      if (plateErr) {
        console.warn('Bus created, but plate insert failed:', plateErr.message)
      }
    }

    setReloadTrigger((v) => v + 1)
    return { success: true, bus: newBus }
  }

  // Calculate Operational Metrics
  const onRoadCount = todayTrips.filter((t) => t.status === 'in_progress').length
  const studentsWithoutStops = students.filter((s) => !s.hasStop).length
  const busesWithoutDrivers = buses.filter((b) => !b.driverName).length

  return {
    school,
    students,
    buses,
    routes,
    todayTrips,
    auditLogs,
    metrics: {
      totalTrips: todayTrips.length,
      onRoad: onRoadCount,
      totalStudents: students.length,
      studentsWithoutStops,
      busesWithoutDrivers,
    },
    loading,
    error,
    isLiveBackend,
    updateSchoolSettings,
    purgeLocationHistory,
    addStudent,
    addBus,
    refresh: () => setReloadTrigger((v) => v + 1),
  }
}
