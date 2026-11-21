import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { useAuth } from '../lib/useAuth.js'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const { user, role, signIn, signOut, signInDemo, updatePassword, authError } = useAuth()

  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  const checkingRoleRef = useRef(false)
  const [requirePasswordChange, setRequirePasswordChange] = useState(false)
  const isFirstTimePasswordChange = requirePasswordChange || Boolean(
    user?.app_metadata?.must_change_password || user?.user_metadata?.must_change_password
  )
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [changeError, setChangeError] = useState('')

  function getAuthorizedDestination(userRole, requestedPath) {
    if (!requestedPath || requestedPath === '/') return getRoleHome(userRole)
    if (userRole === 'driver' && requestedPath.startsWith('/driver')) return requestedPath
    if (userRole === 'parent' && (requestedPath.startsWith('/home') || requestedPath.startsWith('/map') || requestedPath.startsWith('/alerts'))) return requestedPath
    if (userRole === 'manager' && requestedPath.startsWith('/manager')) return requestedPath
    if (userRole === 'owner' && requestedPath.startsWith('/owner')) return requestedPath
    return getRoleHome(userRole)
  }

  function getRoleHome(userRole) {
    if (userRole === 'owner') return '/owner'
    if (userRole === 'manager') return '/manager'
    if (userRole === 'driver') return '/driver'
    if (userRole === 'parent') return '/home'
    return '/'
  }

  useEffect(() => {
    if (checkingRoleRef.current || requirePasswordChange) return
    if (user && role) {
      const mustChange = Boolean(user.app_metadata?.must_change_password || user.user_metadata?.must_change_password)
      if (mustChange) {
        setRequirePasswordChange(true)
        return
      }
      const destination = location.state?.from?.pathname
      const target = getAuthorizedDestination(role, destination)
      navigate(target, { replace: true })
    }
  }, [user, role, navigate, location, requirePasswordChange])

  async function handleSubmit(event) {
    event.preventDefault()
    setLocalError('')

    if (!identifier.trim() || !password) {
      setLocalError('Please enter your email or phone number and password.')
      return
    }

    checkingRoleRef.current = true
    setLoading(true)
    const result = await signIn(identifier, password)
    setLoading(false)

    if (!result.success) {
      checkingRoleRef.current = false
      setLocalError(result.error || 'Incorrect email or password. Please try again.')
      return
    }

    const userRole = result.role || result.profile?.role
    const mustChange = Boolean(
      result.user?.app_metadata?.must_change_password || result.user?.user_metadata?.must_change_password
    )

    if (mustChange) {
      setRequirePasswordChange(true)
      return
    }

    checkingRoleRef.current = false
    const destination = location.state?.from?.pathname
    const target = getAuthorizedDestination(userRole, destination)
    navigate(target, { replace: true })
  }

  async function handlePasswordChangeSubmit(e) {
    e.preventDefault()
    setChangeError('')

    if (newPassword.length < 8) {
      setChangeError('Password must be at least 8 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setChangeError('Passwords do not match.')
      return
    }

    setChangingPassword(true)
    const res = await updatePassword(newPassword)
    setChangingPassword(false)

    if (res.success) {
      setRequirePasswordChange(false)
      checkingRoleRef.current = false
      const destination = location.state?.from?.pathname
      const userRole = role || user?.profile?.role
      const target = getAuthorizedDestination(userRole, destination)
      navigate(target, { replace: true })
    } else {
      setChangeError(res.error || 'Failed to update password. Please try again.')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8 sm:p-6">
      <div className="card-3d flex flex-col justify-center gap-7 rounded-3xl p-6 sm:p-8 shadow-[0_20px_50px_rgba(15,23,42,0.08)] border border-white/85">

        {/* Branding with 3D Emblem */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-tr from-[#1D3557] to-[#0D9488] text-white shadow-[0_8px_24px_rgba(13,148,136,0.25)] border border-[#0D9488]/30 transform hover:scale-105 transition-transform duration-300">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="12" rx="3" />
              <path d="M3 11h18" />
              <circle cx="8" cy="19" r="2" fill="currentColor" />
              <circle cx="16" cy="19" r="2" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-black tracking-tight text-[#172033]">SchoolBus Connect</h1>
            <p className="mt-0.5 text-xs font-semibold uppercase tracking-wider text-[#64748B]">
              Safe Student Transit
            </p>
          </div>
        </div>

        {/* Error Banner */}
        {(localError || authError) && (
          <div className="card-3d rounded-2xl border-[#DC2626]/30 bg-red-50/90 p-3.5 text-xs font-bold text-[#DC2626] shadow-2xs">
            {localError || authError}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="identifier" className="text-xs font-black uppercase tracking-wider text-[#172033]">
              Email or Phone Number
            </label>
            <input
              id="identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              disabled={loading}
              placeholder="e.g. 0911223344 or name@school.com"
              className="min-h-12 rounded-2xl border border-[#E2E8F0] bg-white px-4 text-sm font-medium text-[#172033] placeholder:text-[#64748B]/60 shadow-2xs focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20 focus:outline-none transition-all"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-xs font-black uppercase tracking-wider text-[#172033]">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              placeholder="••••••••"
              className="min-h-12 rounded-2xl border border-[#E2E8F0] bg-white px-4 text-sm font-medium text-[#172033] placeholder:text-[#64748B]/60 shadow-2xs focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20 focus:outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn-3d-accent mt-2 flex min-h-13 items-center justify-center rounded-2xl text-base font-black text-white disabled:opacity-50"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Signing in…</span>
              </div>
            ) : (
              'Sign In →'
            )}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-[#64748B] font-medium">
            {t('login.forgot') || 'Your account is created by your school. Contact your school administrator if you need assistance.'}
          </p>
        </form>

        {/* Language footer */}
        <div className="flex flex-col items-center justify-center border-t border-[#E2E8F0] pt-4">
          <LanguageSwitch />
        </div>
      </div>

      {/* Set permanent password modal (shown after first login with temp password) */}
      {isFirstTimePasswordChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-sm rounded-3xl p-6 shadow-[0_25px_60px_rgba(15,23,42,0.2)] border border-white/90">
            <h2 className="text-lg font-black text-slate-900">Set Your Permanent Password</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">
              You are using a temporary password. Please set a secure permanent password before continuing.
            </p>

            {changeError && (
              <div className="mt-3 rounded-2xl bg-red-50/90 border border-red-200 p-3 text-xs font-bold text-red-700">
                {changeError}
              </div>
            )}

            <form onSubmit={handlePasswordChangeSubmit} className="mt-4 flex flex-col gap-3">
              <div>
                <label className="text-xs font-extrabold text-slate-700">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="mt-1 w-full rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-extrabold text-slate-700">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="mt-1 w-full rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={changingPassword}
                className="btn-3d-accent mt-2 rounded-2xl py-3 text-sm font-black text-white disabled:opacity-50"
              >
                {changingPassword ? 'Saving…' : 'Save & Continue →'}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  )
}
