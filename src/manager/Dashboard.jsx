import { useState } from 'react'
import { Link } from 'react-router-dom'
import Chip from './Chip.jsx'
import { useManagerData } from '../lib/useManagerData.js'

const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

function statusChip(trip) {
  if (trip.status === 'in_progress') return <Chip tone="green">● In Transit</Chip>
  if (trip.status === 'completed') return <Chip tone="grey">Completed</Chip>
  if (trip.status === 'cancelled') return <Chip tone="red">Cancelled</Chip>
  return <Chip tone="amber">Scheduled</Chip>
}

export default function Dashboard() {
  const { todayTrips, metrics, loading, endTrip } = useManagerData()
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
    healthItems.push({
      text: `${metrics.studentsWithoutStops} student(s) have no stop assigned`,
      link: '/manager/students',
      action: 'Assign Stops',
    })
  }
  if (metrics.busesWithoutDrivers > 0) {
    healthItems.push({
      text: `${metrics.busesWithoutDrivers} bus(es) have no active driver assigned`,
      link: '/manager/buses',
      action: 'Pair Drivers',
    })
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0D9488] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#E2E8F0] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033]">Operations Dashboard</h1>
          <p className="text-xs text-[#64748B] mt-0.5">{today} · Real-time School Transit Monitoring</p>
        </div>
      </div>

      {/* Operational Metrics Row */}
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs">
          <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Scheduled Trips</p>
          <p className="mt-1.5 text-2xl font-black text-[#172033]">{metrics.totalTrips}</p>
          <p className="mt-0.5 text-[11px] text-[#64748B]">Morning &amp; afternoon runs</p>
        </div>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Buses on Route Now</p>
            {metrics.onRoad > 0 && (
              <span className="flex h-2 w-2 rounded-full bg-[#0D9488] animate-ping" />
            )}
          </div>
          <p className="mt-1.5 text-2xl font-black text-[#0D9488]">{metrics.onRoad}</p>
          <p className="mt-0.5 text-[11px] text-[#64748B]">Active GPS location broadcasting</p>
        </div>

        <div className={'rounded-xl border bg-white p-4 shadow-2xs ' + (healthItems.length ? 'border-amber-200' : 'border-[#E2E8F0]')}>
          <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Operational Health</p>
          <p className="mt-1.5 text-2xl font-black text-[#172033]">
            {healthItems.length === 0 ? '✓ Ready' : `${healthItems.length} Issues`}
          </p>
          <p className="mt-0.5 text-[11px] text-[#64748B]">
            {healthItems.length === 0 ? 'All rosters and vehicles fully paired' : 'Items require assignment'}
          </p>
        </div>
      </section>

      {/* Alerts */}
      {actionSuccess && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-800 shadow-2xs flex items-center justify-between">
          <span>✓ {actionSuccess}</span>
          <button type="button" onClick={() => setActionSuccess(null)} className="text-emerald-800 hover:opacity-75">✕</button>
        </div>
      )}
      {actionError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-800 shadow-2xs flex items-center justify-between">
          <span>✕ {actionError}</span>
          <button type="button" onClick={() => setActionError(null)} className="text-red-800 hover:opacity-75">✕</button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3 items-start">
        {/* Today's Trips Table */}
        <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-2xs xl:col-span-2">
          <div className="flex items-center justify-between border-b border-[#E2E8F0] px-4 py-3 bg-[#F8FAFC]">
            <h2 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">Today&apos;s Transit Trips</h2>
            <span className="text-[11px] text-[#64748B] font-semibold">{todayTrips.length} scheduled</span>
          </div>

          {todayTrips.length === 0 ? (
            <p className="py-12 text-center text-xs text-[#64748B]">No transit trips logged for today yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#E2E8F0] bg-white text-[#64748B]">
                    <th scope="col" className="py-2.5 px-4 font-bold text-[11px] uppercase tracking-wider">Bus</th>
                    <th scope="col" className="py-2.5 px-4 font-bold text-[11px] uppercase tracking-wider">Route</th>
                    <th scope="col" className="py-2.5 px-4 font-bold text-[11px] uppercase tracking-wider">Driver</th>
                    <th scope="col" className="py-2.5 px-4 font-bold text-[11px] uppercase tracking-wider">Status</th>
                    <th scope="col" className="py-2.5 px-4 font-bold text-[11px] uppercase tracking-wider">Departure</th>
                    <th scope="col" className="py-2.5 px-4 text-right font-bold text-[11px] uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E8F0]">
                  {todayTrips.map((trip) => (
                    <tr key={trip.id} className="hover:bg-[#F8FAFC]/80 transition-colors">
                      <td className="py-3 px-4 font-bold text-[#172033]">
                        {trip.buses?.name || `Bus ${trip.buses?.bus_number || '—'}`}
                      </td>
                      <td className="py-3 px-4 text-[#172033]">
                        {trip.routes?.name || 'Route'} <span className="text-[#64748B]">({trip.direction})</span>
                      </td>
                      <td className="py-3 px-4 text-[#64748B]">
                        {trip.profiles?.full_name || 'Assigned Driver'}
                      </td>
                      <td className="py-3 px-4">
                        {statusChip(trip)}
                      </td>
                      <td className="py-3 px-4 text-[11px] font-mono text-[#64748B]">
                        {trip.started_at ? new Date(trip.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                      <td className="py-3 px-4 text-right">
                        {trip.status === 'in_progress' ? (
                          <button
                            type="button"
                            disabled={endingTripId === trip.id}
                            onClick={() => handleEndTrip(trip.id, trip.buses?.name || `Bus ${trip.buses?.bus_number || ''}`)}
                            className="inline-flex items-center gap-1 rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#DC2626] hover:bg-red-50 transition-colors disabled:opacity-50"
                            title="Force complete trip"
                          >
                            <span>End Trip</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-[#CBD5E1]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Right Column: Setup Readiness Checklist */}
        <section className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs">
          <h2 className="text-xs font-bold uppercase tracking-wider text-[#64748B] border-b border-[#E2E8F0] pb-2.5">
            Operational Readiness
          </h2>

          {healthItems.length === 0 ? (
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 border border-emerald-200">
              <span>✓ All students and fleet vehicles are fully paired.</span>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2.5">
              {healthItems.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs">
                  <div className="flex items-center gap-1.5 text-amber-900 font-medium">
                    <span>⚠️</span>
                    <span>{item.text}</span>
                  </div>
                  <Link
                    to={item.link}
                    className="rounded bg-white px-2 py-0.5 text-[11px] font-bold text-amber-900 border border-amber-300 hover:bg-amber-100 transition-colors shrink-0"
                  >
                    {item.action} →
                  </Link>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
