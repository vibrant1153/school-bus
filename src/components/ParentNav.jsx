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
      className="sticky bottom-0 z-40 w-full border-t border-gray-200 bg-white/95 backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.06)]"
    >
      <div className="mx-auto flex max-w-md items-center justify-around px-2 py-1.5 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {TABS.map((tab) => {
          const isActive = tab.id === active
          return (
            <Link
              key={tab.id}
              to={tab.to}
              aria-current={isActive ? 'page' : undefined}
              className={
                'flex flex-1 flex-col items-center justify-center rounded-xl py-1 text-center transition-all ' +
                (isActive
                  ? 'font-bold text-ink bg-gray-100/70'
                  : 'text-muted hover:text-ink hover:bg-gray-50 active:bg-gray-100')
              }
            >
              <span className="text-lg leading-none" aria-hidden="true">
                {tab.icon}
              </span>
              <span className={'mt-1 text-[11px] sm:text-xs tracking-tight ' + (isActive ? 'font-bold' : 'font-medium')}>
                {t(tab.key)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

