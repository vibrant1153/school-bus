import { useState } from 'react'
import { Link } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import ParentNav from '../components/ParentNav.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { useAuth } from '../lib/useAuth.js'
import { useParentData } from '../lib/useParentData.js'
import {
  describeAge,
  formatDistance,
} from '../prototype.js'

function StatusCard({ busStatus, busDistanceM, selectedChild, activeTrip }) {
  const { t } = useI18n()
  const busNumber = activeTrip?.buses?.bus_number || selectedChild?.busNumber || 1
  const stopName = selectedChild?.morningStop?.name || t('home.yourStop')
  const busLabel = t('home.bus', { n: busNumber })
  const stopLabel = stopName

  if (busStatus.mode === 'none') {
    const plannedTime = selectedChild?.morningStop?.time || '07:00 AM'
    return (
      <section className="card-3d relative overflow-hidden flex flex-col gap-3 rounded-3xl p-6" aria-live="polite">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600 border border-slate-200/60 shadow-2xs">
            <span className="h-2 w-2 rounded-full bg-slate-400" aria-hidden="true" />
            {t('home.none.badge')}
          </span>
          <span className="text-xs font-semibold text-slate-500">
            Next: {plannedTime}
          </span>
        </div>

        <div>
          <h2 className="text-2xl font-black text-slate-900 tracking-tight">{t('home.none.title')}</h2>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">{t('home.none.body', { time: plannedTime })}</p>
        </div>

        {/* Visual Route Overview for Beginners/Elders */}
        <div className="my-1 rounded-2xl bg-slate-50/80 border border-slate-200/60 p-3.5">
          <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
            <span>Route</span>
            <span>Your Stop</span>
            <span>School</span>
          </div>
          <div className="relative mt-2 flex items-center justify-between">
            <div className="absolute left-2 right-2 top-1/2 -translate-y-1/2 h-1 bg-slate-200 rounded-full" />
            <div className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-slate-300 text-[10px] font-bold text-slate-700 shadow-xs">
              1
            </div>
            <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-extrabold text-slate-900 shadow-xs border-2 border-white ring-2 ring-amber-300/40">
              📍
            </div>
            <div className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] font-bold text-white shadow-xs">
              🏫
            </div>
          </div>
          <p className="mt-2 text-center text-xs font-bold text-slate-700 truncate">
            {stopLabel}
          </p>
        </div>

        <Link
          to="/map"
          className="btn-3d-subtle mt-1 flex min-h-12 items-center justify-center rounded-2xl text-center text-sm font-bold text-slate-800"
        >
          {t('home.viewRoute')} →
        </Link>
      </section>
    )
  }

  const stale = busStatus.mode === 'stale'
  const age = describeAge(busStatus.secondsAgo ?? 0, t)
  const distance = formatDistance(busDistanceM, t)

  return (
    <section className="card-3d relative overflow-hidden flex flex-col gap-3 rounded-3xl p-6" aria-live="polite">
      {/* Top Status Pill */}
      <div className="flex items-center justify-between">
        <span
          className={
            'inline-flex items-center gap-2 rounded-full px-3.5 py-1 text-xs font-extrabold shadow-2xs ' +
            (stale
              ? 'bg-amber-100 text-amber-900 border border-amber-300/80'
              : 'bg-emerald-100 text-emerald-950 border border-emerald-300/80 radar-live')
          }
        >
          <span
            className={
              'h-2.5 w-2.5 rounded-full ' +
              (stale ? 'bg-amber-500' : 'bg-emerald-600')
            }
            aria-hidden="true"
          />
          {stale ? t('home.lastSeen', { age }).toUpperCase() : t('home.live')}
        </span>
        <span className="text-xs font-bold text-slate-500">
          {stale ? t('home.updatedLast', { age }) : t('home.updatedApprox', { age })}
        </span>
      </div>

      {/* Main Distance / Status Heading */}
      <div>
        <p className={'font-black tracking-tight leading-none ' + (stale ? 'text-2xl text-slate-700' : 'text-3xl sm:text-4xl text-slate-950')}>
          {stale ? t('home.lastKnown', { distance }) : t('home.about', { distance })}
        </p>
        <p className="mt-1.5 text-sm font-semibold text-slate-700">
          {t('home.heading', { bus: busLabel, stop: stopLabel })}
        </p>
      </div>

      {stale && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50/90 p-3 text-xs leading-relaxed font-medium text-amber-950" role="alert">
          {t('home.staleWarning')}
        </div>
      )}

      {/* Live Route Tracker Bar for Non-Tech/Elderly Parents */}
      <div className="rounded-2xl bg-slate-50/90 border border-slate-200/80 p-3.5 shadow-inner">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-500">
          <span>Depot</span>
          <span className="text-amber-900 font-extrabold">Your Stop</span>
          <span>School</span>
        </div>
        <div className="relative mt-2.5 mb-1 flex items-center justify-between px-1">
          <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 rounded-full w-2/3 animate-pulse" />
          </div>
          <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-xs text-white shadow-xs font-bold">
            ✓
          </div>
          <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full bg-amber-400 text-base shadow-md border-2 border-white ring-2 ring-amber-400/50 scale-110">
            🚌
          </div>
          <div className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-slate-300 text-xs text-slate-700 shadow-xs font-bold">
            🏫
          </div>
        </div>
        <p className="mt-2 text-center text-xs font-extrabold text-slate-800">
          Next Stop: <span className="text-amber-700">{stopLabel}</span>
        </p>
      </div>

      <Link
        to="/map"
        className={
          'mt-1 flex min-h-13 items-center justify-center rounded-2xl text-center text-sm font-extrabold transition-all ' +
          (stale ? 'btn-3d-subtle text-slate-800' : 'btn-3d-amber text-slate-950')
        }
      >
        {stale ? t('home.viewLast') : t('home.viewBus')} 🗺️
      </Link>
    </section>
  )
}

