import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'
import { useAuth } from '../lib/useAuth.js'

function SettingsForm({ school, onSave }) {
  const [name, setName] = useState(school?.name || '')
  const [contactPhone, setContactPhone] = useState(school?.contact_phone || '')
  const [timezone, setTimezone] = useState(school?.timezone || 'Africa/Addis_Ababa')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    setSuccessMsg(null)
    setErrorMsg(null)

    try {
      await onSave({
        name,
        contactPhone,
        timezone,
      })
      setSuccessMsg('School settings updated successfully! The new contact phone is now live for all parents.')
    } catch (err) {
      setErrorMsg(err.message || 'Failed to update school settings.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
          ✓ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">
          ✕ {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-5 rounded-2xl bg-white p-6 shadow-xs">
        <div>
          <label className="text-sm font-bold text-ink">School Name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hilltop International Academy"
            className="mt-1.5 min-h-12 w-full rounded-xl border border-field px-3.5 text-base text-ink focus:border-amber focus:outline-none"
          />
        </div>

        <div>
          <label className="text-sm font-bold text-ink">School Office Contact Phone</label>
          <p className="mt-0.5 text-xs text-muted">
            This is the phone number that parents tap on their Home screen when they click <b>&ldquo;Call school office&rdquo;</b>.
          </p>
          <input
            type="tel"
            required
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="+251911223344 or 0911223344"
            className="mt-1.5 min-h-12 w-full rounded-xl border border-field px-3.5 text-base text-ink focus:border-amber focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-muted">
            Format: E.164 international format (e.g. <code>+251911223344</code>) or local <code>09xxxxxxxx</code>.
          </p>
        </div>

        <div>
          <label className="text-sm font-bold text-ink">School Timezone</label>
          <p className="mt-0.5 text-xs text-muted">
            Used to determine the school-local date and schedule morning vs. afternoon trips.
          </p>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1.5 min-h-12 w-full rounded-xl border border-field bg-white px-3.5 text-base text-ink focus:border-amber focus:outline-none"
          >
            <option value="Africa/Addis_Ababa">Africa/Addis_Ababa (East Africa Time, UTC+3)</option>
            <option value="UTC">UTC (Coordinated Universal Time)</option>
            <option value="Africa/Nairobi">Africa/Nairobi (UTC+3)</option>
            <option value="Africa/Cairo">Africa/Cairo (UTC+2)</option>
          </select>
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-5">
          <div className="text-xs text-muted">
            School Code: <span className="font-mono font-bold text-ink">{school?.code || '—'}</span>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-amber px-6 py-3 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
          >
            {saving ? 'Saving changes…' : 'Save School Settings'}
          </button>
        </div>
      </form>
    </>
  )
}

function ManagerSecurityForm() {
  const { user, profile, updatePassword } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const mustChange = Boolean(user?.app_metadata?.must_change_password || user?.user_metadata?.must_change_password)

  async function handlePasswordSubmit(e) {
    e.preventDefault()
    setSuccessMsg(null)
    setErrorMsg(null)

    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.')
      return
    }
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.')
      return
    }

    setSaving(true)
    const res = await updatePassword(newPassword)
    setSaving(false)

    if (res.success) {
      setSuccessMsg('Your password has been successfully updated and secured!')
      setNewPassword('')
      setConfirmPassword('')
    } else {
      setErrorMsg(res.error || 'Failed to update password. Please try again.')
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-xs border border-gray-200">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber/20 text-lg">
          🔐
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">Manager Security &amp; Password</h2>
          <p className="text-xs text-muted">
            Logged in as <b>{profile?.full_name || 'Manager'}</b> ({user?.email || 'No email attached'})
          </p>
        </div>
      </div>

      {mustChange && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
          ⚠️ You are currently using a temporary password. Please set your permanent password below.
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800">
          ✓ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs font-semibold text-red-700">
          ✕ {errorMsg}
        </div>
      )}

      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-bold text-ink">New Password</label>
          <input
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="mt-1 min-h-11 w-full rounded-xl border border-field px-3.5 text-sm text-ink focus:border-amber focus:outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-bold text-ink">Confirm New Password</label>
          <input
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
            className="mt-1 min-h-11 w-full rounded-xl border border-field px-3.5 text-sm text-ink focus:border-amber focus:outline-none"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-xl bg-ink px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 disabled:opacity-50 shadow-xs"
          >
            {saving ? 'Updating Password…' : 'Update My Password'}
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Settings() {
  const { school, updateSchoolSettings, loading } = useManagerData()

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <header>
        <h1 className="text-[28px] font-bold text-ink">School Office &amp; Settings</h1>
        <p className="text-sm text-muted">
          Manage your school details, official contact phone number, and your manager account security.
        </p>
      </header>

      <SettingsForm
        key={school?.id || 'loading'}
        school={school}
        onSave={updateSchoolSettings}
      />

      <ManagerSecurityForm />

      <section className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-5 text-xs text-muted">
        <p className="font-semibold text-ink">🔒 Security &amp; Audit Notice</p>
        <p className="mt-1 leading-relaxed">
          All changes to school office details and manager credentials are automatically recorded in the school&apos;s immutable audit log.
        </p>
      </section>
    </div>
  )
}
