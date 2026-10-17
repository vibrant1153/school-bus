import { useState } from 'react'
import { Link } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import ParentNav from '../components/ParentNav.jsx'
import { useI18n } from '../i18n/useI18n.js'
import {
  ALERT_PRESETS,
  BUS_DISTANCE_M,
  DEMO_STATES,
  busStatus,
  describeAge,
  formatDistance,
  formatRadius,
  getAlertMeters,
  getDemoState,
  setAlertMeters,
  setDemoState,
} from '../prototype.js'

// Sample data for the prototype. Real data arrives with the database step.
const SAMPLE = {
  parentName: 'Mrs. Test Parent',
  child: { name: 'Abel (sample child)', grade: 3, bus: 3, stop: 4 },
  progressPercent: 60,
  plannedStart: '6:45 AM',
  today: [
    { key: 'home.event.started', time: '7:12 AM' },
    { key: 'home.event.near', time: '7:26 AM' },
  ],
}

function StatusCard({ status, child }) {
  const { t } = useI18n()
  const busLabel = t('home.bus', { n: child.bus })
  const stopLabel = t('home.stop', { n: child.stop })

  if (status.mode === 'none') {
    return (
      <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-5" aria-live="polite">
        <p className="flex items-center gap-2 text-[13px] font-bold text-muted">
          <span className="h-2.5 w-2.5 rounded-full bg-field" aria-hidden="true" />
          {t('home.none.badge')}
        </p>
        <p className="text-[26px] leading-tight font-extrabold">{t('home.none.title')}</p>
        <p className="text-[15px] text-muted">{t('home.none.body', { time: SAMPLE.plannedStart })}</p>
        <Link to="/map" className="mt-1.5 flex min-h-13 items-center justify-center rounded-xl border border-field px-3 text-center text-base font-bold">
          {t('home.viewRoute')}
        </Link>
      </section>
    )
  }

  const stale = status.mode === 'stale'
  const age = describeAge(status.secondsAgo, t)
  const distance = formatDistance(BUS_DISTANCE_M, t)
  return (
    <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-5" aria-live="polite">
      <p className={'flex items-center gap-2 text-[13px] font-bold ' + (stale ? 'text-muted' : 'text-live')}>
        <span className={'h-2.5 w-2.5 rounded-full ' + (stale ? 'bg-field' : 'bg-live')} aria-hidden="true" />
        {stale ? t('home.lastSeen', { age }).toUpperCase() : t('home.live')}
      </p>
      <p className={'leading-tight font-extrabold ' + (stale ? 'text-[26px] text-muted' : 'text-3xl')}>
        {stale ? t('home.lastKnown', { distance }) : t('home.about', { distance })}
      </p>
      <p className="text-[15px]">{t('home.heading', { bus: busLabel, stop: stopLabel })}</p>
      {stale && (
        <p className="rounded-xl bg-[#FFF6E0] p-3 text-sm leading-relaxed" role="alert">
          {t('home.staleWarning')}
        </p>
      )}
      <div className="h-2 rounded bg-line/50" role="presentation">
        <div className={'h-2 rounded ' + (stale ? 'bg-field' : 'bg-amber')} style={{ width: `${SAMPLE.progressPercent}%` }} />
      </div>
      <p className="text-[13px] text-muted">{stale ? t('home.updatedLast', { age }) : t('home.updatedApprox', { age })}</p>
      <Link to="/map" className={'mt-1.5 flex min-h-13 items-center justify-center rounded-xl px-3 text-center text-base font-bold ' + (stale ? 'border border-field' : 'bg-amber text-ink')}>
        {stale ? t('home.viewLast') : t('home.viewBus')}
      </Link>
    </section>
  )
}

export default function ParentHome() {
  const { t } = useI18n()
  const [alertMeters, setAlertMetersState] = useState(getAlertMeters)
  const [demo, setDemo] = useState(getDemoState)
  const { child } = SAMPLE
  const status = busStatus(demo)

  function chooseAlert(meters) {
    setAlertMetersState(meters)
    setAlertMeters(meters)
  }
  function chooseDemo(id) {
    setDemo(id)
    setDemoState(id)
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
      <main className="flex flex-1 flex-col gap-4 p-5 pb-4">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted">{t('home.greeting')}</p>
            <h1 className="text-[22px] font-bold">{SAMPLE.parentName}</h1>
          </div>
          <LanguageSwitch />
        </header>

        <section className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4">
          <div>
            <p className="text-[17px] font-bold">{child.name}</p>
            <p className="text-sm text-muted">
              {t('home.grade', { n: child.grade })} · {t('home.bus', { n: child.bus })} · {t('home.trip.morning')}
            </p>
          </div>
          <p className="text-right text-[13px] text-muted">
            {t('home.yourStop')}<br />
            <b className="text-ink">{t('home.stop', { n: child.stop })}</b>
          </p>
        </section>

        <StatusCard status={status} child={child} />

        <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-4">
          <h2 className="text-[15px] font-bold">{t('home.alert.title')}</h2>
          <div className="flex gap-2">
            {ALERT_PRESETS.map((preset) => {
              const selected = preset.meters === alertMeters
              return (
                <button
                  key={preset.meters}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => chooseAlert(preset.meters)}
                  className={
                    'min-h-12 flex-1 rounded-[10px] text-[15px] ' +
                    (selected ? 'bg-ink font-bold text-white' : 'border border-field bg-white')
                  }
                >
                  {formatRadius(preset.meters, t)}
                </button>
              )
            })}
          </div>
          <p className="text-[13px] text-muted">{t('home.alert.note')}</p>
        </section>

        <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-4">
          <h2 className="text-[15px] font-bold">{t('home.today')}</h2>
          {SAMPLE.today.map((item) => (
            <p key={item.time} className="flex justify-between gap-3 text-sm">
              <span>{t(item.key)}</span>
              <span className="shrink-0 text-muted">{item.time}</span>
            </p>
          ))}
        </section>

        <button type="button" disabled title="The school phone number is set up in the admin step" className="min-h-12 rounded-xl border border-field px-3 text-[15px] opacity-60">
          {t('home.call')}
        </button>

        <section className="flex flex-col gap-2 rounded-2xl border border-dashed border-field p-4">
          <p className="text-[13px] font-semibold text-muted">Prototype only: preview what a parent sees</p>
          <div className="flex gap-2">
            {DEMO_STATES.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={demo === d.id}
                onClick={() => chooseDemo(d.id)}
                className={'min-h-11 flex-1 rounded-[10px] text-sm ' + (demo === d.id ? 'bg-ink font-bold text-white' : 'border border-field bg-white')}
              >
                {d.label}
              </button>
            ))}
          </div>
        </section>
        <p className="text-[13px] font-semibold text-muted">Prototype: sample data only. Alerts and calling come in later steps.</p>
      </main>

      <ParentNav active="home" />
    </div>
  )
}
