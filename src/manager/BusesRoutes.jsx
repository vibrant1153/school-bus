import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'

export default function BusesRoutes() {
  const { buses, routes, loading, addBus, initializeDefaultRoutesAndBuses } = useManagerData()

  const [selectedBusId, setSelectedBusId] = useState(null)
  const [direction, setDirection] = useState('Morning')

  // Add Bus Modal State
  const [showAddModal, setShowAddModal] = useState(false)
  const [busNumber, setBusNumber] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [capacity, setCapacity] = useState('32')
  const [adding, setAdding] = useState(false)
  const [modalError, setModalError] = useState(null)

  // Route Initialization State
  const [initializing, setInitializing] = useState(false)
  const [initMsg, setInitMsg] = useState(null)

  const activeBus = buses.find((b) => b.id === selectedBusId) || buses[0] || null
  const activeRoute = routes.find((r) => r.id === activeBus?.routeId) || routes[0] || null

  const stops = activeRoute?.stops
    ? direction === 'Morning'
      ? activeRoute.stops
      : [...activeRoute.stops].reverse()
    : []

  async function handleAddBus(e) {
    e.preventDefault()
    setModalError(null)
    setAdding(true)

    try {
      await addBus({
        busNumber,
        plateNumber,
        capacity,
      })
      setBusNumber('')
      setPlateNumber('')
      setShowAddModal(false)
    } catch (err) {
      setModalError(err.message || 'Failed to add bus.')
    } finally {
      setAdding(false)
    }
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
      {initMsg && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800">
          ✓ {initMsg}
        </div>
      )}

      {routes.length === 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-200 text-xl shrink-0">
              🗺️
            </span>
            <div>
              <h3 className="text-sm font-bold text-amber-950">New School Route Setup</h3>
              <p className="text-xs text-amber-900 mt-0.5">
                This school has no routes or stops yet. Initialize standard school bus routes and stops with 1 click to start assigning students and running trips.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={initializing}
            onClick={async () => {
              setInitializing(true)
              try {
                await initializeDefaultRoutesAndBuses()
                setInitMsg('Standard routes, stops, and fleet created successfully!')
              } catch (err) {
                alert(err.message || 'Failed to initialize routes.')
              } finally {
                setInitializing(false)
              }
            }}
            className="rounded-xl bg-ink px-4 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition-all"
          >
            {initializing ? 'Setting up routes…' : '⚡ Initialize Standard Routes & Stops'}
          </button>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-ink">Buses &amp; Routes</h1>
          <p className="text-sm text-muted">
            Fleet configuration, driver assignments, and route stop sequences.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="rounded-xl bg-amber px-4 py-2.5 text-sm font-bold text-ink hover:opacity-95 shadow-xs"
        >
          + Add Bus
        </button>
      </header>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        {/* Buses List */}
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
            Active Fleet ({buses.length})
          </h2>
          {buses.length === 0 ? (
            <p className="rounded-xl bg-white p-5 text-sm text-muted">No buses registered yet.</p>
          ) : (
            buses.map((b) => (
              <button
                key={b.id}
                type="button"
                aria-pressed={(activeBus?.id || '') === b.id}
                onClick={() => setSelectedBusId(b.id)}
                className={
                  'w-full rounded-2xl bg-white p-4.5 text-left transition-all shadow-xs ' +
                  (activeBus?.id === b.id
                    ? 'border-2 border-amber ring-2 ring-amber/20'
                    : 'border border-gray-200 hover:border-gray-300')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-[17px] font-bold text-ink">Bus {b.busNumber}</span>
                  <span className="font-mono text-xs font-semibold text-muted">
                    {b.plateNumber}
                  </span>
                </div>
                <div className="mt-1.5 text-xs text-muted">
                  {b.driverName ? (
                    <span className="text-emerald-700 font-medium">Driver: {b.driverName}</span>
                  ) : (
                    <span className="text-red-700 font-bold">⚠️ No driver assigned</span>
                  )}
                  <div className="mt-0.5 text-ink">Route: {b.routeName}</div>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Route & Stops Detail */}
        {activeRoute ? (
          <section className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
              <div>
                <h2 className="text-xl font-bold text-ink">{activeRoute.name}</h2>
                <p className="text-xs text-muted font-mono">Code: {activeRoute.code || '—'}</p>
              </div>
              <div className="flex gap-2">
                {['Morning', 'Afternoon'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={direction === d}
                    onClick={() => setDirection(d)}
                    className={
                      'min-h-10 rounded-xl px-4 text-xs font-bold transition-colors ' +
                      (direction === d
                        ? 'bg-ink text-white shadow-xs'
                        : 'border border-field bg-white text-muted hover:bg-gray-50')
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-xs text-muted">
              {direction === 'Morning'
                ? 'Stops in pickup sequence towards school.'
                : 'Stops in reverse dropoff sequence from school.'}
            </p>

            <ol className="flex flex-col gap-2.5">
              {stops.length === 0 ? (
                <li className="py-4 text-center text-xs text-muted">No stops defined on this route.</li>
              ) : (
                stops.map((stop, index) => (
                  <li
                    key={stop.id}
                    className="flex items-center gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber text-xs font-bold text-ink">
                      {index + 1}
                    </span>
                    <span className="flex-1 font-semibold text-ink">{stop.name}</span>
                    <span className="font-mono text-xs text-muted">
                      {direction === 'Morning'
                        ? stop.morning_pickup_time || '—'
                        : stop.afternoon_dropoff_time || '—'}
                    </span>
                  </li>
                ))
              )}
            </ol>
          </section>
        ) : (
          <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-muted">
            Select a bus to inspect its assigned route and stop schedule.
          </section>
        )}
      </div>

      {/* Add Bus Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Add New Bus</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAddBus} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">Bus Number</label>
                <input
                  type="number"
                  required
                  placeholder="e.g. 5"
                  value={busNumber}
                  onChange={(e) => setBusNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">License Plate Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 3-A12345"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm uppercase text-ink"
                />
                <p className="mt-1 text-[11px] text-muted">
                  License plates are stored securely in <code>bus_plates</code> (separated from public/driver views).
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Seating Capacity</label>
                <input
                  type="number"
                  placeholder="e.g. 30"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="rounded-xl bg-amber px-5 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
                >
                  {adding ? 'Saving…' : 'Add Bus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}