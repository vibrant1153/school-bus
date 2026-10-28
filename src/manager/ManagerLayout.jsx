import { useState } from 'react'
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
  const { user, profile, signOut, updatePassword } = useAuth()
  const { school } = useManagerData()

  const [showPassModal, setShowPassModal] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [changing, setChanging] = useState(false)
  const [changeErr, setChangeErr] = useState('')
  const [changeSuccess, setChangeSuccess] = useState(false)

  const mustChangePassword = Boolean(user?.app_metadata?.must_change_password || user?.user_metadata?.must_change_password)
  const schoolName = school?.name || 'School Portal'
  const managerName = profile?.full_name || 'Manager'

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
          <div className="flex items-center gap-1.5 lg:hidden">
            <button
              type="button"
              onClick={() => { setShowPassModal(true); setChangeErr(''); setChangeSuccess(false); setNewPass(''); setConfirmPass('') }}
              aria-label="Change Password"
              className="flex items-center gap-1 rounded-xl border border-white/20 bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/20 active:scale-95 transition-all shadow-xs"
            >
              <span>🔑</span>
            </button>
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="flex items-center gap-1.5 rounded-xl border border-red-500/40 bg-red-500/15 px-3 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500 hover:text-white active:scale-95 transition-all shadow-xs"
            >
              <span aria-hidden="true">🚪</span>
              <span>Log Out</span>
            </button>
          </div>
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
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => { setShowPassModal(true); setChangeErr(''); setChangeSuccess(false); setNewPass(''); setConfirmPass('') }}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/10 py-1.5 text-xs font-semibold text-night-muted hover:bg-white/20 hover:text-white transition-all shadow-2xs"
              >
                <span>🔑</span>
                <span>Change Password</span>
              </button>
              <button
                type="button"
                onClick={signOut}
                aria-label="Sign out"
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/15 py-1.5 text-xs font-bold text-red-400 hover:bg-red-500 hover:text-white active:scale-95 transition-all shadow-xs"
              >
                <span aria-hidden="true">🚪</span>
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Persistent Warning Banner if Manager is on temporary password */}
        {mustChangePassword && (
          <div className="bg-amber-400 px-6 py-2.5 text-ink font-semibold text-xs flex flex-wrap items-center justify-between gap-3 shadow-xs">
            <div className="flex items-center gap-2">
              <span className="text-sm">⚠️</span>
              <span>You are currently signed in with a temporary password. Please set your permanent password to secure your account.</span>
            </div>
            <button
              type="button"
              onClick={() => { setShowPassModal(true); setChangeErr(''); setChangeSuccess(false); setNewPass(''); setConfirmPass('') }}
              className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-white hover:bg-slate-800 transition-colors shadow-2xs"
            >
              Set Permanent Password Now →
            </button>
          </div>
        )}

        {/* Desktop Top Header Bar with prominent Sign Out */}
        <header className="hidden lg:flex h-16 items-center justify-between border-b border-gray-200 bg-white px-8">
          <div className="flex items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-live animate-pulse" aria-hidden="true" />
            <h2 className="text-sm font-bold text-ink">{schoolName}</h2>
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-muted">
              Active Term
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted">
              <span className="font-semibold text-ink">{managerName}</span>
              <span className="rounded-full bg-amber/20 px-2 py-0.5 font-bold text-amber-900">
                Manager
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setShowPassModal(true); setChangeErr(''); setChangeSuccess(false); setNewPass(''); setConfirmPass('') }}
              aria-label="Change Password"
              className="flex items-center gap-1.5 rounded-xl border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-gray-100 active:scale-95 transition-all"
            >
              <span>🔑</span>
              <span>Password</span>
            </button>
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

      {/* Change Password Modal */}
      {showPassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber/20 text-lg">
                  🔐
                </span>
                <div>
                  <h3 className="text-lg font-bold text-ink">Change Account Password</h3>
                  <p className="text-xs text-muted font-mono">{user?.email || managerName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setShowPassModal(false); setChangeErr(''); setChangeSuccess(false) }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {changeSuccess && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800">
                ✓ Password updated successfully! Your new password is now active.
              </div>
            )}

            {changeErr && (
              <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700">
                ✕ {changeErr}
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-ink">New Password</label>
                <input
                  type="password"
                  required
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="At least 8 characters"
                  className="mt-1 min-h-11 w-full rounded-xl border border-field px-3.5 text-sm text-ink focus:border-amber focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-ink">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Repeat new password"
                  className="mt-1 min-h-11 w-full rounded-xl border border-field px-3.5 text-sm text-ink focus:border-amber focus:outline-none"
                />
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setShowPassModal(false); setChangeErr(''); setChangeSuccess(false) }}
                  disabled={changing}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changing}
                  className="rounded-xl bg-ink px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50"
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