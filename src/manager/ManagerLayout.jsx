import { NavLink, Link, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/manager', label: 'Dashboard', end: true },
  { to: '/manager/students', label: 'Students & parents' },
  { to: '/manager/buses', label: 'Buses & routes' },
]
const LATER = ['Trips', 'Audit log', 'Settings']

export default function ManagerLayout() {
  return (
    <div className="min-h-screen lg:flex">
      <aside className="bg-ink text-white lg:flex lg:w-56 lg:shrink-0 lg:flex-col lg:py-5">
        <p className="px-5 pt-4 pb-2 text-[17px] font-bold lg:pt-0 lg:pb-5">SchoolBus Connect</p>
        <nav aria-label="Manager" className="flex overflow-x-auto lg:flex-col">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                'border-b-4 px-5 py-3 text-[15px] whitespace-nowrap lg:border-b-0 lg:border-l-4 ' +
                (isActive ? 'border-amber bg-white/10 font-bold' : 'border-transparent text-line')
              }
            >
              {item.label}
            </NavLink>
          ))}
          {LATER.map((label) => (
            <span key={label} title="Built in a later step" className="border-b-4 border-transparent px-5 py-3 text-[15px] whitespace-nowrap text-night-muted opacity-50 lg:border-b-0 lg:border-l-4">
              {label}
            </span>
          ))}
        </nav>
        <div className="px-5 py-4 text-[13px] text-night-muted lg:mt-auto">
          Sample School<br />
          Manager: Test Manager<br />
          <Link to="/" className="underline">← Prototype start</Link>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-5 lg:p-7">
        <Outlet />
      </main>
    </div>
  )
}