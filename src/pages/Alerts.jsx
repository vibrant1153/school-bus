import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import ParentNav from '../components/ParentNav.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { useParentData } from '../lib/useParentData.js'
import { useAuth } from '../lib/useAuth.js'
import { formatRadius } from '../prototype.js'

function formatAlertText(alert, t) {
  const type = alert.event_type || alert.type
  const payload = alert.payload_json || {}
  const bus = payload.bus_number || alert.bus || 1
  const direction = payload.direction || alert.direction || 'morning'
  const radius = alert.radius_meters || alert.radius || 500
  const reason = payload.reason || alert.reason || 'traffic'

  switch (type) {
    case 'tripStarted':
      return t(`notif.tripStarted.${direction}`, { n: bus })
    case 'nearStop':
      return t('notif.nearStop', { n: bus, radius: formatRadius(radius, t) })
    case 'delayed':
      return t('notif.delayed', { n: bus, reason: t(`notif.reason.${reason}`) })
    case 'tripCompleted':
      return t(`notif.tripCompleted.${direction}`, { n: bus })
    case 'tripCancelled':
      return t(`notif.tripCancelled.${direction}`, { n: bus })
    default:
      return 'Trip update'
  }
}

function getAlertGroup(alert) {
  if (alert.day) return alert.day
  if (!alert.created_at) return 'today'
  const date = new Date(alert.created_at)
  const now = new Date()
  if (date.toDateString() === now.toDateString()) return 'today'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'yesterday'
  return 'earlier'
}

function getAlertTime(alert) {
  if (alert.time) return alert.time
  if (!alert.created_at) return ''
  return new Date(alert.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
  const { signOut } = useAuth()
  const { alerts, loading } = useParentData()

  const groups = [
    { day: 'today', title: t('home.today') },
    { day: 'yesterday', title: t('alerts.yesterday') },
    { day: 'earlier', title: 'Earlier' },
  ]

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-gray-50">
      <main className="flex flex-1 flex-col gap-4 p-5 pb-6">
        <header className="flex items-center justify-between">
          <h1 className="text-[22px] font-bold text-ink">{t('alerts.title')}</h1>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            <button
              type="button"
              onClick={signOut}
              className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs font-semibold text-danger hover:bg-red-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </header>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber border-t-transparent" />
          </div>
        ) : alerts.length === 0 ? (
          <p className="rounded-2xl bg-white p-5 text-[15px] text-muted shadow-xs">
            {t('alerts.empty')}
          </p>
        ) : (
          groups.map((group) => {
            const items = alerts.filter((a) => getAlertGroup(a) === group.day)
            if (items.length === 0) return null

            return (
              <section key={group.day} className="flex flex-col gap-2">
                <h2 className="text-sm font-bold text-muted">{group.title}</h2>
                <ul className="flex flex-col gap-2">
                  {items.map((alert) => {
                    const eventType = alert.event_type || alert.type || 'tripStarted'
                    return (
                      <li
                        key={alert.id}
                        className="flex items-start gap-3 rounded-2xl bg-white p-4 shadow-xs"
                      >
                        <span
                          className={'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ' + (DOT[eventType] || 'bg-field')}
                          aria-hidden="true"
                        />
                        <p className="flex-1 text-[15px] leading-snug text-ink">
                          {formatAlertText(alert, t)}
                        </p>
                        <time className="shrink-0 text-[13px] text-muted">
                          {getAlertTime(alert)}
                        </time>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })
        )}

        <p className="rounded-xl bg-[#FFF6E0] p-3 text-sm leading-relaxed text-amber-900">
          {t('alerts.disclaimer')}
        </p>
        <p className="text-[13px] text-muted">{t('alerts.note')}</p>
      </main>
      <ParentNav active="alerts" />
    </div>
  )
}
