import { useState, useEffect } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'

export default function ParentInvite() {
  const { token: paramToken } = useParams()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { user, profile, signIn } = useAuth()

  const token = paramToken || searchParams.get('token') || ''

  const [loading, setLoading] = useState(true)
  const [inviteData, setInviteData] = useState(null)
  const [validateError, setValidateError] = useState(null)

  // Registration / Claim Form State
  const [mode, setMode] = useState('register') // 'register' | 'login'
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [claimError, setClaimError] = useState(null)
  const [claimSuccess, setClaimSuccess] = useState(false)
  const [linkedChildName, setLinkedChildName] = useState('')

  // 1. Validate token on load
  useEffect(() => {
    let ignore = false

    async function validateToken() {
      if (!token) {
        if (!ignore) {
          setValidateError('No invitation token found in this link. Please verify your invitation link.')
          setLoading(false)
        }
        return
      }

      setLoading(true)
      setValidateError(null)

      try {
        const res = await fetch(`/api/validate-invite?token=${encodeURIComponent(token)}`)
        const data = await res.json().catch(() => ({}))

        if (ignore) return

        if (!res.ok || !data.valid) {
          setValidateError(data.error || 'This invitation link is invalid or has expired.')
        } else {
          setInviteData(data)
          setPhone(data.phone_number || '')
          if (data.is_existing_user) {
            setMode('login')
          }
        }
      } catch (err) {
        if (!ignore) {
          setValidateError('Network error checking invitation. Please check your connection and try again.')
        }
      } finally {
        if (!ignore) setLoading(false)
      }
    }

    validateToken()
    return () => { ignore = true }
  }, [token])

  // 2. Claim for already logged-in user
  async function handleClaimExistingSession() {
    setSubmitting(true)
    setClaimError(null)

    try {
      const session = (await supabase.auth.getSession())?.data?.session
      const accessToken = session?.access_token

      const res = await fetch('/api/claim-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken ? `Bearer ${accessToken}` : '',
        },
        body: JSON.stringify({
          token,
          phone: inviteData?.phone_number || profile?.phone,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to claim invitation.')
      }

      setClaimSuccess(true)
      setLinkedChildName(data.student_name || 'your child')
      setTimeout(() => {
        navigate('/home', { replace: true })
      }, 2000)
    } catch (err) {
      setClaimError(err.message || 'Error connecting student to account.')
    } finally {
      setSubmitting(false)
    }
  }

  // 3. Register & Claim
  async function handleRegisterAndClaim(e) {
    e.preventDefault()
    setClaimError(null)

    if (password.length < 8) {
      setClaimError('Password must be at least 8 characters long.')
      return
    }

    if (password !== confirmPassword) {
      setClaimError('Passwords do not match.')
      return
    }

    setSubmitting(true)

    try {
      // 1. Call serverless claim endpoint (creates auth user + atomic db link)
      const res = await fetch('/api/claim-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          phone: phone.trim(),
          password,
          full_name: fullName.trim() || 'Parent Guardian',
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (res.status === 409 && data.already_registered) {
        setMode('login')
        setClaimError(data.error)
        setSubmitting(false)
        return
      }

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to complete registration.')
      }

      setClaimSuccess(true)
      setLinkedChildName(data.student_name || 'your child')

      // 2. Sign in parent locally with their credentials
      await signIn(phone.trim(), password)

      setTimeout(() => {
        navigate('/home', { replace: true })
      }, 2000)
    } catch (err) {
      setClaimError(err.message || 'Failed to complete account registration.')
    } finally {
      setSubmitting(false)
    }
  }

  // 4. Login & Claim
  async function handleLoginAndClaim(e) {
    e.preventDefault()
    setClaimError(null)
    setSubmitting(true)

    try {
      // First log in with credentials
      const loginRes = await signIn(phone.trim(), password)
      if (!loginRes.success) {
        setClaimError(loginRes.error || 'Incorrect phone number or password.')
        setSubmitting(false)
        return
      }

      // Claim invite for logged-in user
      const session = (await supabase.auth.getSession())?.data?.session
      const accessToken = session?.access_token

      const res = await fetch('/api/claim-invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: accessToken ? `Bearer ${accessToken}` : '',
        },
        body: JSON.stringify({
          token,
          phone: phone.trim(),
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to claim invitation.')
      }

      setClaimSuccess(true)
      setLinkedChildName(data.student_name || 'your child')
      setTimeout(() => {
        navigate('/home', { replace: true })
      }, 2000)
    } catch (err) {
      setClaimError(err.message || 'Failed to claim child invitation.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-4 py-8 sm:p-6">
      <div className="card-3d flex flex-col gap-6 rounded-3xl p-6 sm:p-8 shadow-[0_20px_50px_rgba(15,23,42,0.08)] border border-white/85">

        {/* Branding */}
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-tr from-amber-500 to-amber-300 text-slate-950 shadow-[0_8px_24px_rgba(245,179,1,0.38)] border border-amber-200/60">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="12" rx="3" />
              <path d="M3 11h18" />
              <circle cx="8" cy="19" r="2" fill="currentColor" />
              <circle cx="16" cy="19" r="2" fill="currentColor" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">SchoolBus Connect</h1>
            <p className="mt-0.5 text-xs font-bold uppercase tracking-wider text-amber-700">
              Parent Invitation
            </p>
          </div>
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <div className="h-9 w-9 animate-spin rounded-full border-3 border-amber border-t-transparent" />
            <p className="text-xs font-semibold text-slate-500">Checking your invitation link…</p>
          </div>
        )}

        {/* Invalid / Expired / Revoked Error Card */}
        {!loading && validateError && (
          <div className="flex flex-col gap-4 text-center py-4">
            <div className="flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-red-100 text-2xl text-red-600">
              ⚠️
            </div>
            <div>
              <h2 className="text-base font-extrabold text-slate-900">Invitation Link Unavailable</h2>
              <p className="mt-2 text-xs font-medium text-slate-600 leading-relaxed">
                {validateError}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-200/80 p-3 text-[11px] text-slate-500 leading-relaxed">
              If your child attends a school using SchoolBus Connect, please ask the school manager to generate and share a new invitation link.
            </div>
            <Link
              to="/"
              className="btn-3d-subtle flex min-h-11 items-center justify-center rounded-2xl text-xs font-black text-slate-800 mt-2"
            >
              Go to Login Page →
            </Link>
          </div>
        )}

        {/* Valid Invitation Flow */}
        {!loading && !validateError && inviteData && (
          <div className="flex flex-col gap-5">
            {/* School & Phone Badge */}
            <div className="rounded-2xl bg-amber-50/80 border border-amber-200/90 p-4 text-center">
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-800">School Bus Registration</span>
              <p className="text-sm font-extrabold text-slate-900 mt-0.5">{inviteData.school_name}</p>
              <p className="text-xs font-medium text-slate-600 mt-1">
                Authorized for phone: <strong className="font-mono text-slate-900">{inviteData.phone_masked}</strong>
              </p>
            </div>

            {/* Success Celebration */}
            {claimSuccess ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl text-emerald-600 shadow-sm animate-bounce">
                  ✓
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Child Connected Successfully!</h3>
                  <p className="mt-1 text-xs text-slate-600 font-medium">
                    {linkedChildName} is now linked to your parent portal.
                  </p>
                  <p className="mt-3 text-xs font-bold text-emerald-700 animate-pulse">
                    Redirecting to live bus tracker…
                  </p>
                </div>
              </div>
            ) : (
              <>
                {claimError && (
                  <div className="rounded-2xl border border-red-200 bg-red-50/90 p-3.5 text-xs font-bold text-red-700 shadow-2xs">
                    {claimError}
                  </div>
                )}

                {/* Case 1: User is ALREADY logged in */}
                {user ? (
                  <div className="flex flex-col gap-4 text-center py-2">
                    <p className="text-xs text-slate-600 font-medium">
                      You are signed in as <strong className="text-slate-900">{profile?.full_name || user.email}</strong>.
                    </p>
                    <button
                      type="button"
                      onClick={handleClaimExistingSession}
                      disabled={submitting}
                      className="btn-3d-amber flex min-h-13 items-center justify-center rounded-2xl text-sm font-black text-slate-950 disabled:opacity-50"
                    >
                      {submitting ? 'Connecting Child…' : 'Accept Invitation & Connect Child →'}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Case 2: Parent Needs to Register or Login */}
                    <div className="flex rounded-2xl bg-slate-100/80 p-1 border border-slate-200/80">
                      <button
                        type="button"
                        onClick={() => { setMode('register'); setClaimError(null) }}
                        className={
                          'flex-1 rounded-xl py-2 text-xs font-black transition-all ' +
                          (mode === 'register' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900')
                        }
                      >
                        Create Account
                      </button>
                      <button
                        type="button"
                        onClick={() => { setMode('login'); setClaimError(null) }}
                        className={
                          'flex-1 rounded-xl py-2 text-xs font-black transition-all ' +
                          (mode === 'login' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-500 hover:text-slate-900')
                        }
                      >
                        Already Have Account
                      </button>
                    </div>

                    {mode === 'register' ? (
                      /* Registration Form */
                      <form onSubmit={handleRegisterAndClaim} className="flex flex-col gap-3.5">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-extrabold text-slate-700">Your Full Name</label>
                          <input
                            type="text"
                            required
                            placeholder="e.g. Almaz Kebede"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="min-h-11 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-extrabold text-slate-700">Phone Number</label>
                          <input
                            type="tel"
                            required
                            placeholder="09xxxxxxxx"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="min-h-11 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                          />
                          <span className="text-[10px] text-slate-400 font-medium">Must match the number registered by the school ({inviteData.phone_masked}).</span>
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-extrabold text-slate-700">Create Password</label>
                          <input
                            type="password"
                            required
                            placeholder="At least 8 characters"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="min-h-11 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-extrabold text-slate-700">Confirm Password</label>
                          <input
                            type="password"
                            required
                            placeholder="Repeat your password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="min-h-11 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={submitting}
                          className="btn-3d-amber mt-2 flex min-h-13 items-center justify-center rounded-2xl text-sm font-black text-slate-950 disabled:opacity-50"
                        >
                          {submitting ? 'Creating Account & Linking…' : 'Create Account & Connect Bus →'}
                        </button>
                      </form>
                    ) : (
                      /* Login Form */
                      <form onSubmit={handleLoginAndClaim} className="flex flex-col gap-3.5">
                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-extrabold text-slate-700">Phone Number</label>
                          <input
                            type="tel"
                            required
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="min-h-11 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                          />
                        </div>

                        <div className="flex flex-col gap-1">
                          <label className="text-xs font-extrabold text-slate-700">Password</label>
                          <input
                            type="password"
                            required
                            placeholder="Your account password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="min-h-11 rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                          />
                        </div>

                        <button
                          type="submit"
                          disabled={submitting}
                          className="btn-3d-amber mt-2 flex min-h-13 items-center justify-center rounded-2xl text-sm font-black text-slate-950 disabled:opacity-50"
                        >
                          {submitting ? 'Connecting…' : 'Log In & Connect Child →'}
                        </button>
                      </form>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex justify-center border-t border-slate-200/80 pt-4">
          <LanguageSwitch />
        </div>
      </div>
    </main>
  )
}
