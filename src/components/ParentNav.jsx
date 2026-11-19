import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/useI18n.js'

const TABS = [
  { id: 'home', to: '/home', key: 'nav.home', icon: '🏠' },
  { id: 'map', to: '/map', key: 'nav.map', icon: '📍' },
  { id: 'alerts', to: '/alerts', key: 'nav.alerts', icon: '🔔' },
]

export default function ParentNav({ active }) {
  const { t } = useI18n()

  return (
    <nav
      aria-label="Main navigation"
      className="sticky bottom-0 z-40 w-full px-3 py-2 pb-[max(env(safe-area-inset-bottom),0.75rem)] pointer-events-none"
    >
      <div className="pointer-events-auto mx-auto flex max-w-md items-center justify-around rounded-3xl nav-glass-dock p-1.5 shadow-[0_12px_36px_rgba(15,23,42,0.1)] transition-all">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <Link
              key={tab.id}
              to={tab.to}
              aria-current={isActive ? 'page' : undefined}
              className={
                'relative flex flex-1 flex-col items-center justify-center rounded-2xl py-2 text-center transition-all duration-200 ' +
                (isActive
                  ? 'bg-gradient-to-b from-amber-50 to-amber-100/70 text-slate-900 font-extrabold shadow-xs border border-amber-300/60 scale-[1.02]'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-white/60 active:scale-95')
              }
            >
              <span className="text-xl leading-none transition-transform duration-200" aria-hidden="true">
                {tab.icon}
              </span>
              <span className={'mt-1 text-[11px] sm:text-xs tracking-tight ' + (isActive ? 'font-black text-amber-950' : 'font-semibold')}>
                {t(tab.key)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

