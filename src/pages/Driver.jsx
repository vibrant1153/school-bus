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
  const { user, profile } = useAuth()
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
  const [submitting, setSubmitting] = useState(false)
  const lockRef = useRef(null)

  // Fetch driver's active or scheduled trip for today
  useEffect(() => {
    let cancelled = false
    async function loadDriverTrip() {
      if (!user) return
      try {
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
          .order('scheduled_start', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (error) {
          console.error('Error fetching driver trip:', error)
          return
        }

        if (!cancelled && data) {
          setActiveTrip(data)
          if (data.status === 'in_progress' && data.started_at) {
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

  // While a trip is running: read GPS continuously, tick a clock, and ask for
  // the screen-awake lock again if the browser released it.
  useEffect(() => {
    if (phase !== 'running') return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
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
        if (error) throw error
      }
      const t = Date.now()
      setStartedAt(t)
      setNow(t)
      setFix(null)
      setPhase('running')
    } catch (err) {
      console.error('Failed to start trip:', err)
      setTripError(err.message || 'Failed to start trip.')
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

  async function reportDelay() {
    if (!activeTrip?.id) return
    setSubmitting(true)
    setDelayStatus(null)
    setTripError(null)
    try {
      const { error } = await supabase.rpc('report_delay', {
        p_trip_id: activeTrip.id,
        p_delay_minutes: 15,
        p_reason: 'Traffic congestion',
      })
      if (error) throw error
      setDelayStatus('Delay of 15m reported to school and parents.')
      setTimeout(() => setDelayStatus(null), 5000)
    } catch (err) {
      console.error('Failed to report delay:', err)
      setTripError(err.message || 'Failed to report delay.')
    } finally {
      setSubmitting(false)
    }
  }

  const gpsOk = checked && gps.accuracy !== null && gps.accuracy <= GOOD_ACCURACY_M
  const allOk = gpsOk && wake === 'on' && online

  const accText = (n) => `${Math.round(n)} ${t('unit.m')}`
  let gpsText = t('driver.notChecked')
  if (checked) {
    if (gps.error === 'denied') gpsText = t('driver.gpsBlocked')
    else if (gps.error) gpsText = t('driver.gpsNone')
    else if (gpsOk) gpsText = t('driver.gpsGood', { acc: accText(gps.accuracy) })
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
            <Link to="/" className="text-sm text-night-muted underline">{t('driver.back')}</Link>
            <LanguageSwitch dark />
          </div>
          <p className="mt-3 text-sm text-night-muted">{busRoute}</p>
          <h1 className="mt-1 text-3xl font-bold">{t('driver.ready.title')}</h1>
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
  const gpsLost = secondsSinceFix > GPS_STALE_SECONDS || gps.error !== null

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-5 bg-night p-6 text-white">
      <div className="flex items-center justify-between">
        <p className="text-sm text-night-muted">{busRoute}</p>
        <div className="flex items-center gap-3">
          <p className="text-[13px] font-bold text-go">● {t('driver.inProgress')}</p>
          <LanguageSwitch dark />
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
      <p className="text-sm text-night-muted">{online ? t('driver.internetOn') : t('driver.internetOff')}</p>

      {confirmEnd ? (
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
          <button type="button" onClick={reportDelay} disabled={submitting || !activeTrip?.id} className="min-h-15 rounded-2xl border-2 border-amber text-lg font-bold text-amber hover:bg-amber/10 transition-colors disabled:opacity-40">
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
