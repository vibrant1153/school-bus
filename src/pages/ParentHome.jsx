import { useState } from 'react'
import { Link } from 'react-router-dom'
import LanguageSwitch from '../i18n/LanguageSwitch.jsx'
import ParentNav from '../components/ParentNav.jsx'
import { useI18n } from '../i18n/useI18n.js'
import { useAuth } from '../lib/useAuth.js'
import { useParentData } from '../lib/useParentData.js'
import {
  ALERT_PRESETS,
  describeAge,
  formatDistance,
  formatRadius,
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
      <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-5 shadow-xs" aria-live="polite">
        <p className="flex items-center gap-2 text-[13px] font-bold text-muted">
          <span className="h-2.5 w-2.5 rounded-full bg-field" aria-hidden="true" />
          {t('home.none.badge')}
        </p>
        <p className="text-[26px] leading-tight font-extrabold text-ink">{t('home.none.title')}</p>
        <p className="text-[15px] text-muted">{t('home.none.body', { time: plannedTime })}</p>
        <Link
          to="/map"
          className="mt-1.5 flex min-h-13 items-center justify-center rounded-xl border border-field px-3 text-center text-base font-bold text-ink hover:bg-gray-50"
        >
          {t('home.viewRoute')}
        </Link>
      </section>
    )
  }

  const stale = busStatus.mode === 'stale'
  const age = describeAge(busStatus.secondsAgo ?? 0, t)
  const distance = formatDistance(busDistanceM, t)

  return (
    <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-5 shadow-xs" aria-live="polite">
      <p className={'flex items-center gap-2 text-[13px] font-bold ' + (stale ? 'text-muted' : 'text-live')}>
        <span className={'h-2.5 w-2.5 rounded-full ' + (stale ? 'bg-field' : 'bg-live animate-pulse')} aria-hidden="true" />
        {stale ? t('home.lastSeen', { age }).toUpperCase() : t('home.live')}
      </p>
      <p className={'leading-tight font-extrabold ' + (stale ? 'text-[26px] text-muted' : 'text-3xl text-ink')}>
        {stale ? t('home.lastKnown', { distance }) : t('home.about', { distance })}
      </p>
      <p className="text-[15px] text-ink">{t('home.heading', { bus: busLabel, stop: stopLabel })}</p>

      {stale && (
        <p className="rounded-xl bg-[#FFF6E0] p-3 text-sm leading-relaxed text-amber-900" role="alert">
          {t('home.staleWarning')}
        </p>
      )}

      <p className="text-[13px] text-muted">
        {stale ? t('home.updatedLast', { age }) : t('home.updatedApprox', { age })}
      </p>

      <Link
        to="/map"
        className={
          'mt-1.5 flex min-h-13 items-center justify-center rounded-xl px-3 text-center text-base font-bold ' +
          (stale ? 'border border-field text-ink hover:bg-gray-50' : 'bg-amber text-ink hover:opacity-95')
        }
      >
        {stale ? t('home.viewLast') : t('home.viewBus')}
      </Link>
    </section>
  )
}

