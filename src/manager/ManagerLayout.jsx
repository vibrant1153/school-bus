import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { useManagerData } from '../lib/useManagerData.js'

const NAV = [
  { to: '/manager', label: 'Dashboard', icon: '📊', end: true },
  { to: '/manager/students', label: 'Students & Parents', icon: '👨‍👩‍👧' },
  { to: '/manager/buses', label: 'Buses & Routes', icon: '🚌' },
  { to: '/manager/settings', label: 'School Settings', icon: '⚙️' },
  { to: '/manager/audit', label: 'Audit Log', icon: '📋' },
]

export default function ManagerLayout() {
  const { profile, signOut } = useAuth()
  const { school } = useManagerData()

  const schoolName = school?.name || 'School Portal'
  const managerName = profile?.full_name || 'Manager'

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      {/* Sidebar Navigation */}
      <aside className="bg-ink text-white lg:flex lg:w-64 lg:shrink-0 lg:flex-col lg:py-6">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-5 pt-4 pb-3 lg:pt-0 lg:pb-6 border-b border-white/10 lg:border-b-0">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber font-extrabold text-ink shadow-sm">
              SC
            </div>
            <div>
              <p className="text-[15px] font-bold leading-tight">SchoolBus Connect</p>
              <p className="text-[11px] text-night-muted font-medium">School Manager Portal</p>
            </div>
          </div>
          {/* Prominent Log Out for Mobile / Tablet */}
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500 hover:text-white active:scale-95 transition-all lg:hidden shadow-xs"
          >
            <span aria-hidden="true">🚪</span>
            <span>Log Out</span>
          </button>
        </div>

        {/* Navigation Links */}
        <nav aria-label="Manager Navigation" className="flex overflow-x-auto px-3 py-2 lg:flex-col lg:gap-1 lg:px-4 lg:py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                'flex items-center gap-2.5 rounded-xl px-4 py-2.5 text-[14px] whitespace-nowrap transition-all ' +
                (isActive
                  ? 'bg-amber text-ink font-bold shadow-xs'
                  : 'text-night-muted hover:bg-white/10 hover:text-white font-medium')
              }
            >
              <span className="text-base" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Manager & School Footer (Desktop) */}
        <div className="mt-auto hidden border-t border-white/10 px-5 pt-5 pb-2 text-xs text-night-muted lg:block">
          <div className="rounded-xl bg-white/5 p-3.5 border border-white/10">
            <p className="font-bold text-white text-sm truncate">{schoolName}</p>
            <p className="mt-1 text-night-muted text-xs truncate">Manager: {managerName}</p>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 py-2 text-xs font-bold text-red-400 hover:bg-red-500 hover:text-white active:scale-95 transition-all shadow-xs"
            >
              <span aria-hidden="true">🚪</span>
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Desktop Top Header Bar with prominent Sign Out */}
        <header className="hidden lg:flex h-16 items-center justify-between border-b border-gray-200 bg-white px-8">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-live animate-pulse" aria-hidden="true" />
            <h2 className="text-sm font-bold text-ink">{schoolName}</h2>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-muted">
              Active Term
            </span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="font-semibold text-ink">{managerName}</span>
              <span className="rounded-full bg-amber/20 px-2 py-0.5 font-bold text-amber-900">
                Manager
              </span>
            </div>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs font-bold text-red-600 shadow-xs hover:bg-red-100 hover:text-red-700 active:scale-95 transition-all"
            >
              <span aria-hidden="true">🚪</span>
              <span>Log Out</span>
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}