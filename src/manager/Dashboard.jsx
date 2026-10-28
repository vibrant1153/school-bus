import { useState } from 'react'
import Chip from './Chip.jsx'
import { useManagerData } from '../lib/useManagerData.js'

const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

function statusChip(trip) {
  if (trip.status === 'in_progress') return <Chip tone="green">In progress</Chip>
  if (trip.status === 'completed') return <Chip tone="gray">Completed</Chip>
  if (trip.status === 'cancelled') return <Chip tone="red">Cancelled</Chip>
  return <Chip>Scheduled</Chip>
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
    <section className="rounded-2xl border-l-[6px] border-amber bg-white p-5 shadow-xs">
      <h2 className="mb-2 text-lg font-bold text-ink">Location History Retention</h2>
      <p className="text-[14px] leading-relaxed text-ink">
        To protect child safety and student privacy, location history of finished trips before today should be purged regularly. Trips in progress today are protected.
      </p>

      {lastPurgedMsg && (
        <p className="mt-2 rounded-lg bg-emerald-50 p-2.5 text-xs font-semibold text-emerald-800">
          ✓ {lastPurgedMsg}
        </p>
      )}

      {purgeError && (
        <p className="mt-2 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
          ✕ {purgeError}
        </p>
      )}

      {confirming ? (
        <div
          className="mt-3 flex flex-col gap-3 rounded-xl bg-red-50 p-4"
          role="alertdialog"
          aria-label="Confirm deleting location history"
        >
          <p className="text-[14px] font-bold text-red-900">
            Purge location history of finished trips before today?
          </p>
          <p className="text-xs text-red-800 leading-relaxed">
            This cannot be undone. Active trips today are never touched. Aggregated trip summaries are kept for reporting.
          </p>
          <div className="flex gap-2.5">
            <button
              type="button"
              disabled={purging}
              onClick={handlePurgeNow}
              className="rounded-lg bg-danger px-4 py-2 text-xs font-bold text-white hover:opacity-95 disabled:opacity-50"
            >
              {purging ? 'Purging…' : 'Yes, purge now'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-muted hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="mt-3 min-h-11 rounded-xl bg-amber px-4 text-xs font-bold text-ink hover:opacity-95 shadow-xs"
        >
          Purge Past Location History
        </button>
      )}

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Location history older than 3 days is also automatically removed as a safety net. Each deletion action is recorded in the immutable school audit log.
      </p>
    </section>
  )
}