export default function ParentHome() {
  const { t } = useI18n()
  const { profile, signOut } = useAuth()
  const {
    children,
    selectedChild,
    selectedChildId,
    setSelectedChildId,
    activeTrip,
    busDistanceM,
    busStatus,
    absences,
    alerts,
    loading,
    error,
    reportAbsence,
    cancelAbsence,
    updateAlertRadius,
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
  const alertMeters = selectedChild?.alertRadiusM || 500

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
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-gray-50">
      <main className="flex flex-1 flex-col gap-4 p-5 pb-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs sm:text-sm text-muted font-medium">{t('home.greeting')}</p>
            <h1 className="text-xl sm:text-[22px] font-extrabold text-ink truncate">{parentName}</h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <LanguageSwitch />
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs sm:text-sm font-bold text-red-600 shadow-xs hover:bg-red-100 hover:text-red-700 active:scale-95 transition-all"
            >
              <span aria-hidden="true">🚪</span>
              <span>Log Out</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        {/* Multi-child selector */}
        {children.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            <span className="text-xs font-semibold text-muted whitespace-nowrap">
              {t('home.childSelector')}:
            </span>
            {children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => setSelectedChildId(child.id)}
                className={
                  'rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all whitespace-nowrap ' +
                  (selectedChildId === child.id
                    ? 'bg-amber text-ink shadow-xs'
                    : 'border border-field bg-white text-muted hover:border-gray-400')
                }
              >
                {child.fullName}
              </button>
            ))}
          </div>
        )}

        {/* Selected Child Summary Card */}
        {selectedChild ? (
          <section className="flex items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-xs">
            <div>
              <p className="text-[17px] font-bold text-ink">{selectedChild.fullName}</p>
              <p className="text-sm text-muted">
                {t('home.grade', { n: selectedChild.grade ?? '—' })} · {t('home.bus', { n: selectedChild.busNumber })} · {t('home.trip.morning')}
              </p>
            </div>
            <p className="text-right text-[13px] text-muted">
              {t('home.yourStop')}<br />
              <b className="text-ink">{selectedChild.morningStop?.name || t('home.stop', { n: 1 })}</b>
            </p>
          </section>
        ) : (
          <section className="rounded-2xl bg-white p-5 text-center text-sm text-muted shadow-xs">
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

        {/* Near-Stop Alert Preference (200m / 500m / 1000m) */}
        <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-4 shadow-xs">
          <h2 className="text-[15px] font-bold text-ink">{t('home.alert.title')}</h2>
          <div className="flex gap-2">
            {ALERT_PRESETS.map((preset) => {
              const selected = preset.meters === alertMeters
              return (
                <button
                  key={preset.meters}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => updateAlertRadius(preset.meters)}
                  className={
                    'min-h-12 flex-1 rounded-[10px] text-[15px] transition-colors ' +
                    (selected ? 'bg-ink font-bold text-white shadow-xs' : 'border border-field bg-white text-ink hover:bg-gray-50')
                  }
                >
                  {formatRadius(preset.meters, t)}
                </button>
              )
            })}
          </div>
          <p className="text-[13px] text-muted">{t('home.alert.note')}</p>
        </section>

        {/* Absence Reporting Section */}
        <section className="flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-bold text-ink">{t('home.absence.title')}</h2>
              <p className="text-xs text-muted">{t('home.absence.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={() => setShowAbsenceModal(true)}
              className="rounded-xl bg-amber px-3.5 py-2 text-xs font-bold text-ink hover:opacity-95"
            >
              + {t('home.absence.title')}
            </button>
          </div>

          {absenceMsg && (
            <div className="rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
              {absenceMsg}
            </div>
          )}

          {absenceError && (
            <div className="rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
              {absenceError}
            </div>
          )}

          {/* Active reported absences list */}
          <div className="mt-1 flex flex-col gap-2">
            {absences.length === 0 ? (
              <p className="py-2 text-xs text-muted">{t('home.absence.none')}</p>
            ) : (
              absences.map((abs) => (
                <div
                  key={abs.id}
                  className="flex items-center justify-between rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs"
                >
                  <div className="flex flex-col gap-0.5">
                    <span className="font-bold text-ink">
                      {abs.trip_date} · {abs.direction.toUpperCase()}
                    </span>
                    {abs.reason && (
                      <span className="text-muted italic">&ldquo;{abs.reason}&rdquo;</span>
                    )}
                  </div>
                  <button
                    type="button"
                    disabled={cancellingAbsenceId === abs.id}
                    onClick={() => handleCancelAbsence(abs.id)}
                    className="rounded-lg border border-red-200 px-2.5 py-1 font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {cancellingAbsenceId === abs.id ? t('home.absence.cancelling') : t('home.absence.cancel')}
                  </button>
                </div>
              ))
            )}
          </div>
          <p className="text-[11px] text-muted">{t('home.absence.driverNotice')}</p>
        </section>

        {/* Today's Events Preview */}
        <section className="flex flex-col gap-2.5 rounded-2xl bg-white p-4 shadow-xs">
          <h2 className="text-[15px] font-bold text-ink">{t('home.today')}</h2>
          {alerts.length > 0 ? (
            alerts.slice(0, 3).map((item) => (
              <div key={item.id} className="flex justify-between gap-3 text-sm">
                <span className="text-ink">
                  {item.event_type === 'nearStop'
                    ? `Bus about ${item.radius_meters || 500}m from your stop`
                    : item.event_type === 'tripStarted'
                    ? 'Trip started'
                    : item.event_type}
                </span>
                <span className="shrink-0 text-muted">
                  {item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                </span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted">No trip events recorded yet today.</p>
          )}
        </section>

        {/* Call School Office Button */}
        {selectedChild?.schoolPhone ? (
          <a
            href={`tel:${selectedChild.schoolPhone}`}
            className="flex min-h-12 items-center justify-center rounded-xl border border-field bg-white px-3 text-[15px] font-bold text-ink shadow-xs hover:bg-gray-50"
          >
            📞 {t('home.call')} ({selectedChild.schoolPhone})
          </a>
        ) : (
          <button
            type="button"
            disabled
            className="min-h-12 rounded-xl border border-field bg-white px-3 text-[15px] font-semibold text-muted opacity-60"
          >
            {t('home.call')}
          </button>
        )}
      </main>

      {/* Report Absence Modal */}
      {showAbsenceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">{t('home.absence.title')}</h3>
              <button
                type="button"
                onClick={() => setShowAbsenceModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">{selectedChild?.fullName}</p>

            <form onSubmit={handleReportAbsence} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">{t('home.absence.date')}</label>
                <input
                  type="date"
                  required
                  min={todayStr}
                  value={absenceDate}
                  onChange={(e) => setAbsenceDate(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">{t('home.absence.direction')}</label>
                <select
                  value={absenceDirection}
                  onChange={(e) => setAbsenceDirection(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field bg-white p-2.5 text-sm"
                >
                  <option value="both">{t('home.absence.direction.both')}</option>
                  <option value="morning">{t('home.absence.direction.morning')}</option>
                  <option value="afternoon">{t('home.absence.direction.afternoon')}</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">{t('home.absence.reason')}</label>
                <input
                  type="text"
                  placeholder={t('home.absence.reasonPlaceholder')}
                  value={absenceReason}
                  onChange={(e) => setAbsenceReason(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm"
                />
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAbsenceModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={reportingAbsence}
                  className="rounded-xl bg-amber px-5 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
                >
                  {reportingAbsence ? t('home.absence.submitting') : t('home.absence.submit')}
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