export default function ParentHome() {
  const { t } = useI18n()
  const { user, profile, signOut, updatePassword } = useAuth()

  // Password change modal state
  const mustChangePassword = Boolean(
    user?.app_metadata?.must_change_password || user?.user_metadata?.must_change_password
  )
  const [showPassModal, setShowPassModal] = useState(false)
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [changingPass, setChangingPass] = useState(false)
  const [passErr, setPassErr] = useState('')
  const [passSuccess, setPassSuccess] = useState(false)

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    setPassErr('')
    setPassSuccess(false)
    if (newPass.length < 8) {
      setPassErr('New password must be at least 8 characters long.')
      return
    }
    if (newPass !== confirmPass) {
      setPassErr('Passwords do not match.')
      return
    }
    setChangingPass(true)
    const res = await updatePassword(newPass)
    setChangingPass(false)
    if (res.success) {
      setPassSuccess(true)
      setNewPass('')
      setConfirmPass('')
      setTimeout(() => {
        setShowPassModal(false)
        setPassSuccess(false)
      }, 1500)
    } else {
      setPassErr(res.error || 'Failed to update password. Please try again.')
    }
  }
  const {
    children,
    selectedChild,
    selectedChildId,
    setSelectedChildId,
    activeTrip,
    busDistanceM,
    busStatus,
    absences,
    loading,
    error,
    reportAbsence,
    cancelAbsence,
  } = useParentData()

  // Absence modal and submission state
  const [showAbsenceModal, setShowAbsenceModal] = useState(false)
  const todayStr = new Date().toISOString().split('T')[0]
  const [absenceDate, setAbsenceDate] = useState(todayStr)
  const [absenceDirection, setAbsenceDirection] = useState('both')
  const [absenceReason, setAbsenceReason] = useState('')
  const [reportingAbsence, setReportingAbsence] = useState(false)
  const [cancellingAbsenceId, setCancellingAbsenceId] = useState(null)
  const [absenceMsg, setAbsenceMsg] = useState(null)
  const [absenceError, setAbsenceError] = useState(null)

  const parentName = profile?.full_name || 'Guardian'

  async function handleReportAbsence(e) {
    e.preventDefault()
    setAbsenceError(null)
    setAbsenceMsg(null)
    setReportingAbsence(true)

    try {
      await reportAbsence({
        tripDate: absenceDate,
        direction: absenceDirection,
        reason: absenceReason,
      })
      setAbsenceMsg('Absence reported successfully. The driver has been notified.')
      setAbsenceReason('')
      setShowAbsenceModal(false)
    } catch (err) {
      setAbsenceError(err.message || 'Failed to submit absence.')
    } finally {
      setReportingAbsence(false)
    }
  }

  async function handleCancelAbsence(absenceId) {
    setAbsenceError(null)
    setAbsenceMsg(null)
    setCancellingAbsenceId(absenceId)

    try {
      await cancelAbsence(absenceId)
      setAbsenceMsg('Absence was successfully cancelled.')
    } catch (err) {
      setAbsenceError(err.message || 'Failed to cancel absence.')
    } finally {
      setCancellingAbsenceId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-amber border-t-transparent" />
          <p className="text-sm font-medium text-muted">Loading parent portal…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col">
      <main className="flex flex-1 flex-col gap-4 p-4 sm:p-5 pb-8">
        {/* Header */}
        <header className="card-3d flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] sm:text-xs text-slate-500 font-bold uppercase tracking-wider">{t('home.greeting')}</p>
            <h1 className="text-lg sm:text-xl font-black text-slate-900 truncate tracking-tight">{parentName}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <LanguageSwitch />
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50/80 px-3 py-1.5 text-xs font-black text-red-600 shadow-2xs hover:bg-red-100 hover:text-red-700 active:scale-95 transition-all"
            >
              <span aria-hidden="true">🚪</span>
              <span>Log Out</span>
            </button>
          </div>
        </header>

        {/* Temporary Password Warning Banner */}
        {mustChangePassword && (
          <div className="card-3d rounded-2xl border-amber-300 bg-amber-50/90 p-3.5 text-xs font-bold text-amber-950 flex items-center justify-between gap-2 shadow-xs">
            <span>⚠️ Signed in with a temporary password</span>
            <button
              type="button"
              onClick={() => { setShowPassModal(true); setPassErr(''); setPassSuccess(false); setNewPass(''); setConfirmPass('') }}
              className="btn-3d-amber rounded-xl px-3 py-1.5 text-xs font-black text-slate-950 whitespace-nowrap"
            >
              Set Password →
            </button>
          </div>
        )}

        {error && (
          <div className="card-3d rounded-2xl border-red-200 bg-red-50/90 p-4 text-xs font-bold text-red-700">
            {error}
          </div>
        )}

        {/* Multi-child selector */}
        {children.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 px-0.5">
            <span className="text-xs font-extrabold text-slate-500 whitespace-nowrap">
              {t('home.childSelector')}:
            </span>
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => setSelectedChildId(child.id)}
                className={
                  'rounded-xl px-3.5 py-1.5 text-xs font-black transition-all whitespace-nowrap ' +
                  (selectedChildId === child.id
                    ? 'btn-3d-amber text-slate-950'
                    : 'btn-3d-subtle text-slate-600')
                }
              >
                {child.fullName}
              </button>
            ))}
          </div>
        )}

        {/* Selected Child Summary Card with 3D depth */}
        {selectedChild ? (
          <section className="card-3d card-3d-interactive flex items-center justify-between gap-3.5 rounded-3xl p-4.5">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-[#1D3557] to-[#0D9488] text-lg font-black text-white shadow-sm border border-[#0D9488]/30">
                {selectedChild.fullName?.charAt(0) || '🎓'}
              </div>
              <div className="min-w-0">
                <p className="text-base font-black text-slate-900 truncate">{selectedChild.fullName}</p>
                <p className="text-xs font-semibold text-slate-500 mt-0.5">
                  {t('home.grade', { n: selectedChild.grade ?? '—' })} · Bus #{selectedChild.busNumber || 1}
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              <span className="inline-block text-[10px] uppercase tracking-wider font-extrabold text-slate-400">
                {t('home.yourStop')}
              </span>
              <p className="text-xs font-black text-slate-800 max-w-[130px] truncate">
                📍 {selectedChild.morningStop?.name || t('home.stop', { n: 1 })}
              </p>
            </div>
          </section>
        ) : (
          <section className="card-3d rounded-3xl p-6 text-center text-sm font-semibold text-slate-500">
            No children registered to this account. Contact your school administrator to link your child.
          </section>
        )}

        {/* Live Trip Status Card */}
        <StatusCard
          busStatus={busStatus}
          busDistanceM={busDistanceM}
          selectedChild={selectedChild}
          activeTrip={activeTrip}
        />

        {/* Quick Actions Grid - Tactile 3D Buttons */}
        <div className="grid grid-cols-2 gap-3">
          {selectedChild?.schoolPhone ? (
            <a
              href={`tel:${selectedChild.schoolPhone}`}
              className="btn-3d-subtle flex min-h-13 items-center justify-center gap-2.5 rounded-2xl p-3 text-center text-xs sm:text-sm font-black text-slate-900"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-emerald-100 text-emerald-800 text-sm shadow-2xs">📞</span>
              <span>{t('home.call')}</span>
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-slate-200/50 bg-white/40 p-3 text-center text-xs sm:text-sm font-bold text-slate-400 opacity-60"
            >
              <span className="text-base">📞</span>
              <span>{t('home.call')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowAbsenceModal(true)}
            className="btn-3d-subtle flex min-h-13 items-center justify-center gap-2.5 rounded-2xl p-3 text-center text-xs sm:text-sm font-black text-slate-900"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-amber-100 text-amber-900 text-sm shadow-2xs">📝</span>
            <span>{t('home.absence.title')}</span>
          </button>
        </div>

        {absenceMsg && (
          <div className="card-3d rounded-2xl border-emerald-300 bg-emerald-50/90 p-3.5 text-xs font-bold text-emerald-900">
            ✓ {absenceMsg}
          </div>
        )}

        {absenceError && (
          <div className="card-3d rounded-2xl border-red-300 bg-red-50/90 p-3.5 text-xs font-bold text-red-700">
            ✕ {absenceError}
          </div>
        )}

        {/* Active Reported Absences (only shown if absences exist) */}
        {absences.length > 0 && (
          <section className="card-3d flex flex-col gap-2.5 rounded-3xl p-4.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-amber-950 flex items-center gap-1.5">
                <span>⚠️</span>
                <span>Reported Absences</span>
              </span>
              <span className="text-[11px] font-bold text-slate-500">
                {absences.length} {absences.length === 1 ? 'record' : 'records'}
              </span>
            </div>

            <div className="flex flex-col gap-2">
              {absences.map((abs) => (
                <div
                  key={abs.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-200/80 bg-white/70 p-3 text-xs shadow-2xs"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-black text-slate-900">
                      {abs.trip_date} · {t(`home.absence.direction.${abs.direction}`) || abs.direction}
                    </span>
                    {abs.reason && (
                      <span className="text-slate-500 italic">&ldquo;{abs.reason}&rdquo;</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={cancellingAbsenceId === abs.id}
                    onClick={() => handleCancelAbsence(abs.id)}
                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 font-bold text-red-600 hover:bg-red-100 disabled:opacity-50 active:scale-95 transition-all"
                  >
                    {cancellingAbsenceId === abs.id ? t('home.absence.cancelling') : t('home.absence.cancel')}
                  </button>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 font-medium">{t('home.absence.driverNotice')}</p>
          </section>
        )}

      </main>

      {/* Report Absence Modal */}
      {showAbsenceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-sm rounded-3xl p-6 shadow-[0_25px_60px_rgba(15,23,42,0.2)] border border-white/90">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900">{t('home.absence.title')}</h3>
              <button
                type="button"
                onClick={() => setShowAbsenceModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs font-semibold text-slate-500">Student: {selectedChild?.fullName}</p>

            <form onSubmit={handleReportAbsence} className="mt-4 flex flex-col gap-3.5">
              <div>
                <label className="text-xs font-extrabold text-slate-700">{t('home.absence.date')}</label>
                <input
                  type="date"
                  required
                  min={todayStr}
                  value={absenceDate}
                  onChange={(e) => setAbsenceDate(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-sm font-medium text-slate-900 shadow-2xs focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-700">{t('home.absence.direction')}</label>
                <select
                  value={absenceDirection}
                  onChange={(e) => setAbsenceDirection(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-sm font-medium text-slate-900 shadow-2xs focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                >
                  <option value="both">{t('home.absence.direction.both')}</option>
                  <option value="morning">{t('home.absence.direction.morning')}</option>
                  <option value="afternoon">{t('home.absence.direction.afternoon')}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-700">{t('home.absence.reason')}</label>
                <input
                  type="text"
                  placeholder={t('home.absence.reasonPlaceholder')}
                  value={absenceReason}
                  onChange={(e) => setAbsenceReason(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-slate-200/90 bg-white/95 p-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 shadow-2xs focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                />
              </div>

              <div className="mt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAbsenceModal(false)}
                  className="btn-3d-subtle rounded-2xl px-4 py-2.5 text-xs font-bold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportingAbsence}
                  className="btn-3d-amber rounded-2xl px-5 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                >
                  {reportingAbsence ? t('home.absence.submitting') : t('home.absence.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPassModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-sm rounded-3xl p-6 shadow-[0_25px_60px_rgba(15,23,42,0.2)] border border-white/90">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🔐</span>
                <h3 className="text-lg font-black text-slate-900">Change Account Password</h3>
              </div>
              <button
                type="button"
                onClick={() => { setShowPassModal(false); setPassErr(''); setPassSuccess(false) }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs font-medium text-slate-500">
              Choose a secure permanent password for your parent portal account.
            </p>

            {passSuccess && (
              <div className="mt-3 rounded-2xl border border-emerald-300 bg-emerald-50/90 p-3 text-xs font-bold text-emerald-900">
                ✓ Password updated successfully!
              </div>
            )}

            {passErr && (
              <div className="mt-3 rounded-2xl border border-red-300 bg-red-50/90 p-3 text-xs font-bold text-red-700">
                ✕ {passErr}
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="mt-4 flex flex-col gap-3">
              <div>
                <label className="text-xs font-extrabold text-slate-700">New Password</label>
                <input
                  type="password"
                  required
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  placeholder="At least 8 characters"
                  className="mt-1 min-h-11 w-full rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-700">Confirm Password</label>
                <input
                  type="password"
                  required
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  placeholder="Repeat new password"
                  className="mt-1 min-h-11 w-full rounded-2xl border border-slate-200/90 bg-white/95 px-3.5 text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-300/30 focus:outline-none"
                />
              </div>

              <div className="mt-2 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => { setShowPassModal(false); setPassErr(''); setPassSuccess(false) }}
                  disabled={changingPass}
                  className="btn-3d-subtle rounded-2xl px-4 py-2 text-xs font-bold text-slate-600"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={changingPass}
                  className="rounded-2xl bg-slate-900 px-5 py-2 text-xs font-black text-white shadow-md hover:bg-slate-800 disabled:opacity-50 active:scale-95 transition-all"
                >
                  {changingPass ? 'Saving…' : 'Save Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ParentNav active="home" />
    </div>
  )
}
