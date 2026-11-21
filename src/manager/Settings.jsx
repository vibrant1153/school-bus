import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'
import { useAuth } from '../lib/useAuth.js'

const INPUT_CLASS = 'h-10 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs text-[#172033] placeholder:text-[#94A3B8] focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] focus:outline-none transition-colors'

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
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
      <div className="border-b border-[#E2E8F0] pb-3 mb-4">
        <h2 className="text-sm font-bold text-[#172033]">School Profile &amp; Contact</h2>
        <p className="text-xs text-[#64748B] mt-0.5">Official school identity displayed on the parent portal and notifications.</p>
      </div>

      {successMsg && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
          ✓ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-[#DC2626]">
          ✕ {errorMsg}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-bold text-[#172033]">School Name *</label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Hilltop International Academy"
            className={`mt-1 ${INPUT_CLASS}`}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-[#172033]">Official School Transit Phone *</label>
          <p className="mt-0.5 text-[11px] text-[#64748B]">
            This is the phone number parents reach when clicking <strong>"Call School"</strong> on their dashboard.
          </p>
          <input
            type="tel"
            required
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            placeholder="+251911223344 or 0911223344"
            className={`mt-1 ${INPUT_CLASS}`}
          />
        </div>

        <div>
          <label className="text-xs font-bold text-[#172033]">Operational Timezone</label>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className={`mt-1 ${INPUT_CLASS}`}
          >
            <option value="Africa/Addis_Ababa">Africa/Addis_Ababa (East Africa Time, UTC+3)</option>
            <option value="UTC">UTC (Coordinated Universal Time)</option>
            <option value="Africa/Nairobi">Africa/Nairobi (UTC+3)</option>
            <option value="Africa/Cairo">Africa/Cairo (UTC+2)</option>
          </select>
        </div>

        <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-3 mt-1">
          <div className="text-[11px] text-[#64748B]">
            School Identifier: <span className="font-mono font-bold text-[#172033]">{school?.code || '—'}</span>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50 transition-colors shadow-2xs"
          >
            {saving ? 'Saving…' : 'Save School Settings'}
          </button>
        </div>
      </form>
    </div>
  )
}

function ManagerSecurityForm() {
  const { user, profile, updatePassword } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [successMsg, setSuccessMsg] = useState(null)
  const [errorMsg, setErrorMsg] = useState(null)

  const mustChange = Boolean(
    user?.app_metadata?.must_change_password || user?.user_metadata?.must_change_password
  )

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
      setSuccessMsg('Your administrative password has been updated.')
      setNewPassword('')
      setConfirmPassword('')
    } else {
      setErrorMsg(res.error || 'Failed to update password.')
    }
  }

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
      <div className="border-b border-[#E2E8F0] pb-3 mb-4">
        <h2 className="text-sm font-bold text-[#172033]">Manager Account Credentials</h2>
        <p className="text-xs text-[#64748B] mt-0.5">
          Logged in as <strong>{profile?.full_name || 'Manager'}</strong> ({user?.email || 'No email attached'})
        </p>
      </div>

      {mustChange && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs font-semibold text-amber-900">
          ⚠️ You are currently using a temporary password. Please set a permanent password.
        </div>
      )}

      {successMsg && (
        <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
          ✓ {successMsg}
        </div>
      )}

      {errorMsg && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-[#DC2626]">
          ✕ {errorMsg}
        </div>
      )}

      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-bold text-[#172033]">New Password *</label>
            <input
              type="password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </div>

          <div>
            <label className="text-xs font-bold text-[#172033]">Confirm Password *</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat new password"
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-[#E2E8F0] mt-1">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-[#1D3557] px-4 py-2 text-xs font-bold text-white hover:bg-[#14243B] disabled:opacity-50 transition-colors shadow-2xs"
          >
            {saving ? 'Updating…' : 'Update Manager Password'}
          </button>
        </div>
      </form>
    </div>
  )
}

function LocationHistoryCard({ onPurge }) {
  const [confirming, setConfirming] = useState(false)
  const [purging, setPurging] = useState(false)
  const [lastPurgedMsg, setLastPurgedMsg] = useState(null)
  const [purgeError, setPurgeError] = useState(null)

  async function handlePurgeNow() {
    setPurging(true)
    setPurgeError(null)
    try {
      await onPurge()
      setLastPurgedMsg(`Location history successfully purged at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`)
      setConfirming(false)
    } catch (err) {
      setPurgeError(err.message || 'Failed to purge location history.')
    } finally {
      setPurging(false)
    }
  }

  return (
    <section className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs flex flex-col gap-3">
      <div className="border-b border-[#E2E8F0] pb-3">
        <h2 className="text-sm font-bold text-[#172033]">Data Retention &amp; GPS Privacy</h2>
        <p className="text-xs text-[#64748B] mt-0.5">Protect student privacy by clearing historical GPS breadcrumbs from finished runs.</p>
      </div>

      <p className="text-xs leading-relaxed text-[#172033]">
        To maintain student transit privacy and data protection compliance, GPS coordinates of finished trips can be purged on demand. Ongoing trips today are protected and will never be affected.
      </p>

      {lastPurgedMsg && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-800">
          ✓ {lastPurgedMsg}
        </p>
      )}

      {purgeError && (
        <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-[#DC2626]">
          ✕ {purgeError}
        </p>
      )}

      {confirming ? (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-3.5">
          <p className="text-xs font-bold text-[#DC2626]">
            Permanently delete GPS coordinates from finished trips before today?
          </p>
          <p className="text-[11px] text-red-900 leading-relaxed">
            This action cannot be undone. Summary logs (trip start/end times and attendance) remain preserved.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={purging}
              onClick={handlePurgeNow}
              className="rounded-lg bg-[#DC2626] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {purging ? 'Purging…' : 'Yes, purge now'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3.5 py-2 text-xs font-bold text-amber-900 hover:bg-amber-100 transition-colors shadow-2xs"
          >
            Purge Historical GPS Records
          </button>
        </div>
      )}
    </section>
  )
}

export default function Settings() {
  const { school, updateSchoolSettings, purgeLocationHistory, loading } = useManagerData()

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0D9488] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <div className="border-b border-[#E2E8F0] pb-4">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033]">School Office &amp; Settings</h1>
        <p className="text-xs text-[#64748B] mt-0.5">
          Configure administrative phone contacts, manager access credentials, and student privacy policies.
        </p>
      </div>

      <SettingsForm
        key={school?.id || 'loading'}
        school={school}
        onSave={updateSchoolSettings}
      />

      <ManagerSecurityForm />

      <LocationHistoryCard onPurge={purgeLocationHistory} />
    </div>
  )
}
