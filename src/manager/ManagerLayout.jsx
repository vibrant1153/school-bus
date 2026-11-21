import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../lib/useAuth.js'
import { useManagerData } from '../lib/useManagerData.js'

const NAV = [
  {
    to: '/manager',
    label: 'Dashboard',
    end: true,
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
  },
  {
    to: '/manager/students',
    label: 'Students & Rosters',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    to: '/manager/buses',
    label: 'Fleet & Routes',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M3 10h18" />
        <circle cx="7" cy="20" r="2" />
        <circle cx="17" cy="20" r="2" />
      </svg>
    ),
  },
  {
    to: '/manager/settings',
    label: 'School Settings',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    to: '/manager/audit',
    label: 'Audit & Compliance',
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
]

export default function ManagerLayout() {
  const { user, profile, signOut, updatePassword } = useAuth()
  const { school } = useManagerData()

  const [showPassModal, setShowPassModal] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [changing, setChanging] = useState(false)
  const [changeErr, setChangeErr] = useState('')
  const [changeSuccess, setChangeSuccess] = useState(false)

  const mustChangePassword = Boolean(user?.app_metadata?.must_change_password || user?.user_metadata?.must_change_password)
  const schoolName = school?.name || 'School Operations'
  const managerName = profile?.full_name || 'School Manager'

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setChangeErr('')
    setChangeSuccess(false)

    if (newPass.length < 8) {
      setChangeErr('New password must be at least 8 characters long.')
      return
    }
    if (newPass !== confirmPass) {
      setChangeErr('Passwords do not match.')
      return
    }

    setChanging(true)
    const res = await updatePassword(newPass)
    setChanging(false)

    if (res.success) {
      setChangeSuccess(true)
      setNewPass('')
      setConfirmPass('')
      setTimeout(() => {
        setShowPassModal(false)
        setChangeSuccess(false)
      }, 1500)
    } else {
      setChangeErr(res.error || 'Failed to update password. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] lg:flex">
      {/* Sidebar Navigation */}
      <aside className="bg-[#101828] text-white lg:flex lg:w-64 lg:shrink-0 lg:flex-col border-r border-[#1E293B]">
        {/* Brand Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1E293B]">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0D9488] font-black text-white text-xs tracking-wider shadow-xs">
              SC
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-white tracking-tight leading-snug">SchoolBus Connect</p>
              <p className="text-[11px] text-[#64748B] font-medium truncate">Transit Management</p>
            </div>
          </div>
          {/* Mobile Sign Out */}
          <div className="flex items-center gap-1.5 lg:hidden">
            <button
              type="button"
              onClick={signOut}
              title="Sign Out"
              aria-label="Sign out"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#334155] bg-[#1E293B] text-[#94A3B8] hover:text-white transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Navigation Links */}
        <nav aria-label="Manager Navigation" className="flex overflow-x-auto px-3 py-3 lg:flex-col lg:gap-1 lg:px-3 lg:py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                'flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-semibold whitespace-nowrap transition-colors ' +
                (isActive
                  ? 'bg-[#0D9488] text-white shadow-xs'
                  : 'text-[#94A3B8] hover:bg-[#1E293B] hover:text-white')
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {/* Manager & School Footer (Desktop) */}
        <div className="mt-auto hidden border-t border-[#1E293B] p-4 text-xs lg:block">
          <div className="rounded-lg bg-[#1E293B]/70 p-3 border border-[#334155]/60">
            <div className="flex items-center justify-between">
              <p className="font-bold text-white text-xs truncate max-w-[140px]">{schoolName}</p>
              <span className="h-2 w-2 rounded-full bg-[#0D9488]" title="Live Active Session" />
            </div>
            <p className="mt-0.5 text-[#94A3B8] text-[11px] truncate">{managerName}</p>
            <div className="mt-3 flex items-center gap-1.5 pt-2 border-t border-[#334155]/60">
              <button
                type="button"
                onClick={() => { setShowPassModal(true); setChangeErr(''); setChangeSuccess(false); setNewPass(''); setConfirmPass('') }}
                className="flex flex-1 items-center justify-center gap-1 rounded-md border border-[#334155] bg-[#1E293B] py-1 text-[11px] font-medium text-[#CBD5E1] hover:bg-[#334155] hover:text-white transition-colors"
              >
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-1.5 1.5L14 9l-3 3-2-2-3 3 2 2-3 3 2 2 3-3-2-2 3-3 3.5-3.5" />
                </svg>
                <span>Password</span>
              </button>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                className="flex items-center justify-center rounded-md border border-[#334155] bg-[#1E293B] px-2 py-1 text-[11px] font-medium text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                title="Sign out"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Persistent Warning Banner if Manager is on temporary password */}
        {mustChangePassword && (
          <div className="bg-amber-50 border-b border-amber-200 px-6 py-2.5 text-amber-900 font-semibold text-xs flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-amber-600 font-bold">⚠️ Security Notice:</span>
              <span>You are signed in with a temporary password. Please set a permanent password for administrative security.</span>
            </div>
            <button
              type="button"
              onClick={() => { setShowPassModal(true); setChangeErr(''); setChangeSuccess(false); setNewPass(''); setConfirmPass('') }}
              className="rounded-md bg-amber-600 px-3 py-1 text-xs font-bold text-white hover:bg-amber-700 transition-colors"
            >
              Set Password Now →
            </button>
          </div>
        )}

        {/* Desktop Top Header Bar */}
        <header className="hidden lg:flex h-14 items-center justify-between border-b border-[#E2E8F0] bg-white px-8">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[#172033]">
              <span className="h-2 w-2 rounded-full bg-[#0D9488]" aria-hidden="true" />
              {schoolName}
            </span>
            <span className="text-xs text-[#CBD5E1]">/</span>
            <span className="text-xs font-medium text-[#64748B]">
              Operations Console
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-[#64748B]">
              <span className="font-semibold text-[#172033]">{managerName}</span>
              <span className="rounded-full bg-[#E6F4F1] px-2 py-0.5 text-[10px] font-bold text-[#0D9488] uppercase tracking-wider">
                Manager
              </span>
            </div>
            <div className="h-4 w-[1px] bg-[#E2E8F0]" />
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:text-[#DC2626] hover:bg-red-50 hover:border-red-200 transition-colors"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Sign Out</span>
            </button>
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>

      {/* Change Password Modal */}
      {showPassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E2E8F0]">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#172033]">Change Account Password</h3>
                <p className="text-xs text-[#64748B] font-mono mt-0.5">{user?.email || managerName}</p>
              </div>
              <button
                type="button"
                onClick={() => { setShowPassModal(false); setChangeErr(''); setChangeSuccess(false) }}
                className="text-[#64748B] hover:text-[#172033] p-1 rounded-md"
              >
                ✕
              </button>
            </div>

            {changeSuccess && (
              <div className="mt-4 rounded-lg border border-[#0D9488]/30 bg-[#E6F4F1] p-3 text-xs font-semibold text-[#0D9488]">
                ✓ Password updated successfully! Your new password is now active.
              </div>
            )}

            {changeErr && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-[#DC2626]">
                ✕ {changeErr}
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="mt-4 flex flex-col gap-3.5">
              <div>
                <label className="text-xs font-bold text-[#172033]">New Password</label>
                <input
                  type="password"
                  required
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="At least 8 characters"
                  className="mt-1 min-h-10 w-full rounded-lg border border-[#E2E8F0] px-3 text-sm text-[#172033] focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#172033]">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Repeat new password"
                  className="mt-1 min-h-10 w-full rounded-lg border border-[#E2E8F0] px-3 text-sm text-[#172033] focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] focus:outline-none"
                />
              </div>

              <div className="mt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => { setShowPassModal(false); setChangeErr(''); setChangeSuccess(false) }}
                  disabled={changing}
                  className="rounded-lg border border-[#E2E8F0] px-4 py-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changing}
                  className="rounded-lg bg-[#1D3557] px-4 py-2 text-xs font-bold text-white hover:bg-[#14243B] disabled:opacity-50 transition-colors"
                >
                  {changing ? 'Saving…' : 'Save New Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
