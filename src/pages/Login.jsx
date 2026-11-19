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
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col bg-white">
      <div className="flex flex-1 flex-col justify-center gap-8 px-6 py-10">

        {/* Branding */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber shadow-sm">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="12" rx="2" />
              <path d="M3 11h18" />
              <circle cx="8" cy="19" r="1.5" />
              <circle cx="16" cy="19" r="1.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-ink">SchoolBus Connect</h1>
            <p className="text-sm text-muted mt-0.5">Student Transportation Safety</p>
          </div>
        </div>

        {/* Error Banner */}
        {(localError || authError) && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">
            {localError || authError}
          </div>
        )}

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="identifier" className="text-sm font-semibold text-ink">
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
              placeholder="your@email.com or 09xxxxxxxx"
              className="min-h-12 rounded-xl border border-field bg-white px-3.5 text-base text-ink placeholder:text-gray-400 focus:border-amber focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="password" className="text-sm font-semibold text-ink">
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
              className="min-h-12 rounded-xl border border-field bg-white px-3.5 text-base text-ink placeholder:text-gray-400 focus:border-amber focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-1 flex min-h-13 items-center justify-center rounded-xl bg-amber text-base font-bold text-ink shadow-sm hover:opacity-95 disabled:opacity-50 transition-opacity"
          >
            {loading ? (
              <div className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-ink border-t-transparent" />
                <span>Signing in…</span>
              </div>
            ) : (
              'Sign In'
            )}
          </button>

          <p className="text-center text-xs text-muted">
            {t('login.forgot') || 'Your account is created by your school. Contact your school administrator if you have trouble signing in.'}
          </p>
        </form>

        {/* Language + Demo footer */}
        <div className="flex flex-col items-center gap-4 border-t border-gray-100 pt-5">
          <LanguageSwitch />
          <div className="flex flex-col gap-2 w-full text-xs text-muted">
            <p className="text-center font-semibold text-ink">1-Click Demos</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={() => { signInDemo('parent'); navigate('/home') }}
                className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-1.5 font-bold text-amber-900 hover:bg-amber/20"
              >
                👨‍👩‍👧 Parent
              </button>
              <button
                type="button"
                onClick={() => { signInDemo('driver'); navigate('/driver') }}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 font-medium text-slate-700 hover:bg-gray-100"
              >
                🚌 Driver
              </button>
              <button
                type="button"
                onClick={() => { signInDemo('manager'); navigate('/manager') }}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 font-medium text-slate-700 hover:bg-gray-100"
              >
                🏫 Manager
              </button>
              <button
                type="button"
                onClick={() => { signInDemo('owner'); navigate('/owner') }}
                className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 font-bold text-purple-700 hover:bg-purple-100"
              >
                👑 Owner
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Set permanent password modal (shown after first login with temp password) */}
      {isFirstTimePasswordChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-ink">Set Your Password</h2>
            <p className="mt-2 text-sm text-muted">
              You are using a temporary password. Please choose a secure permanent password before continuing.
            </p>

            {changeError && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                {changeError}
              </div>
            )}

            <form onSubmit={handlePasswordChangeSubmit} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">New Password</label>
                <input
                  type="password"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-ink">Confirm New Password</label>
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat new password"
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm"
                />
              </div>
              <button
                type="submit"
                disabled={changingPassword}
                className="mt-2 rounded-xl bg-amber py-3 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
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
