import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

// A GPS fix this accurate (in metres) counts as "good". For testing on a
// computer, whose location is rough, you can raise this number temporarily.
const GOOD_ACCURACY_M = 50
// If no new GPS fix arrives for this long, the driver is warned.
const GPS_STALE_SECONDS = 30

async function requestWakeLock(lockRef, onRelease) {
  if (!('wakeLock' in navigator)) return 'unsupported'
  try {
    const lock = await navigator.wakeLock.request('screen')
    lock.addEventListener('release', onRelease)
    lockRef.current = lock
    return 'on'
  } catch {
    return 'failed'
  }
}

function readGps() {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) return resolve({ accuracy: null, error: 'unsupported' })
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ accuracy: pos.coords.accuracy, error: null }),
      (err) => resolve({ accuracy: null, error: err.code === 1 ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  })
}

function clock(totalSeconds) {
  const m = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const s = String(totalSeconds % 60).padStart(2, '0')
  return `${m}:${s}`
}

function Row({ label, ok, text }) {
  const color = ok === null ? 'text-night-muted' : ok ? 'text-go' : 'text-warn'
  return (
    <div className="flex justify-between gap-3 border-b border-night-line py-3.5 text-base last:border-b-0">
      <span>{label}</span>
      <b className={color}>{text}</b>
    </div>
  )
}

