import { Link } from 'react-router-dom'
import { useI18n } from '../i18n/useI18n.js'

const TABS = [
  { id: 'home', to: '/home', key: 'nav.home' },
  { id: 'map', to: '/map', key: 'nav.map' },
  { id: 'alerts', to: '/alerts', key: 'nav.alerts' },
]

export default function ParentNav({ active }) {
  const { t } = useI18n()
  return (
    <nav aria-label="Main" className="flex border-t border-line bg-white">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          to={tab.to}
          aria-current={tab.id === active ? 'page' : undefined}
          className={'flex min-h-15 flex-1 items-center justify-center text-sm ' + (tab.id === active ? 'font-bold' : 'text-muted')}
        >
          {t(tab.key)}
        </Link>
      ))}
    </nav>
  )
}
