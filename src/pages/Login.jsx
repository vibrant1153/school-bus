import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { useAuth } from '../lib/useAuth.js'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { t } = useI18n()
  const { user, role, signIn, signInDemo, updatePassword, authError } = useAuth()

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

  // Route authenticated user to their role destination
  useEffect(() => {
    if (user && role && !user.app_metadata?.must_change_password && !user.user_metadata?.must_change_password) {
      const destination = location.state?.from?.pathname
      if (destination && destination !== '/') {
        navigate(destination, { replace: true })
      } else {
        if (role === 'owner') navigate('/owner', { replace: true })
        else if (role === 'manager') navigate('/manager', { replace: true })
        else if (role === 'driver') navigate('/driver', { replace: true })
        else navigate('/home', { replace: true })
      }
    }
  }, [user, role, navigate, location])

  async function handleSubmit(event) {
    event.preventDefault()
    setLocalError('')

    if (!identifier.trim() || !password) {
      setLocalError('Please enter both your identifier and password.')
      return
    }

    setLoading(true)
    const result = await signIn(identifier, password)
    setLoading(false)

    if (!result.success) {
      setLocalError(result.error || 'Failed to sign in. Please verify your credentials.')
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
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col gap-8 p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-amber">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <rect x="3" y="5" width="18" height="12" rx="2" />
              <path d="M3 11h18" />
              <circle cx="8" cy="19" r="1.5" />
              <circle cx="16" cy="19" r="1.5" />
            </svg>
          </div>
          <span className="text-lg font-bold">SchoolBus Connect</span>
        </div>
        <LanguageSwitch />
      </header>

      <section className="mt-8 flex flex-col gap-2">
        <h1 className="text-3xl font-bold">{t('login.title')}</h1>
        <p className="text-base leading-snug text-muted">{t('login.subtitle')}</p>
      </section>

      {(localError || authError) && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">
          {localError || authError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="identifier" className="text-[15px] font-semibold">
            {t('login.identifier')}
          </label>
          <input
            id="identifier"
            name="identifier"
            type="text"
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            disabled={loading}
            placeholder="name@example.com / 09xxxxxxxx"
            className="min-h-13 rounded-xl border border-field bg-white px-3.5 text-base focus:border-amber focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="password" className="text-[15px] font-semibold">
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
            className="min-h-13 rounded-xl border border-field bg-white px-3.5 text-base focus:border-amber focus:outline-none"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="flex min-h-13.5 items-center justify-center rounded-xl bg-amber text-[17px] font-bold text-ink transition-opacity hover:opacity-95 disabled:opacity-50"
        >
          {loading ? (
            <div className="flex items-center gap-2">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink border-t-transparent" />
              <span>Signing in...</span>
            </div>
          ) : (
            t('login.submit')
          )}
        </button>

        <p className="text-sm leading-relaxed text-muted">{t('login.forgot')}</p>
      </form>

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

      <footer className="mt-auto flex flex-col gap-2 pt-6 border-t border-gray-100">
        <p className="text-[13px] leading-relaxed text-muted">{t('login.privacy')}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-muted">
          <span className="font-semibold text-ink">Demo preview:</span>
          <button
            type="button"
            onClick={() => {
              signInDemo('parent')
              navigate('/home')
            }}
            className="rounded-md border border-gray-200 px-2.5 py-1 font-medium text-ink hover:bg-gray-100"
          >
            Parent
          </button>
          <button
            type="button"
            onClick={() => {
              signInDemo('driver')
              navigate('/driver')
            }}
            className="rounded-md border border-gray-200 px-2.5 py-1 font-medium text-ink hover:bg-gray-100"
          >
            Driver
          </button>
          <button
            type="button"
            onClick={() => {
              signInDemo('manager')
              navigate('/manager')
            }}
            className="rounded-md border border-gray-200 px-2.5 py-1 font-medium text-ink hover:bg-gray-100"
          >
            Manager
          </button>
          <button
            type="button"
            onClick={() => {
              signInDemo('owner')
              navigate('/owner')
            }}
            className="rounded-md border border-gray-200 px-2.5 py-1 font-medium text-ink hover:bg-gray-100"
          >
            Owner
          </button>
        </div>
      </footer>
    </main>
  )
}
