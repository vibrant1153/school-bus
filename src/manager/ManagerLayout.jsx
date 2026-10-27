import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { useManagerData } from '../lib/useManagerData.js'

const NAV = [
  { to: '/manager', label: 'Dashboard', end: true },
  { to: '/manager/students', label: 'Students & parents' },
  { to: '/manager/buses', label: 'Buses & routes' },
  { to: '/manager/settings', label: 'School settings' },
  { to: '/manager/audit', label: 'Audit log' },
]

export default function ManagerLayout() {
  const { profile, signOut } = useAuth()
  const { school } = useManagerData()

  const schoolName = school?.name || 'School Portal'
  const managerName = profile?.full_name || 'Manager'

  return (
    <div className="min-h-screen bg-gray-50 lg:flex">
      {/* Sidebar Navigation */}
      <aside className="bg-ink text-white lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:py-6">
        <div className="flex items-center justify-between px-5 pt-4 pb-2 lg:pt-0 lg:pb-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber font-bold text-ink">
              SC
            </div>
            <div>
              <p className="text-[15px] font-bold leading-tight">SchoolBus Connect</p>
              <p className="text-xs text-night-muted">School Manager</p>
            </div>
          </div>
          <button
            type="button"
            onClick={signOut}
            className="rounded-lg border border-white/20 px-2.5 py-1 text-xs font-semibold text-amber hover:bg-white/10 lg:hidden"
          >
            Sign out
          </button>
        </div>

        <nav aria-label="Manager" className="flex overflow-x-auto lg:flex-col lg:gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                'border-b-4 px-5 py-3 text-[14px] whitespace-nowrap transition-colors lg:border-b-0 lg:border-l-4 ' +
                (isActive
                  ? 'border-amber bg-white/10 font-bold text-white'
                  : 'border-transparent text-night-muted hover:bg-white/5 hover:text-white')
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Manager & School Footer */}
        <div className="border-t border-white/10 px-5 py-4 text-xs text-night-muted lg:mt-auto">
          <p className="font-bold text-white">{schoolName}</p>
          <p className="mt-0.5">Manager: {managerName}</p>
          <button
            type="button"
            onClick={signOut}
            className="mt-3 block text-xs font-semibold text-amber underline hover:opacity-80"
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="min-w-0 flex-1 p-5 lg:p-8">
        <Outlet />
      </main>
    </div>
  )
}