export default function Dashboard() {
  const { todayTrips, metrics, loading, purgeLocationHistory, endTrip } = useManagerData()
  const [endingTripId, setEndingTripId] = useState(null)
  const [actionError, setActionError] = useState(null)
  const [actionSuccess, setActionSuccess] = useState(null)

  async function handleEndTrip(tripId, busLabel) {
    if (!window.confirm(`Are you sure you want to end and complete the trip for ${busLabel}? This will stop live tracking and free the bus for subsequent trips.`)) {
      return
    }
    setEndingTripId(tripId)
    setActionError(null)
    setActionSuccess(null)
    try {
      await endTrip(tripId)
      setActionSuccess(`Trip for ${busLabel} successfully marked as completed.`)
      setTimeout(() => setActionSuccess(null), 5000)
    } catch (err) {
      setActionError(err.message || 'Failed to complete trip.')
    } finally {
      setEndingTripId(null)
    }
  }

  const healthItems = []
  if (metrics.studentsWithoutStops > 0) {
    healthItems.push(`${metrics.studentsWithoutStops} student(s) have no stop assigned`)
  }
  if (metrics.busesWithoutDrivers > 0) {
    healthItems.push(`${metrics.busesWithoutDrivers} bus(es) have no active driver assigned`)
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[28px] font-bold text-ink">Manager Dashboard</h1>
        <p className="text-sm text-muted">{today} · Operational Overview</p>
      </header>

      {/* Metrics Row */}
      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Trips Today</p>
          <p className="mt-2 text-[32px] font-extrabold text-ink">{metrics.totalTrips}</p>
          <p className="mt-1 text-xs text-muted">Morning and afternoon runs</p>
        </div>
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Buses on the Road Now</p>
          <p className="mt-2 text-[32px] font-extrabold text-ink">{metrics.onRoad}</p>
          <p className="mt-1 text-xs text-emerald-600 font-medium">Currently transmitting GPS</p>
        </div>
        <div className={'rounded-2xl border bg-white p-5 shadow-xs ' + (healthItems.length ? 'border-amber-300' : 'border-gray-200')}>
          <p className="text-xs font-semibold text-muted uppercase tracking-wider">Setup Health</p>
          <p className="mt-2 text-[32px] font-extrabold text-ink">{healthItems.length === 0 ? '✓ OK' : healthItems.length}</p>
          <p className="mt-1 text-xs text-muted">{healthItems.length === 0 ? 'All rosters & routes configured' : 'Items require attention'}</p>
        </div>
      </section>

      {/* Action Messages */}
      {actionSuccess && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-xs font-bold text-green-800 shadow-xs flex items-center justify-between">
          <span>✓ {actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-green-800 hover:opacity-75">✕</button>
        </div>
      )}
      {actionError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-bold text-red-800 shadow-xs flex items-center justify-between">
          <span>✕ {actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-red-800 hover:opacity-75">✕</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Today's Trips Table */}
        <section className="overflow-x-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-xs xl:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-ink">Today&apos;s Trips</h2>
            <span className="text-xs text-muted font-medium">{todayTrips.length} total scheduled</span>
          </div>

          {todayTrips.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No trips recorded for today yet.</p>
          ) : (
            <table className="w-full min-w-[550px] text-left text-[14px]">
              <thead className="border-b border-gray-100 text-xs font-semibold text-muted uppercase tracking-wider">
                <tr>
                  <th scope="col" className="pb-3 font-medium">Bus</th>
                  <th scope="col" className="pb-3 font-medium">Route</th>
                  <th scope="col" className="pb-3 font-medium">Driver</th>
                  <th scope="col" className="pb-3 font-medium">Status</th>
                  <th scope="col" className="pb-3 font-medium">Started At</th>
                  <th scope="col" className="pb-3 font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {todayTrips.map((trip) => (
                  <tr key={trip.id} className="hover:bg-gray-50/75">
                    <td className="py-3.5 font-bold text-ink">
                      {trip.buses?.name || `Bus ${trip.buses?.bus_number || '—'}`}
                    </td>
                    <td className="py-3.5 text-ink">
                      {trip.routes?.name || 'Route'} ({trip.direction})
                    </td>
                    <td className="py-3.5 text-muted">
                      {trip.profiles?.full_name || 'Assigned Driver'}
                    </td>
                    <td className="py-3.5">
                      {statusChip(trip)}
                    </td>
                    <td className="py-3.5 text-xs font-mono text-muted">
                      {trip.started_at ? new Date(trip.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td className="py-3.5">
                      {trip.status === 'in_progress' ? (
                        <button
                          type="button"
                          disabled={endingTripId === trip.id}
                          onClick={() => handleEndTrip(trip.id, trip.buses?.name || `Bus ${trip.buses?.bus_number || ''}`)}
                          className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 shadow-xs hover:bg-red-600 hover:text-white transition-all disabled:opacity-50"
                          title="Force end trip if driver forgot to complete it"
                        >
                          <span>🛑</span>
                          <span>{endingTripId === trip.id ? 'Ending…' : 'End Trip'}</span>
                        </button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* Right Column: Location History Purge & Setup Health */}
        <div className="flex flex-col gap-6">
          <LocationHistoryCard onPurge={purgeLocationHistory} />

          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <h2 className="mb-3 text-lg font-bold text-ink">Setup Health Checklist</h2>
            {healthItems.length === 0 ? (
              <p className="text-sm text-emerald-700 font-medium">✓ All students and buses are assigned.</p>
            ) : (
              <ul className="flex flex-col gap-2.5 text-sm text-ink">
                {healthItems.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-xs font-medium text-amber-900 bg-amber-50 rounded-lg p-2.5">
                    <span>⚠️</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
