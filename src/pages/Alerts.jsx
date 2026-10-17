import { useState } from 'react'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import ParentNav from '../components/ParentNav.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { SAMPLE_ALERTS, formatRadius } from '../prototype.js'

// Turns a stored alert (type + values) into text in the parent's language.
function alertText(alert, t) {
  switch (alert.type) {
    case 'tripStarted':
      return t(`notif.tripStarted.${alert.direction}`, { n: alert.bus })
    case 'nearStop':
      return t('notif.nearStop', { n: alert.bus, radius: formatRadius(alert.radius, t) })
    case 'delayed':
      return t('notif.delayed', { n: alert.bus, reason: t(`notif.reason.${alert.reason}`) })
    case 'tripCompleted':
      return t(`notif.tripCompleted.${alert.direction}`, { n: alert.bus })
    case 'tripCancelled':
      return t(`notif.tripCancelled.${alert.direction}`, { n: alert.bus })
    default:
      return ''
  }
}

const DOT = {
  tripStarted: 'bg-live',
  nearStop: 'bg-amber',
  delayed: 'bg-danger',
  tripCancelled: 'bg-danger',
  tripCompleted: 'bg-field',
}

export default function Alerts() {
  const { t } = useI18n()
  const [showEmpty, setShowEmpty] = useState(false)
  const alerts = showEmpty ? [] : SAMPLE_ALERTS
  const groups = [
    { day: 'today', title: t('home.today') },
    { day: 'yesterday', title: t('alerts.yesterday') },
  ]

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
      <main className="flex flex-1 flex-col gap-4 p-5 pb-4">
        <header className="flex items-center justify-between">
          <h1 className="text-[22px] font-bold">{t('alerts.title')}</h1>
          <LanguageSwitch />
        </header>

        {alerts.length === 0 && (
          <p className="rounded-2xl bg-white p-5 text-[15px] text-muted">{t('alerts.empty')}</p>
        )}

        {groups.map((group) => {
          const items = alerts.filter((a) => a.day === group.day)
          if (items.length === 0) return null
          return (
            <section key={group.day} className="flex flex-col gap-2">
              <h2 className="text-sm font-bold text-muted">{group.title}</h2>
              <ul className="flex flex-col gap-2">
                {items.map((alert) => (
                  <li key={alert.id} className="flex items-start gap-3 rounded-2xl bg-white p-4">
                    <span className={'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ' + DOT[alert.type]} aria-hidden="true" />
                    <p className="flex-1 text-[15px] leading-snug">{alertText(alert, t)}</p>
                    <time className="shrink-0 text-[13px] text-muted">{alert.time}</time>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

        <p className="rounded-xl bg-[#FFF6E0] p-3 text-sm leading-relaxed">{t('alerts.disclaimer')}</p>
        <p className="text-[13px] text-muted">{t('alerts.note')}</p>

        <section className="flex flex-col gap-2 rounded-2xl border border-dashed border-field p-4">
          <p className="text-[13px] font-semibold text-muted">Prototype only: preview the list</p>
          <div className="flex gap-2">
            {[['With alerts', false], ['Empty', true]].map(([label, value]) => (
              <button
                key={label}
                type="button"
                aria-pressed={showEmpty === value}
                onClick={() => setShowEmpty(value)}
                className={'min-h-11 flex-1 rounded-[10px] text-sm ' + (showEmpty === value ? 'bg-ink font-bold text-white' : 'border border-field bg-white')}
              >
                {label}
              </button>
            ))}
          </div>
        </section>
        <p className="text-[13px] font-semibold text-muted">Prototype: sample alerts only. Real alerts arrive with the database and notification step.</p>
      </main>
      <ParentNav active="alerts" />
    </div>
  )
}
