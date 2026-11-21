import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import ParentNav from '../components/ParentNav.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { useParentData } from '../lib/useParentData.js'
import { useAuth } from '../lib/useAuth.js'
import { formatRadius, ALERT_PRESETS } from '../prototype.js'

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
  tripStarted: 'bg-[#0D9488]',
  nearStop: 'bg-[#0D9488]',
  delayed: 'bg-[#DC2626]',
  tripCancelled: 'bg-[#DC2626]',
  tripCompleted: 'bg-[#1D3557]',
}

export default function Alerts() {
  const { t } = useI18n()
  const { signOut } = useAuth()
  const { alerts, loading, selectedChild, updateAlertRadius } = useParentData()
  const alertMeters = selectedChild?.alertRadiusM || 500

  const groups = [
    { day: 'today', title: t('home.today') },
    { day: 'yesterday', title: t('alerts.yesterday') },
    { day: 'earlier', title: 'Earlier' },
  ]

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-[#F8FAFC]">
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-5 pb-8">
        <header className="card-3d flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <h1 className="text-base sm:text-lg font-black tracking-tight text-[#172033]">{t('alerts.title')}</h1>
          <div className="flex items-center gap-2 shrink-0">
            <LanguageSwitch />
            <button
              type="button"
              onClick={signOut}
              title="Sign Out"
              aria-label="Sign out"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E2E8F0] bg-white text-[#64748B] hover:text-[#DC2626] hover:bg-red-50 hover:border-red-200 active:scale-95 transition-all shadow-2xs"
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </header>

        {/* Near-Stop Alert Preference (200m / 500m / 1km) - 3D Segmented Control */}
        <section className="card-3d flex flex-col gap-3 rounded-3xl p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-black uppercase tracking-wider text-[#172033] flex items-center gap-1.5">
              <span>🔔</span>
              <span>Arrival Alert Distance</span>
            </h2>
            <span className="text-[11px] font-bold text-[#64748B]">
              When bus approaches
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {ALERT_PRESETS.map((preset) => {
              const selected = preset.meters === alertMeters
              return (
                <button
                  key={preset.meters}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateAlertRadius(preset.meters)}
                  className={
                    'min-h-11 rounded-2xl text-xs font-black transition-all ' +
                    (selected
                      ? 'btn-3d-accent text-white scale-[1.02]'
                      : 'btn-3d-subtle text-[#64748B]')
                  }
                >
                  {formatRadius(preset.meters, t)}
                </button>
              )
            })}
          </div>
          <p className="text-[11px] font-medium text-[#64748B] leading-relaxed">{t('home.alert.note')}</p>
        </section>

        {loading ? (
          <div className="card-3d flex h-32 items-center justify-center rounded-3xl">
            <div className="h-8 w-8 animate-spin rounded-full border-3 border-[#0D9488] border-t-transparent" />
          </div>
        ) : alerts.length === 0 ? (
          <div className="card-3d rounded-3xl p-6 text-center text-sm font-semibold text-[#64748B]">
            {t('alerts.empty')}
          </div>
        ) : (
          groups.map((group) => {
            const items = alerts.filter((a) => getAlertGroup(a) === group.day)
            if (items.length === 0) return null

            return (
              <section key={group.day} className="flex flex-col gap-2">
                <h2 className="text-xs font-black uppercase tracking-wider text-[#64748B] px-1">{group.title}</h2>
                <ul className="flex flex-col gap-2">
                  {items.map((alert) => {
                    const eventType = alert.event_type || alert.type || 'tripStarted'
                    return (
                      <li
                        key={alert.id}
                        className="card-3d flex items-start gap-3 rounded-2xl p-4"
                      >
                        <span
                          className={'mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full shadow-2xs ' + (DOT[eventType] || 'bg-[#64748B]')}
                          aria-hidden="true"
                        />
                        <p className="flex-1 text-xs sm:text-sm font-semibold leading-snug text-[#172033]">
                          {formatAlertText(alert, t)}
                        </p>
                        <time className="shrink-0 text-xs font-bold text-[#64748B]">
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

        <div className="card-3d rounded-2xl border-[#0D9488]/30 bg-[#E6F4F1] p-3.5 text-xs font-semibold leading-relaxed text-[#172033]">
          {t('alerts.disclaimer')}
        </div>
      </main>
      <ParentNav active="alerts" />
    </div>
  )
}