export default function Driver() {
  const { t } = useI18n()
  const { user, profile, signOut } = useAuth()
  const [phase, setPhase] = useState('ready')
  const [checking, setChecking] = useState(false)
  const [checked, setChecked] = useState(false)
  const [gps, setGps] = useState({ accuracy: null, error: null })
  const [wake, setWake] = useState('unknown')
  const [online, setOnline] = useState(navigator.onLine)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [fix, setFix] = useState(null)
  const [now, setNow] = useState(0)
  const [activeTrip, setActiveTrip] = useState(null)
  const [tripError, setTripError] = useState(null)
  const [delayStatus, setDelayStatus] = useState(null)
  const [delayModalOpen, setDelayModalOpen] = useState(false)
  const [selectedReason, setSelectedReason] = useState('traffic')
  const [submitting, setSubmitting] = useState(false)
  const [allowComputerLocation, setAllowComputerLocationState] = useState(() => {
    try {
      return localStorage.getItem('schoolbus.allowComputerLocation') === 'true'
    } catch {
      return false
    }
  })
  const setAllowComputerLocation = (val) => {
    try {
      localStorage.setItem('schoolbus.allowComputerLocation', val ? 'true' : 'false')
    } catch {}
    setAllowComputerLocationState(val)
  }
  const lockRef = useRef(null)

  // Fetch driver's active or scheduled trip for today
  useEffect(() => {
    let cancelled = false
    async function loadDriverTrip() {
      if (!user) return
      try {
        const todayStr = new Date().toISOString().split('T')[0]

        // 1. Check if an active in-progress trip exists on the bus
        const { data: activeTrips } = await supabase
          .from('trips')
          .select(`
            id,
            school_id,
            bus_id,
            route_id,
            trip_date,
            direction,
            status,
            scheduled_start,
            started_at,
            buses ( name ),
            routes ( name )
          `)
          .eq('status', 'in_progress')
          .order('started_at', { ascending: false })
          .limit(1)

        if (activeTrips && activeTrips.length > 0) {
          const active = activeTrips[0]
          if (active.trip_date === todayStr) {
            // Today's trip is already in progress: resume it directly
            if (!cancelled) {
              setActiveTrip(active)
              setPhase('running')
              const st = new Date(active.started_at).getTime()
              setStartedAt(st)
              setNow(Date.now())
            }
            return
          } else if (active.trip_date < todayStr) {
            // Stale unended trip from a previous day: auto-complete it to clear the bus lock
            console.warn(`Auto-completing stale trip ${active.id} from ${active.trip_date}`)
            await supabase.rpc('end_trip', { p_trip_id: active.id })
          }
        }

        // 2. Load today's trip
        const { data, error } = await supabase
          .from('trips')
          .select(`
            id,
            school_id,
            bus_id,
            route_id,
            trip_date,
            direction,
            status,
            scheduled_start,
            started_at,
            buses (
              name
            ),
            routes (
              name
            )
          `)
          .in('status', ['scheduled', 'in_progress'])
          .eq('trip_date', todayStr)
          .order('scheduled_start', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (error) {
          console.error('Error fetching driver trip:', error)
          return
        }

        if (!cancelled) {
          setActiveTrip(data || null)
          if (data && data.status === 'in_progress' && data.started_at) {
            setPhase('running')
            const st = new Date(data.started_at).getTime()
            setStartedAt(st)
            setNow(Date.now())
          }
        }
      } catch (err) {
        console.error('Failed to load driver trip:', err)
      }
    }

    loadDriverTrip()
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  const [lastUpload, setLastUpload] = useState({ time: null, accuracy: null, error: null, status: null })
  const latestGpsPointRef = useRef(null)
  const lastSentTimestampRef = useRef(null)

  // While a trip is running: read GPS continuously, tick a clock, and ask for
  // the screen-awake lock again if the browser released it.
  useEffect(() => {
    if (phase !== 'running') return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const point = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          speed: pos.coords.speed !== null && !isNaN(pos.coords.speed) ? pos.coords.speed : 0,
          heading: pos.coords.heading !== null && !isNaN(pos.coords.heading) ? pos.coords.heading : null,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp || Date.now(),
        }
        latestGpsPointRef.current = point
        setFix({ accuracy: pos.coords.accuracy, at: Date.now() })
        setGps((g) => ({ ...g, error: null }))
      },
      (err) => setGps((g) => ({ ...g, error: err.code === 1 ? 'denied' : 'unavailable' })),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock(lockRef, () => setWake('released')).then(setWake)
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(tick)
      navigator.geolocation.clearWatch(watchId)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [phase])

  // Step 8b Telemetry Loop: Upload newest GPS point every 12s through ingest_location
  // After an outage or network pause, sends ONLY the newest point; never replays old points.
  useEffect(() => {
    if (phase !== 'running' || !activeTrip?.id) return undefined

    async function sendLatestPoint() {
      const pt = latestGpsPointRef.current
      if (!pt) return

      const isComputer = allowComputerLocation || (pt.accuracy !== null && pt.accuracy > GOOD_ACCURACY_M)
      if (isComputer) {
        pt.timestamp = Date.now()
        setFix((prev) => (prev ? { ...prev, at: Date.now() } : { accuracy: pt.accuracy, at: Date.now() }))
      }

      const ageMs = Math.max(0, Date.now() - pt.timestamp)
      if (ageMs > 30000) {
        setLastUpload((prev) => ({
          ...prev,
          error: 'GPS point is older than 30s; waiting for fresh satellite signal.',
        }))
        return
      }

      // Do not replay already transmitted point timestamps (unless in computer mode where we pulse live points)
      if (!isComputer && lastSentTimestampRef.current && pt.timestamp <= lastSentTimestampRef.current) {
        return
      }

      try {
        const { data, error } = await supabase.rpc('ingest_location', {
          p_trip_id: activeTrip.id,
          p_lat: pt.lat,
          p_lng: pt.lng,
          p_heading: pt.heading,
          p_speed: pt.speed,
          p_accuracy: pt.accuracy,
          p_age_ms: Math.round(ageMs),
        })

        if (error) throw error

        lastSentTimestampRef.current = pt.timestamp
        setLastUpload({
          time: Date.now(),
          accuracy: pt.accuracy,
          error: null,
          status: data?.status || 'accepted',
        })
      } catch (err) {
        console.error('Ingest location telemetry error:', err)
        // Failure or outage: do not buffer! Next 12s tick sends ONLY the newest point.
        setLastUpload((prev) => ({
          ...prev,
          error: err.message || 'Telemetry transmission failed',
        }))
      }
    }

    // Initial transmission attempt once GPS fix arrives, then strictly every 12 seconds
    const initialTimer = setTimeout(sendLatestPoint, 2000)
    const intervalId = setInterval(sendLatestPoint, 12000)

    return () => {
      clearTimeout(initialTimer)
      clearInterval(intervalId)
    }
  }, [phase, activeTrip?.id])

  async function runChecks() {
    setChecking(true)
    setGps(await readGps())
    setWake(await requestWakeLock(lockRef, () => setWake('released')))
    setOnline(navigator.onLine)
    setChecked(true)
    setChecking(false)
  }

  async function startTrip() {
    setSubmitting(true)
    setTripError(null)
    try {
      if (activeTrip?.id) {
        const { error } = await supabase.rpc('start_trip', { p_trip_id: activeTrip.id })
        if (error) {
          // If conflict occurred with another active trip on this bus
          if (error.message?.includes('idx_trips_one_active_per_bus')) {
            console.warn('Resolving active trip conflict on bus...')
            const { data: conflicts } = await supabase
              .from('trips')
              .select('id, trip_date')
              .eq('bus_id', activeTrip.bus_id)
              .eq('status', 'in_progress')
            if (conflicts && conflicts.length > 0) {
              for (const c of conflicts) {
                await supabase.rpc('end_trip', { p_trip_id: c.id })
              }
              const { error: retryErr } = await supabase.rpc('start_trip', { p_trip_id: activeTrip.id })
              if (retryErr) throw retryErr
            } else {
              throw error
            }
          } else {
            throw error
          }
        }
      }
      const t = Date.now()
      setStartedAt(t)
      setNow(t)
      setFix(null)
      setPhase('running')
    } catch (err) {
      console.error('Failed to start trip:', err)
      const userMsg = err.message?.includes('idx_trips_one_active_per_bus')
        ? 'Another trip is already marked active on this bus. Please end the previous trip first.'
        : err.message || 'Failed to start trip.'
      setTripError(userMsg)
    } finally {
      setSubmitting(false)
    }
  }

  async function endTrip() {
    setSubmitting(true)
    setTripError(null)
    try {
      if (activeTrip?.id) {
        const { error } = await supabase.rpc('end_trip', { p_trip_id: activeTrip.id })
        if (error) throw error
      }
      lockRef.current?.release()
      lockRef.current = null
      setWake('unknown')
      setChecked(false)
      setConfirmEnd(false)
      setFix(null)
      setPhase('ready')
      setActiveTrip(null)
    } catch (err) {
      console.error('Failed to end trip:', err)
      setTripError(err.message || 'Failed to end trip.')
    } finally {
      setSubmitting(false)
    }
  }

  async function submitDelay(reason) {
    if (!activeTrip?.id) return
    setSubmitting(true)
    setDelayStatus(null)
    setTripError(null)
    try {
      const { error } = await supabase.rpc('report_delay', {
        p_trip_id: activeTrip.id,
        p_delay_minutes: 15,
        p_reason: reason,
      })
      if (error) throw error
      setDelayStatus(`Delay of 15m (${reason}) reported to school and parents.`)
      setDelayModalOpen(false)
      setTimeout(() => setDelayStatus(null), 5000)
    } catch (err) {
      console.error('Failed to report delay:', err)
      setTripError(err.message || 'Failed to report delay.')
    } finally {
      setSubmitting(false)
    }
  }

  const rawGpsGood = gps.accuracy !== null && gps.accuracy <= GOOD_ACCURACY_M
  const gpsOk = checked && gps.accuracy !== null && (rawGpsGood || allowComputerLocation)
  const allOk = gpsOk && wake === 'on' && online

  const accText = (n) => `${Math.round(n)} ${t('unit.m')}`
  let gpsText = t('driver.notChecked')
  if (checked) {
    if (gps.error === 'denied') gpsText = t('driver.gpsBlocked')
    else if (gps.error) gpsText = t('driver.gpsNone')
    else if (rawGpsGood) gpsText = t('driver.gpsGood', { acc: accText(gps.accuracy) })
    else if (allowComputerLocation) gpsText = `Testing OK (±${Math.round(gps.accuracy)}m)`
    else gpsText = t('driver.gpsWeak', { acc: accText(gps.accuracy) })
  }
  const wakeText = {
    unknown: t('driver.notChecked'),
    on: t('driver.wake.on'),
    unsupported: t('driver.wake.unsupported'),
    failed: t('driver.wake.failed'),
    released: t('driver.wake.released'),
  }[wake]

  const busRoute = activeTrip
    ? `${activeTrip.buses?.name || 'Bus'} · ${activeTrip.routes?.name || activeTrip.direction}`
    : `${t('home.bus', { n: 1 })} · ${t('driver.route.morning')}`

  if (phase === 'ready') {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 bg-night p-6 text-white">
        <div>
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-night-muted">{busRoute}</p>
            <div className="flex items-center gap-3">
              <LanguageSwitch dark />
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                className="rounded-lg border border-night-line px-3 py-1.5 text-xs font-semibold text-night-muted hover:bg-night-card hover:text-white transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
          <h1 className="mt-3 text-3xl font-bold">{t('driver.ready.title')}</h1>
        </div>

        {tripError && (
          <div className="rounded-xl bg-danger/20 border border-danger p-3 text-sm text-red-200">
            ⚠️ {tripError}
          </div>
        )}

        <section className="flex flex-col rounded-2xl bg-night-card px-4 py-2">
          <Row label={t('driver.row.gps')} ok={checked ? gpsOk : null} text={gpsText} />
          <Row label={t('driver.row.screen')} ok={checked ? wake === 'on' : null} text={wakeText} />
          <Row label={t('driver.row.internet')} ok={online} text={online ? t('driver.online') : t('driver.offline')} />
        </section>

        {checked && !rawGpsGood && gps.accuracy !== null && !allowComputerLocation && (
          <div className="rounded-xl border border-amber/40 bg-amber/10 p-3.5 text-xs">
            <div className="flex items-center gap-2 font-bold text-amber-300">
              <span>💻</span>
              <span>Testing on a computer?</span>
            </div>
            <p className="mt-1 leading-relaxed text-gray-300">
              Laptops & PCs don't have satellite GPS chips, so Wi-Fi location gives ±{Math.round(gps.accuracy)}m (production requires ≤50m). Real phones mounted on buses achieve ±5-15m.
            </p>
            <button
              type="button"
              onClick={() => setAllowComputerLocation(true)}
              className="mt-2.5 w-full rounded-lg bg-amber px-3 py-2 text-center text-xs font-bold text-ink hover:opacity-90"
            >
              ✓ Allow for Computer Testing (Enable Start)
            </button>
          </div>
        )}

        <button type="button" onClick={runChecks} disabled={checking} className="min-h-14 rounded-2xl border-2 border-night-muted text-lg font-bold disabled:opacity-60">
          {checking ? t('driver.checking') : checked ? t('driver.checkAgain') : t('driver.check')}
        </button>
        <p className="text-[15px] leading-relaxed text-night-muted">
          {t('driver.instructions')}
        </p>

        <button type="button" onClick={startTrip} disabled={!allOk || submitting} className="mt-auto min-h-18 rounded-2xl bg-amber text-2xl font-extrabold text-ink disabled:opacity-40">
          {submitting ? 'Starting...' : t('driver.start')}
        </button>
        <p className="text-center text-[13px] text-night-muted">
          {t('driver.startNote')} Real trips workflow enabled.
        </p>
      </main>
    )
  }

  const secondsSinceFix = fix ? Math.floor((now - fix.at) / 1000) : Math.floor((now - startedAt) / 1000)
  const isComputerTesting = allowComputerLocation || (fix && fix.accuracy > GOOD_ACCURACY_M)
  const gpsLost = isComputerTesting
    ? gps.error !== null
    : secondsSinceFix > GPS_STALE_SECONDS || gps.error !== null

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 bg-night p-6 text-white">
      <div className="flex items-center justify-between">
        <p className="text-sm text-night-muted">{busRoute}</p>
        <div className="flex items-center gap-3">
          <p className="text-[13px] font-bold text-go">● {t('driver.inProgress')}</p>
          <LanguageSwitch dark />
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="rounded-lg border border-night-line px-3 py-1.5 text-xs font-semibold text-night-muted hover:bg-night-card hover:text-white transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      {tripError && (
        <div className="rounded-xl bg-danger/20 border border-danger p-3 text-sm text-red-200">
          ⚠️ {tripError}
        </div>
      )}

      {delayStatus && (
        <div className="rounded-xl bg-go/20 border border-go p-3 text-sm text-green-200">
          ✓ {delayStatus}
        </div>
      )}

      {gpsLost ? (
        <section className="rounded-2xl bg-danger p-5 text-center" role="alert">
          <p className="text-2xl font-extrabold">{t('driver.lost.title')}</p>
          <p className="mt-1 text-[15px]">
            {gps.error === 'denied' ? t('driver.lost.denied') : t('driver.lost.body', { n: secondsSinceFix })}
          </p>
        </section>
      ) : (
        <section className="flex flex-col items-center gap-2 rounded-[20px] bg-night-card p-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-go text-4xl font-extrabold text-night">✓</div>
          <p className="text-[26px] font-extrabold">{t('driver.working')}</p>
          <p className="text-[15px] text-night-muted">
            {fix ? t('driver.lastFix', { n: secondsSinceFix, acc: accText(fix.accuracy) }) : t('driver.waitingFix')}
          </p>
        </section>
      )}

      <div className="flex gap-3">
        <div className="flex-1 rounded-[14px] bg-night-card p-3.5">
          <p className="text-[13px] text-night-muted">{t('driver.timeOnTrip')}</p>
          <p className="text-2xl font-extrabold">{clock(Math.max(0, Math.floor((now - startedAt) / 1000)))}</p>
        </div>
        <div className="flex-1 rounded-[14px] bg-night-card p-3.5">
          <p className="text-[13px] text-night-muted">{t('driver.screen')}</p>
          <p className="text-2xl font-extrabold">{wake === 'on' ? t('driver.screen.on') : t('driver.screen.off')}</p>
        </div>
      </div>
      <div className="flex justify-between items-center text-sm text-night-muted">
        <p>{online ? t('driver.internetOn') : t('driver.internetOff')}</p>
        <p>{online ? '📡 Network Ready' : '⚠️ Offline'}</p>
      </div>

      {/* Live Telemetry Status (Step 8b): Last sent time, accuracy, and errors */}
      <section className="flex flex-col gap-1 rounded-[14px] bg-night-card p-3.5 border border-night-line">
        <div className="flex justify-between items-center text-xs text-night-muted">
          <span>GPS Telemetry (12s cycle)</span>
          <span className={lastUpload.error ? 'text-amber-400 font-bold' : lastUpload.time ? 'text-go font-bold' : 'text-night-muted'}>
            {lastUpload.error ? '⚠️ Upload Alert' : lastUpload.time ? '● Live' : 'Waiting fix…'}
          </span>
        </div>
        <div className="flex justify-between items-baseline mt-1">
          <span className="text-sm text-white">
            {lastUpload.time
              ? `Last sent ${Math.max(0, Math.floor((now - lastUpload.time) / 1000))}s ago`
              : 'No telemetry sent yet'}
          </span>
          {lastUpload.accuracy !== null && (
            <span className="text-xs text-night-muted">
              Accuracy: {Math.round(lastUpload.accuracy)}m
            </span>
          )}
        </div>
        {lastUpload.error && (
          <p className="mt-1 text-xs text-red-300 bg-red-950/40 p-2 rounded-lg border border-red-800/50">
            ⚠️ {lastUpload.error}
          </p>
        )}
      </section>

      {delayModalOpen ? (
        <section className="mt-auto flex flex-col gap-3 rounded-2xl bg-night-card p-5 border border-night-line">
          <div className="flex items-center justify-between">
            <p className="text-lg font-bold text-white">Report Trip Delay (+15 min)</p>
            <button
              type="button"
              onClick={() => setDelayModalOpen(false)}
              className="text-night-muted hover:text-white text-base px-2 py-1"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-night-muted">Select reason for delay:</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { id: 'traffic', label: '🚦 Traffic' },
              { id: 'breakdown', label: '🔧 Breakdown' },
              { id: 'other', label: '⚠️ Other' },
            ].map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => setSelectedReason(choice.id)}
                className={`min-h-12 rounded-xl text-sm font-semibold transition-all border ${
                  selectedReason === choice.id
                    ? 'bg-amber text-night font-bold border-amber shadow-md'
                    : 'bg-night border-night-line text-night-muted hover:text-white'
                }`}
              >
                {choice.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => submitDelay(selectedReason)}
            disabled={submitting}
            className="min-h-14 mt-2 rounded-xl bg-amber text-night text-base font-bold shadow-lg disabled:opacity-50"
          >
            {submitting ? 'Reporting…' : `Submit Delay (${selectedReason})`}
          </button>
          <button
            type="button"
            onClick={() => setDelayModalOpen(false)}
            disabled={submitting}
            className="min-h-12 rounded-xl border border-night-line text-sm text-night-muted hover:text-white"
          >
            Cancel
          </button>
        </section>
      ) : confirmEnd ? (
        <section className="mt-auto flex flex-col gap-3 rounded-2xl bg-night-card p-4">
          <p className="text-lg font-bold">{t('driver.endAsk')}</p>
          <button type="button" onClick={endTrip} disabled={submitting} className="min-h-14 rounded-2xl bg-danger text-lg font-bold disabled:opacity-50">
            {submitting ? 'Ending...' : t('driver.endYes')}
          </button>
          <button type="button" onClick={() => setConfirmEnd(false)} disabled={submitting} className="min-h-14 rounded-2xl border-2 border-night-muted text-lg font-bold">
            {t('driver.endNo')}
          </button>
        </section>
      ) : (
        <div className="mt-auto flex flex-col gap-3">
          <button type="button" onClick={() => setDelayModalOpen(true)} disabled={submitting || !activeTrip?.id} className="min-h-15 rounded-2xl border-2 border-amber text-lg font-bold text-amber hover:bg-amber/10 transition-colors disabled:opacity-40">
            {submitting ? 'Reporting...' : t('driver.reportDelay')}
          </button>
          <button type="button" onClick={() => setConfirmEnd(true)} disabled={submitting} className="min-h-15 rounded-2xl bg-danger text-lg font-bold disabled:opacity-50">
            {t('driver.end')}
          </button>
          <p className="text-center text-[13px] text-night-muted">Trip state is tracked on server. GPS upload starts in Step 8.</p>
        </div>
      )}
    </main>
  )
}
