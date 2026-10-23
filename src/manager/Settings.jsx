import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'

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
          Manage your school details and the official contact phone number shown to parents.
        </p>
      </header>

      <SettingsForm
        key={school?.id || 'loading'}
        school={school}
        onSave={updateSchoolSettings}
      />

      <section className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/50 p-5 text-xs text-muted">
        <p className="font-semibold text-ink">🔒 Security &amp; Audit Notice</p>
        <p className="mt-1 leading-relaxed">
          All changes to school office details and contact numbers are validated against database security constraints and automatically recorded in the school&apos;s immutable audit log.
        </p>
      </section>
    </div>
  )
}
