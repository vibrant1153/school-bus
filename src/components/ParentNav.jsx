import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/useI18n.js'
import { useAuth } from '../lib/useAuth.js'

const TABS = [
  { id: 'home', to: '/home', key: 'nav.home' },
  { id: 'map', to: '/map', key: 'nav.map' },
  { id: 'alerts', to: '/alerts', key: 'nav.alerts' },
]

export default function ParentNav({ active }) {
  const { t } = useI18n()
  const { signOut } = useAuth()
  return (
    <nav aria-label="Main" className="flex border-t border-line bg-white">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          to={tab.to}
          aria-current={tab.id === active ? 'page' : undefined}
          className={'flex min-h-15 flex-1 items-center justify-center text-sm ' + (tab.id === active ? 'font-bold text-ink' : 'text-muted')}
        >
          {t(tab.key)}
        </Link>
      ))}
      <button
        type="button"
        onClick={signOut}
        aria-label="Sign out"
        className="flex min-h-15 flex-1 items-center justify-center text-sm text-danger hover:bg-red-50 transition-colors"
      >
        Sign Out
      </button>
    </nav>
  )
}
