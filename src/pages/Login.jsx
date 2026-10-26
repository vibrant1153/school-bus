import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { useAuth } from '../lib/useAuth.js'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const { user, role, signIn, signOut, signInDemo, updatePassword, authError } = useAuth()

  // Default mode is strictly 'parent' so parents never get confused by driver/staff controls
  const [loginMode, setLoginMode] = useState('parent')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [localError, setLocalError] = useState('')

  // First-time temporary password change state (stored in app_metadata)
  const isFirstTimePasswordChange = Boolean(
    user?.app_metadata?.must_change_password || user?.user_metadata?.must_change_password
  )
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [changeError, setChangeError] = useState('')

  function getAuthorizedDestination(userRole, requestedPath) {
    if (!requestedPath || requestedPath === '/') {
      return getRoleHome(userRole)
    }
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
    return '/home'
  }

  // Route authenticated user to their role destination
  useEffect(() => {
    if (user && role && !user.app_metadata?.must_change_password && !user.user_metadata?.must_change_password) {
      const destination = location.state?.from?.pathname
      const target = getAuthorizedDestination(role, destination)
      navigate(target, { replace: true })
    }
  }, [user, role, navigate, location])

  async function handleSubmit(event) {
    event.preventDefault()
    setLocalError('')

    if (!identifier.trim() || !password) {
      setLocalError(
        loginMode === 'parent'
          ? 'Please enter your phone number or email and your password.'
          : 'Please enter your staff identifier and password.'
      )
      return
    }

    setLoading(true)
    const result = await signIn(identifier, password)
    setLoading(false)

    if (!result.success) {
      setLocalError(result.error || 'Failed to sign in. Please verify your credentials.')
      return
    }

    // Role-mode alignment check: prevent drivers from logging into the parent portal and vice-versa
    const userRole = result.role || result.profile?.role
    if (loginMode === 'parent' && userRole && userRole !== 'parent') {
      await signOut()
      setLocalError(
        userRole === 'driver'
          ? '⚠️ This is a Driver account. Please switch to the "🚌 Staff & Driver" tab to sign in.'
          : `⚠️ This is a ${userRole} account. Please switch to the "🚌 Staff & Driver" tab to sign in.`
      )
      return
    }

    if (loginMode === 'staff' && userRole === 'parent') {
      await signOut()
      setLocalError('⚠️ This is a Parent account. Please switch to the "👨‍👩‍👧 Parent Portal" tab to sign in.')
      return
    }
  }

  async function handlePasswordChangeSubmit(e) {
    e.preventDefault()
    setChangeError('')

    if (newPassword.length < 8) {
      setChangeError('New password must be at least 8 characters long.')
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
      if (role === 'owner') navigate('/owner', { replace: true })
      else if (role === 'manager') navigate('/manager', { replace: true })
      else if (role === 'driver') navigate('/driver', { replace: true })
      else navigate('/home', { replace: true })
    } else {
      setChangeError(res.error || 'Failed to update password. Please try again.')
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-6 p-6">
      {/* Header with App Branding and Language Switch */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-amber shadow-sm">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="12" rx="2" />
              <path d="M3 11h18" />
              <circle cx="8" cy="19" r="1.5" />
              <circle cx="16" cy="19" r="1.5" />
            </svg>
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-bold leading-tight text-ink">SchoolBus Connect</span>
            <span className="text-[11px] font-medium text-muted">Student Transportation Safety</span>
          </div>
        </div>
        <LanguageSwitch />
      </header>

      {/* Segmented Mode Selector: Defaults 100% to Parent Portal */}
      <div className="flex rounded-xl bg-gray-100 p-1 text-sm font-semibold">
        <button
          type="button"
          onClick={() => {
            setLoginMode('parent')
            setLocalError('')
          }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-center transition-all ${
            loginMode === 'parent'
              ? 'bg-white text-ink shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          <span>👨‍👩‍👧</span>
          <span>{t('login.parentBadge') || 'Parent Portal'}</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setLoginMode('staff')
            setLocalError('')
          }}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2.5 text-center transition-all ${
            loginMode === 'staff'
              ? 'bg-white text-ink shadow-sm'
              : 'text-muted hover:text-ink'
          }`}
        >
          <span>🚌</span>
          <span>{t('login.staffBadge') || 'Staff & Driver'}</span>
        </button>
      </div>

      {/* Welcome Title & Subtitle */}
      <section className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {loginMode === 'parent'
            ? t('login.parentTitle') || 'Parent Sign In'
            : t('login.staffTitle') || 'Staff & Driver Sign In'}
        </h1>
        <p className="text-sm leading-relaxed text-muted">
          {loginMode === 'parent'
            ? t('login.parentSubtitle') || 'Track your child\'s school bus in real time. Use the phone number or email registered with your school.'
            : t('login.staffSubtitle') || 'For assigned bus drivers, dispatchers, and school administration.'}
        </p>
      </section>

      {/* Error Banner */}
      {(localError || authError) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {localError || authError}
        </div>
      )}

      {/* Login Form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="identifier" className="text-sm font-semibold text-ink">
            {loginMode === 'parent'
              ? t('login.parentIdentifier') || 'Phone number or email'
              : t('login.staffIdentifier') || 'Staff email or username'}
          </label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
            placeholder={
              loginMode === 'parent'
                ? t('login.parentPlaceholder') || '09xxxxxxxx or email'
                : t('login.staffPlaceholder') || 'driver@schoolbus.local'
            }
            className="min-h-12 rounded-xl border border-field bg-white px-3.5 text-base text-ink placeholder:text-gray-400 focus:border-amber focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-sm font-semibold text-ink">
            {t('login.password')}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={loading}
            placeholder={t('login.passwordPlaceholder')}
            className="min-h-12 rounded-xl border border-field bg-white px-3.5 text-base text-ink placeholder:text-gray-400 focus:border-amber focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className={`flex min-h-12.5 items-center justify-center rounded-xl text-base font-bold transition-opacity hover:opacity-95 disabled:opacity-50 ${
            loginMode === 'parent'
              ? 'bg-amber text-ink shadow-sm'
              : 'bg-slate-800 text-white shadow-sm'
          }`}
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <span className={`h-4 w-4 animate-spin rounded-full border-2 border-t-transparent ${loginMode === 'parent' ? 'border-ink' : 'border-white'}`} />
              <span>Signing in...</span>
            </div>
          ) : loginMode === 'parent' ? (
            t('login.submitParent') || 'Sign In to Parent Portal'
          ) : (
            t('login.submitStaff') || 'Sign In as Staff / Driver'
          )}
        </button>

        {/* Reassurance & Help Text */}
        {loginMode === 'parent' ? (
          <div className="flex flex-col gap-2 pt-1 text-xs leading-relaxed text-muted">
            <p className="flex items-center gap-1.5 font-medium text-emerald-700">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>{t('login.privacy')}</span>
            </p>
            <p>{t('login.forgot')}</p>
          </div>
        ) : (
          <p className="pt-1 text-xs leading-relaxed text-muted">
            {t('login.forgot')}
          </p>
        )}
      </form>

      {/* Mode Switch Helper Link */}
      <div className="text-center">
        {loginMode === 'parent' ? (
          <button
            type="button"
            onClick={() => {
              setLoginMode('staff')
              setLocalError('')
            }}
            className="text-xs font-semibold text-slate-600 hover:text-ink hover:underline"
          >
            {t('login.switchToStaff') || 'Bus Driver or School Staff? Sign in here →'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setLoginMode('parent')
              setLocalError('')
            }}
            className="text-xs font-semibold text-amber-700 hover:text-ink hover:underline"
          >
            {t('login.switchToParent') || '← Back to Parent Sign In'}
          </button>
        )}
      </div>

      {/* First-time temporary password change modal */}
      {isFirstTimePasswordChange && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-xl font-bold text-ink">Set New Password</h2>
            <p className="mt-2 text-sm text-muted">
              You are logging in with a temporary password. Please choose a secure new password for your account.
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
                {changingPassword ? 'Updating...' : 'Save Password & Continue'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Demo Previews: segregated cleanly by mode */}
      <footer className="mt-auto flex flex-col gap-2 border-t border-gray-100 pt-5">
        {loginMode === 'parent' ? (
          <div className="flex items-center justify-between text-xs text-muted">
            <span className="font-medium">1-Click Demo:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  signInDemo('parent')
                  navigate('/home')
                }}
                className="rounded-lg border border-amber/40 bg-amber/10 px-3 py-1.5 font-bold text-amber-900 hover:bg-amber/20"
              >
                👨‍👩‍👧 Try Parent Demo
              </button>
              <button
                type="button"
                onClick={() => {
                  setLoginMode('staff')
                  setLocalError('')
                }}
                className="rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 font-medium text-slate-700 hover:bg-gray-100"
                title="Switch to Staff, Driver & Owner login"
              >
                Staff / Owner →
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 text-xs text-muted">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">Staff & Owner 1-Click Demos:</span>
              <button
                type="button"
                onClick={() => {
                  setLoginMode('parent')
                  setLocalError('')
                }}
                className="font-medium text-amber-700 hover:underline"
              >
                ← Parent Portal
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  signInDemo('driver')
                  navigate('/driver')
                }}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-ink hover:bg-gray-100"
              >
                🚌 Driver
              </button>
              <button
                type="button"
                onClick={() => {
                  signInDemo('manager')
                  navigate('/manager')
                }}
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1 font-medium text-ink hover:bg-gray-100"
              >
                🏫 Manager
              </button>
              <button
                type="button"
                onClick={() => {
                  signInDemo('owner')
                  navigate('/owner')
                }}
                className="rounded-md border border-purple-300 bg-purple-50 px-3 py-1 font-bold text-purple-900 shadow-sm hover:bg-purple-100"
              >
                👑 Owner
              </button>
            </div>
          </div>
        )}
      </footer>
    </main>
  )
}
