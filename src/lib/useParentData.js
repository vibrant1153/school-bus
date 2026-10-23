import { useState, useEffect } from 'react'
import { supabase, isSupabaseConfigured } from './supabase.js'
import { useAuth } from './useAuth.js'
import {
  SAMPLE_ALERTS,
  busStatus as prototypeBusStatus,
  distanceMeters,
  setAlertMeters,
} from '../prototype.js'

// Fallback sample child for offline / unauthenticated preview
const SAMPLE_CHILD = {
  id: '00000000-0000-0000-0000-000000000001',
  fullName: 'Abel (Sample Child)',
  grade: 3,
  busNumber: 3,
  stopName: 'Stop 4 - Bole Rwanda',
  stopPosition: [51.518, -0.113],
  morningPickupTime: '07:15',
  afternoonDropoffTime: '15:45',
  alertRadiusM: 500,
  schoolName: 'Hilltop International Academy',
  schoolPhone: '+251911223344',
}

export function useParentData() {
  const { user } = useAuth()

  const [children, setChildren] = useState([])
  const [selectedChildId, setSelectedChildId] = useState(null)
  const [activeTrip, setActiveTrip] = useState(null)
  const [latestBusLocation, setLatestBusLocation] = useState(null)
  const [absences, setAbsences] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [isLiveBackend, setIsLiveBackend] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  // Keep a live clock for pure rendering and staleness countdown
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(clock)
  }, [])

  // 1. Fetch children and stop assignments
  useEffect(() => {
    let ignore = false

    async function fetchChildren() {
      if (!isSupabaseConfigured || !user) {
        if (!ignore) {
          setChildren([SAMPLE_CHILD])
          setSelectedChildId(SAMPLE_CHILD.id)
          setAlerts(SAMPLE_ALERTS)
          setLoading(false)
          setIsLiveBackend(false)
        }
        return
      }

      try {
        const { data: guardianRows, error: guardianErr } = await supabase
          .from('guardians')
          .select(`
            id,
            student_id,
            alert_radius_m,
            relationship,
            is_primary,
            students (
              id,
              school_id,
              full_name,
              grade,
              is_active,
              schools (
                id,
                name,
                contact_phone
              )
            )
          `)
          .eq('profile_id', user.id)

        if (guardianErr) throw guardianErr

        if (!guardianRows || guardianRows.length === 0) {
          if (!ignore) {
            setChildren([])
            setLoading(false)
            setIsLiveBackend(true)
          }
          return
        }

        const studentIds = guardianRows.map((g) => g.student_id)

        const { data: stopRows, error: stopErr } = await supabase
          .from('student_stops')
          .select(`
            id,
            student_id,
            direction,
            stop_id,
            stops (
              id,
              route_id,
              name,
              lat,
              lng,
              sequence_morning,
              routes (
                id,
                name,
                code,
                start_time
              )
            )
          `)
          .in('student_id', studentIds)

        if (stopErr) throw stopErr

        const routeIds = [
          ...new Set(
            (stopRows || [])
              .map((s) => s.stops?.route_id)
              .filter(Boolean)
          ),
        ]

        let busAssignments = []
        if (routeIds.length > 0) {
          const { data: busData, error: busErr } = await supabase
            .from('bus_assignments')
            .select(`
              route_id,
              bus_id,
              buses (
                id,
                name
              )
            `)
            .in('route_id', routeIds)
            .eq('is_active', true)

          if (!busErr && busData) {
            busAssignments = busData
          }
        }

        const mappedChildren = guardianRows.map((g) => {
          const student = g.students
          const childStops = (stopRows || []).filter((s) => s.student_id === g.student_id)
          const morningStop = childStops.find((s) => s.direction === 'morning')?.stops || childStops[0]?.stops
          const afternoonStop = childStops.find((s) => s.direction === 'afternoon')?.stops || morningStop

          const assignedBus = busAssignments.find((b) => b.route_id === morningStop?.route_id)?.buses

          return {
            id: student.id,
            guardianId: g.id,
            fullName: student.full_name,
            grade: student.grade,
            schoolId: student.school_id,
            schoolName: student.schools?.name || 'School',
            schoolPhone: student.schools?.contact_phone || '',
            alertRadiusM: g.alert_radius_m || 500,
            relationship: g.relationship,
            isPrimary: g.is_primary,
            morningStop: morningStop
              ? {
                  id: morningStop.id,
                  name: morningStop.name,
                  lat: morningStop.lat,
                  lng: morningStop.lng,
                  time: morningStop.routes?.start_time ? morningStop.routes.start_time.slice(0, 5) : '07:15',
                  routeId: morningStop.route_id,
                  routeName: morningStop.routes?.name,
                }
              : null,
            afternoonStop: afternoonStop
              ? {
                  id: afternoonStop.id,
                  name: afternoonStop.name,
                  lat: afternoonStop.lat,
                  lng: afternoonStop.lng,
                  time: '15:45',
                  routeId: afternoonStop.route_id,
                  routeName: afternoonStop.routes?.name,
                }
              : null,
            busNumber: assignedBus?.name ? assignedBus.name.replace(/\D/g, '') || assignedBus.name : 1,
            busId: assignedBus?.id || null,
          }
        })

        if (!ignore) {
          setChildren(mappedChildren)
          setSelectedChildId((prev) => (prev && mappedChildren.some((c) => c.id === prev) ? prev : mappedChildren[0]?.id || null))
          setIsLiveBackend(true)
          setLoading(false)
        }
      } catch (err) {
        if (!ignore) {
          console.error('Error loading parent data:', err)
          setError(err.message || 'Failed to load child information')
          setChildren([SAMPLE_CHILD])
          setSelectedChildId(SAMPLE_CHILD.id)
          setIsLiveBackend(false)
          setLoading(false)
        }
      }
    }

    fetchChildren()
    return () => {
      ignore = true
    }
  }, [user])

  const selectedChild = children.find((c) => c.id === selectedChildId) || children[0] || null

  // 2. Fetch active trip and bus location (polled every 12s)
  useEffect(() => {
    let ignore = false

    async function fetchTripAndLocation() {
      if (!isSupabaseConfigured || !user || !selectedChild) return

      try {
        const routeId = selectedChild.morningStop?.routeId || selectedChild.afternoonStop?.routeId
        if (!routeId) return

        const { data: trips, error: tripErr } = await supabase
          .from('trips')
          .select(`
            id,
            bus_id,
            route_id,
            trip_date,
            direction,
            status,
            started_at,
            ended_at,
            buses (
              id,
              name
            )
          `)
          .eq('route_id', routeId)
          .order('started_at', { ascending: false })
          .limit(3)

        if (tripErr) throw tripErr

        const inProgressTrip = trips?.find((t) => t.status === 'in_progress') || null

        if (!ignore) {
          setActiveTrip(inProgressTrip)
        }

        if (inProgressTrip && inProgressTrip.bus_id) {
          const { data: locData, error: locErr } = await supabase
            .from('bus_locations_latest')
            .select('*')
            .eq('bus_id', inProgressTrip.bus_id)
            .maybeSingle()

          if (!ignore) {
            if (!locErr && locData) {
              setLatestBusLocation(locData)
            } else {
              setLatestBusLocation(null)
            }
          }
        } else if (!ignore) {
          setLatestBusLocation(null)
        }
      } catch (err) {
        console.warn('Could not refresh trip/location:', err.message)
      }
    }

    fetchTripAndLocation()
    const interval = setInterval(fetchTripAndLocation, 12000)
    return () => {
      ignore = true
      clearInterval(interval)
    }
  }, [user, selectedChild])

  const [absenceVersion, setAbsenceVersion] = useState(0)

  // 3. Fetch absences for selected child
  useEffect(() => {
    let ignore = false

    async function fetchAbsences() {
      if (!isSupabaseConfigured || !user || !selectedChild) {
        if (!ignore) setAbsences([])
        return
      }

      try {
        const { data: absData, error: absErr } = await supabase
          .from('absences')
          .select(`
            id,
            student_id,
            trip_date,
            direction,
            reported_by,
            created_at
          `)
          .eq('student_id', selectedChild.id)
          .order('trip_date', { ascending: false })
          .limit(10)

        if (absErr) throw absErr

        if (absData && absData.length > 0) {
          const absIds = absData.map((a) => a.id)
          const { data: reasonData } = await supabase
            .from('absence_reasons')
            .select('absence_id, reason')
            .in('absence_id', absIds)

          const reasonMap = new Map((reasonData || []).map((r) => [r.absence_id, r.reason]))

          const mappedAbsences = absData.map((a) => ({
            ...a,
            reason: reasonMap.get(a.id) || null,
          }))
          if (!ignore) setAbsences(mappedAbsences)
        } else if (!ignore) {
          setAbsences([])
        }
      } catch (err) {
        console.warn('Could not load absences:', err.message)
      }
    }

    fetchAbsences()
    return () => {
      ignore = true
    }
  }, [user, selectedChild, absenceVersion])

  // 4. Fetch alert events
  useEffect(() => {
    let ignore = false

    async function fetchAlerts() {
      if (!isSupabaseConfigured || !user) {
        if (!ignore) setAlerts(SAMPLE_ALERTS)
        return
      }

      try {
        const { data, error: alertErr } = await supabase
          .from('alert_events')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(20)

        if (alertErr) throw alertErr

        if (!ignore) {
          setAlerts(data && data.length > 0 ? data : [])
        }
      } catch (err) {
        console.warn('Could not load alerts from DB:', err.message)
        if (!ignore) setAlerts(SAMPLE_ALERTS)
      }
    }

    fetchAlerts()
    return () => {
      ignore = true
    }
  }, [user])

  // Mutations
  async function reportAbsence({ tripDate, direction, reason }) {
    if (!selectedChild || !user) {
      throw new Error('Must be signed in to report an absence.')
    }

    const { data: newAbsence, error: absErr } = await supabase
      .from('absences')
      .insert({
        school_id: selectedChild.schoolId,
        student_id: selectedChild.id,
        trip_date: tripDate,
        direction: direction || 'both',
        reported_by: user.id,
      })
      .select()
      .single()

    if (absErr) {
      if (absErr.code === '23505') {
        throw new Error('An absence for this child and direction on this date is already reported.')
      }
      throw new Error(absErr.message || 'Failed to report absence.')
    }

    if (newAbsence && reason?.trim()) {
      const { error: reasonErr } = await supabase
        .from('absence_reasons')
        .insert({
          absence_id: newAbsence.id,
          school_id: selectedChild.schoolId,
          reason: reason.trim(),
        })

      if (reasonErr) {
        console.warn('Absence was recorded, but reason could not be saved:', reasonErr.message)
      }
    }

    setAbsenceVersion((v) => v + 1)
    return { success: true }
  }

  async function cancelAbsence(absenceId) {
    if (!user) throw new Error('Must be signed in.')

    const { error: cancelErr } = await supabase
      .from('absences')
      .delete()
      .eq('id', absenceId)

    if (cancelErr) {
      throw new Error(cancelErr.message || 'Could not cancel absence. The trip may already have started.')
    }

    setAbsenceVersion((v) => v + 1)
    return { success: true }
  }

  async function updateAlertRadius(meters) {
    if (![200, 500, 1000].includes(meters)) return

    if (!user || !selectedChild?.guardianId) {
      setAlertMeters(meters)
      setChildren((prev) =>
        prev.map((c) => (c.id === selectedChildId ? { ...c, alertRadiusM: meters } : c))
      )
      return
    }

    try {
      const { error: updateErr } = await supabase
        .from('guardians')
        .update({ alert_radius_m: meters })
        .eq('id', selectedChild.guardianId)

      if (updateErr) throw updateErr

      setChildren((prev) =>
        prev.map((c) => (c.id === selectedChildId ? { ...c, alertRadiusM: meters } : c))
      )
    } catch (err) {
      console.error('Failed to update alert radius in DB:', err)
      setAlertMeters(meters)
    }
  }

  // Telemetry calculation using pure clock state `now`
  const childStopPos = selectedChild?.morningStop
    ? [selectedChild.morningStop.lat, selectedChild.morningStop.lng]
    : [51.518, -0.113]

  let busStatus = { mode: 'none', secondsAgo: null }
  let busDistanceM = 0
  let busPosition = null

  if (activeTrip && latestBusLocation) {
    const recordedAt = new Date(latestBusLocation.recorded_at).getTime()
    const secondsAgo = Math.max(0, Math.floor((now - recordedAt) / 1000))
    const isStale = secondsAgo >= 60

    busPosition = [latestBusLocation.lat, latestBusLocation.lng]
    busDistanceM = distanceMeters(busPosition, childStopPos)
    busStatus = {
      mode: isStale ? 'stale' : 'live',
      secondsAgo,
    }
  } else if (!isLiveBackend) {
    busStatus = prototypeBusStatus('live')
    busDistanceM = 1000
    busPosition = [51.514, -0.118]
  }

  return {
    children,
    selectedChild,
    selectedChildId,
    setSelectedChildId,
    activeTrip,
    latestBusLocation,
    busPosition,
    busDistanceM,
    busStatus,
    absences,
    alerts,
    loading,
    error,
    isLiveBackend,
    reportAbsence,
    cancelAbsence,
    updateAlertRadius,
  }
}
