import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'
import { ETHIOPIA_LANDMARKS, QUICK_CHIP_LANDMARKS, lookupEthiopiaLocation } from '../lib/ethiopiaLandmarks.js'
import StopMapPicker from '../components/StopMapPicker.jsx'

export default function BusesRoutes() {
  const {
    buses,
    routes,
    drivers,
    loading,
    addBus,
    addRoute,
    addStopToRoute,
    assignBusToRouteAndDriver,
    provisionDriver,
    initializeDefaultRoutesAndBuses,
  } = useManagerData()

  const [selectedBusId, setSelectedBusId] = useState(null)
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [direction, setDirection] = useState('Morning')

  // Add Bus Modal State
  const [showAddBusModal, setShowAddBusModal] = useState(false)
  const [busNumber, setBusNumber] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [capacity, setCapacity] = useState('32')
  const [addingBus, setAddingBus] = useState(false)
  const [busError, setBusError] = useState(null)

  // Add Route Modal State
  const [showAddRouteModal, setShowAddRouteModal] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [routeCode, setRouteCode] = useState('')
  const [routeStartTime, setRouteStartTime] = useState('06:45')
  const [addingRoute, setAddingRoute] = useState(false)
  const [routeError, setRouteError] = useState(null)

  // Add Stop Modal State (Ethiopia Landmark-First)
  const [showAddStopModal, setShowAddStopModal] = useState(false)
  const [stopName, setStopName] = useState('')
  const [stopSequence, setStopSequence] = useState('')
  const [stopLat, setStopLat] = useState('9.0250')
  const [stopLng, setStopLng] = useState('38.7650')
  const [stopIsSchool, setStopIsSchool] = useState(false)
  const [addingStop, setAddingStop] = useState(false)
  const [stopError, setStopError] = useState(null)
  const [selectedPreset, setSelectedPreset] = useState('')
  const [showManualCoords, setShowManualCoords] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMsg, setGeocodeMsg] = useState(null)

  // Assign Bus Modal State
  const [assigningBus, setAssigningBus] = useState(null) // bus object being assigned
  const [assignRouteId, setAssignRouteId] = useState('')
  const [assignDriverId, setAssignDriverId] = useState('')
  const [savingAssignment, setSavingAssignment] = useState(false)
  const [assignError, setAssignError] = useState(null)

  // Driver Provisioning Modal State
  const [showDriverModal, setShowDriverModal] = useState(false)
  const [driverName, setDriverName] = useState('')
  const [driverPhone, setDriverPhone] = useState('')
  const [driverEmail, setDriverEmail] = useState('')
  const [driverPassword, setDriverPassword] = useState('Driver2026!')
  const [provisioningDriver, setProvisioningDriver] = useState(false)
  const [driverError, setDriverError] = useState(null)
  const [createdDriverCreds, setCreatedDriverCreds] = useState(null)
  const [copiedCreds, setCopiedCreds] = useState(false)

  // Route Initialization State
  const [initializing, setInitializing] = useState(false)
  const [initMsg, setInitMsg] = useState(null)

  // Active Selections
  const activeBus = buses.find((b) => b.id === selectedBusId) || buses[0] || null
  const currentRoute =
    routes.find((r) => r.id === (selectedRouteId || activeBus?.routeId)) ||
    routes[0] ||
    null

  const stops = currentRoute?.stops
    ? direction === 'Morning'
      ? currentRoute.stops
      : [...currentRoute.stops].reverse()
    : []

  // Handle Add Bus
  async function handleAddBus(e) {
    e.preventDefault()
    setBusError(null)
    setAddingBus(true)

    try {
      await addBus({
        busNumber,
        plateNumber,
        capacity,
      })
      setBusNumber('')
      setPlateNumber('')
      setShowAddBusModal(false)
      setInitMsg('Bus added to fleet successfully!')
    } catch (err) {
      setBusError(err.message || 'Failed to add bus.')
    } finally {
      setAddingBus(false)
    }
  }

  // Handle Add Route
  async function handleAddRoute(e) {
    e.preventDefault()
    setRouteError(null)
    setAddingRoute(true)

    try {
      const res = await addRoute({
        name: routeName,
        code: routeCode,
        startTime: routeStartTime,
      })
      setRouteName('')
      setRouteCode('')
      setShowAddRouteModal(false)
      if (res?.route?.id) {
        setSelectedRouteId(res.route.id)
      }
      setInitMsg('New route created successfully!')
    } catch (err) {
      setRouteError(err.message || 'Failed to create route.')
    } finally {
      setAddingRoute(false)
    }
  }

  // Open Add Stop Modal with clean Ethiopian defaults
  function openAddStopModal() {
    setStopName('')
    setStopSequence((currentRoute?.stops?.length || 0) + 1)
    setStopLat('9.0250')
    setStopLng('38.7650')
    setStopIsSchool(false)
    setSelectedPreset('')
    setShowManualCoords(false)
    setGeocodeMsg(null)
    setStopError(null)
    setShowAddStopModal(true)
  }

  // Handle Preset Selection (1-Click)
  function handleSelectPreset(presetName) {
    const found = ETHIOPIA_LANDMARKS.find((l) => l.name === presetName)
    if (found) {
      setSelectedPreset(found.name)
      setStopName(found.name)
      setStopLat(found.lat.toString())
      setStopLng(found.lng.toString())
      setGeocodeMsg(`✓ Location locked to ${found.name} (${found.area})`)
    }
  }

  // Handle Auto-Detect from typed place name
  async function handleAutoFindLocation() {
    if (!stopName?.trim()) return
    setGeocoding(true)
    setGeocodeMsg(null)
    try {
      const res = await lookupEthiopiaLocation(stopName)
      if (res) {
        setStopLat(res.lat.toString())
        setStopLng(res.lng.toString())
        setGeocodeMsg(`✓ Location detected (${res.name || stopName})`)
      } else {
        setGeocodeMsg('ℹ️ Saved with central Addis Ababa pin. You can tap on map to adjust.')
      }
    } catch {
      setGeocodeMsg('ℹ️ Default Addis Ababa coordinates applied.')
    } finally {
      setGeocoding(false)
    }
  }

  // Handle Map Pin Click
  function handleMapLocationSelect(newLat, newLng) {
    setStopLat(newLat.toString())
    setStopLng(newLng.toString())
    setGeocodeMsg(`✓ Pin adjusted from map (${newLat.toFixed(4)}, ${newLng.toFixed(4)})`)
  }

  // Handle Add Stop
  async function handleAddStop(e) {
    e.preventDefault()
    if (!currentRoute?.id) return
    setStopError(null)
    setAddingStop(true)

    try {
      await addStopToRoute({
        routeId: currentRoute.id,
        name: stopName,
        sequenceMorning: stopSequence ? Number(stopSequence) : (currentRoute.stops?.length || 0) + 1,
        lat: Number(stopLat) || 9.025,
        lng: Number(stopLng) || 38.765,
        isSchool: stopIsSchool,
      })
      setStopName('')
      setStopSequence('')
      setShowAddStopModal(false)
      setInitMsg(`Stop added to "${currentRoute.name}"!`)
    } catch (err) {
      setStopError(err.message || 'Failed to add stop.')
    } finally {
      setAddingStop(false)
    }
  }

  // Open Assign Modal for a Bus
  function openAssignModal(bus) {
    setAssigningBus(bus)
    setAssignRouteId(bus.routeId || routes[0]?.id || '')
    setAssignDriverId(bus.driverProfileId || '')
    setAssignError(null)
  }

  // Handle Save Assignment
  async function handleSaveAssignment(e) {
    e.preventDefault()
    if (!assigningBus?.id) return
    if (!assignRouteId) {
      setAssignError('Please select a route for this bus.')
      return
    }

    setSavingAssignment(true)
    setAssignError(null)

    try {
      await assignBusToRouteAndDriver({
        busId: assigningBus.id,
        routeId: assignRouteId,
        driverProfileId: assignDriverId || null,
      })
      setAssigningBus(null)
      setInitMsg(`Bus ${assigningBus.busNumber} linked to route and driver successfully!`)
    } catch (err) {
      setAssignError(err.message || 'Failed to assign route/driver.')
    } finally {
      setSavingAssignment(false)
    }
  }

  // Handle Provision Driver
  async function handleProvisionDriver(e) {
    e.preventDefault()
    setDriverError(null)
    setProvisioningDriver(true)

    try {
      const res = await provisionDriver({
        fullName: driverName,
        phone: driverPhone,
        email: driverEmail,
        tempPassword: driverPassword,
      })

      setCreatedDriverCreds({
        name: driverName,
        phone: res.phone || driverPhone,
        email: res.email || driverEmail,
        password: res.temp_password || driverPassword,
      })

      // Auto-select this newly created driver if assignment modal is open
      if (res.user_id) {
        setAssignDriverId(res.user_id)
      }

      setDriverName('')
      setDriverPhone('')
      setDriverEmail('')
      setShowDriverModal(false)
    } catch (err) {
      setDriverError(err.message || 'Failed to create driver account.')
    } finally {
      setProvisioningDriver(false)
    }
  }

  function handleCopyCreds() {
    if (!createdDriverCreds) return
    const text = `SchoolBus Connect Driver Login\nSchool: ${createdDriverCreds.name}\nLogin: ${createdDriverCreds.email || createdDriverCreds.phone}\nPassword: ${createdDriverCreds.password}\nPortal: ${window.location.origin}/login`
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(text)
      setCopiedCreds(true)
      setTimeout(() => setCopiedCreds(false), 2500)
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
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-xs font-semibold text-emerald-800 flex items-center justify-between">
          <span>✓ {initMsg}</span>
          <button
            type="button"
            onClick={() => setInitMsg(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold ml-2"
          >
            ✕
          </button>
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

      {/* Main Header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-ink">Buses &amp; Routes</h1>
          <p className="text-sm text-muted">
            Fleet configuration, bus-to-route linking, driver assignments, and stop sequences.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              🚌 {buses.length} {buses.length === 1 ? 'Bus' : 'Buses'}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              🛣️ {routes.length} {routes.length === 1 ? 'Route' : 'Routes'}
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
              👤 {drivers.length} Registered {drivers.length === 1 ? 'Driver' : 'Drivers'}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowDriverModal(true)}
            className="rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-xs font-bold text-ink hover:bg-gray-50 shadow-xs"
          >
            + Provision Driver
          </button>
          <button
            type="button"
            onClick={() => setShowAddRouteModal(true)}
            className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-xs font-bold text-ink hover:bg-gray-50 shadow-xs"
          >
            + Add Route
          </button>
          <button
            type="button"
            onClick={() => setShowAddBusModal(true)}
            className="rounded-xl bg-amber px-4 py-2.5 text-xs font-bold text-ink hover:opacity-95 shadow-xs"
          >
            + Add Bus
          </button>
        </div>
      </header>

      {/* Layout Grid */}
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* Buses Fleet Column */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-muted uppercase tracking-wider">
              Fleet &amp; Assignments ({buses.length})
            </h2>
            <button
              type="button"
              onClick={() => setShowAddBusModal(true)}
              className="text-xs font-bold text-amber-700 hover:text-amber-800"
            >
              + New Bus
            </button>
          </div>

          {buses.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-center">
              <p className="text-sm font-semibold text-ink">No buses in fleet yet</p>
              <p className="mt-1 text-xs text-muted">Add your school buses or initialize standard fleet.</p>
              <button
                type="button"
                onClick={() => setShowAddBusModal(true)}
                className="mt-3 rounded-xl bg-ink px-3.5 py-2 text-xs font-bold text-white shadow-xs"
              >
                + Add Bus
              </button>
            </div>
          ) : (
            buses.map((b) => (
              <div
                key={b.id}
                onClick={() => {
                  setSelectedBusId(b.id)
                  if (b.routeId) setSelectedRouteId(b.routeId)
                }}
                className={
                  'w-full cursor-pointer rounded-2xl bg-white p-4.5 text-left transition-all shadow-xs ' +
                  (activeBus?.id === b.id
                    ? 'border-2 border-amber ring-2 ring-amber/20'
                    : 'border border-gray-200 hover:border-gray-300')
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-sm font-bold text-amber-900">
                      🚌
                    </span>
                    <span className="text-[17px] font-bold text-ink">Bus {b.busNumber}</span>
                  </div>
                  <span className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-xs font-bold text-slate-700">
                    {b.plateNumber}
                  </span>
                </div>

                <div className="mt-3 space-y-1 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-muted">Route:</span>
                    {b.routeId ? (
                      <span className="font-bold text-ink">{b.routeName}</span>
                    ) : (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-900">
                        ⚠️ No route linked
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-muted">Driver:</span>
                    {b.driverName ? (
                      <span className="font-semibold text-emerald-700">
                        {b.driverName} {b.driverPhone ? `(${b.driverPhone})` : ''}
                      </span>
                    ) : (
                      <span className="rounded bg-rose-100 px-1.5 py-0.5 font-semibold text-rose-800">
                        ⚠️ No driver assigned
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3.5 flex items-center justify-between border-t border-gray-100 pt-2.5">
                  <span className="text-[11px] font-medium text-muted">
                    {b.capacity || 30} passenger capacity
                  </span>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      openAssignModal(b)
                    }}
                    className="rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800 transition-colors"
                  >
                    🔗 Link Route &amp; Driver
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Route Details & Stop Sequence Column */}
        <div className="flex flex-col gap-4">
          {/* Route Switcher / Header Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white p-3 shadow-xs">
            <div className="flex items-center gap-1.5 overflow-x-auto py-1">
              <span className="px-2 text-xs font-bold uppercase tracking-wider text-muted">
                Routes:
              </span>
              {routes.length === 0 ? (
                <span className="text-xs text-muted">No routes registered yet.</span>
              ) : (
                routes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRouteId(r.id)}
                    className={
                      'whitespace-nowrap rounded-xl px-3.5 py-1.5 text-xs font-bold transition-all ' +
                      (currentRoute?.id === r.id
                        ? 'bg-ink text-white shadow-xs'
                        : 'bg-gray-100 text-ink hover:bg-gray-200')
                    }
                  >
                    {r.name}
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              onClick={() => setShowAddRouteModal(true)}
              className="rounded-xl border border-dashed border-ink/40 bg-ink/5 px-3 py-1.5 text-xs font-bold text-ink hover:bg-ink/10 transition-colors shrink-0"
            >
              + Add Route
            </button>
          </div>

          {currentRoute ? (
            <section className="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-xs">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-xl font-bold text-ink">{currentRoute.name}</h2>
                    {currentRoute.code && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 font-mono text-xs font-bold text-amber-900">
                        {currentRoute.code}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted">
                    Start Time: <span className="font-semibold text-ink">{currentRoute.start_time || '06:45:00'}</span> · {currentRoute.stops?.length || 0} stops defined
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex gap-1 rounded-xl border border-field p-1">
                    {['Morning', 'Afternoon'].map((d) => (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={direction === d}
                        onClick={() => setDirection(d)}
                        className={
                          'rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ' +
                          (direction === d
                            ? 'bg-ink text-white shadow-xs'
                            : 'bg-transparent text-muted hover:text-ink')
                        }
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={openAddStopModal}
                    className="rounded-xl bg-amber px-3.5 py-2 text-xs font-bold text-ink hover:opacity-95 shadow-xs"
                  >
                    + Add Stop
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs text-muted">
                <span>
                  {direction === 'Morning'
                    ? '📍 Sequence: Morning Pickup towards School'
                    : '📍 Sequence: Afternoon Dropoff from School (Reversed)'}
                </span>
                <span className="text-[11px] text-muted">
                  Auto-alert geofence: <strong className="text-ink">500m radius</strong>
                </span>
              </div>

              <ol className="flex flex-col gap-2.5">
                {stops.length === 0 ? (
                  <li className="rounded-xl border border-dashed border-gray-200 py-8 text-center">
                    <p className="text-sm font-semibold text-ink">No stops defined on this route yet.</p>
                    <p className="mt-1 text-xs text-muted">Add landmark cluster stops for student pickups and dropoffs.</p>
                    <button
                      type="button"
                      onClick={openAddStopModal}
                      className="mt-3 rounded-xl bg-ink px-3.5 py-1.5 text-xs font-bold text-white shadow-xs"
                    >
                      + Add First Stop
                    </button>
                  </li>
                ) : (
                  stops.map((stop, index) => (
                    <li
                      key={stop.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 text-sm transition-colors hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber text-xs font-bold text-ink shrink-0">
                          {index + 1}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-ink">{stop.name}</span>
                            {stop.is_school && (
                              <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900">
                                🏫 School Campus
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
                            <span className="font-mono">
                              📍 Lat: {stop.lat?.toFixed(4)}, Lng: {stop.lng?.toFixed(4)}
                            </span>
                            <span>•</span>
                            <span className="text-emerald-700 font-medium">500m Geofenced</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <span className="font-mono text-xs font-semibold text-slate-700">
                          {direction === 'Morning' ? 'Pickup Stop' : 'Dropoff Stop'}
                        </span>
                      </div>
                    </li>
                  ))
                )}
              </ol>
            </section>
          ) : (
            <section className="rounded-2xl border border-gray-200 bg-white p-8 text-center text-sm text-muted">
              Select or add a route to view and configure its stops.
            </section>
          )}
        </div>
      </div>

      {/* Modal 1: Add Bus */}
      {showAddBusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Add New Bus</h3>
              <button
                type="button"
                onClick={() => setShowAddBusModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {busError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {busError}
              </div>
            )}

            <form onSubmit={handleAddBus} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">Bus Number</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 2 or Bus 2"
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
                  placeholder="e.g. 3-ET-2002"
                  value={plateNumber}
                  onChange={(e) => setPlateNumber(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm uppercase text-ink"
                />
                <p className="mt-1 text-[11px] text-muted">
                  Stored securely in <code>bus_plates</code> table per Ministry of Transport guidelines.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Passenger Seating Capacity</label>
                <input
                  type="number"
                  placeholder="e.g. 32"
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddBusModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingBus}
                  className="rounded-xl bg-amber px-5 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
                >
                  {addingBus ? 'Saving…' : 'Add Bus'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 2: Add Route */}
      {showAddRouteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Add New Bus Route</h3>
              <button
                type="button"
                onClick={() => setShowAddRouteModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {routeError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {routeError}
              </div>
            )}

            <form onSubmit={handleAddRoute} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">Route Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Route 3 - Old Airport & Sarbet Line"
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
                <p className="mt-1 text-[11px] text-muted">
                  Tip: Include the general neighborhood names so parents and drivers easily recognize it.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink">Route Code</label>
                  <input
                    type="text"
                    placeholder="e.g. RT-03"
                    value={routeCode}
                    onChange={(e) => setRouteCode(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm uppercase text-ink"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-ink">Morning Departure Time</label>
                  <input
                    type="time"
                    required
                    value={routeStartTime}
                    onChange={(e) => setRouteStartTime(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                  />
                </div>
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddRouteModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingRoute}
                  className="rounded-xl bg-amber px-5 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
                >
                  {addingRoute ? 'Creating…' : 'Create Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 3: Add Stop to Route (Ethiopian Landmark-First & Map-Guided) */}
      {showAddStopModal && currentRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h3 className="text-lg font-bold text-ink">Add Stop to Route</h3>
                <p className="text-xs text-muted">Route: {currentRoute.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStopModal(false)}
                className="text-gray-400 hover:text-gray-600 font-bold p-1"
              >
                ✕
              </button>
            </div>

            {stopError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {stopError}
              </div>
            )}

            <form onSubmit={handleAddStop} className="mt-4 flex flex-col gap-4">
              {/* 1. Fast Pick Preset Dropdown */}
              <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
                <label className="text-xs font-bold text-amber-950 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span>⚡</span>
                    <span>1-Click Popular Landmark Pick (Addis Ababa)</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wide bg-amber-200/70 text-amber-900 px-1.5 py-0.5 rounded font-bold">
                    Zero Math
                  </span>
                </label>
                <select
                  value={selectedPreset}
                  onChange={(e) => handleSelectPreset(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-amber-300 bg-white p-2.5 text-xs font-semibold text-ink focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
                >
                  <option value="">-- Choose from 35+ Popular Landmarks (Bole, CMC, Sarbet, etc.) --</option>
                  {ETHIOPIA_LANDMARKS.map((lm) => (
                    <option key={lm.name} value={lm.name}>
                      [{lm.area}] {lm.name}
                    </option>
                  ))}
                </select>

                {/* 2. Quick-Tap Preset Chips */}
                <div className="mt-2.5">
                  <span className="text-[11px] font-semibold text-amber-900">Popular pickup spots:</span>
                  <div className="mt-1 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto py-0.5">
                    {QUICK_CHIP_LANDMARKS.map((name) => {
                      const shortName = name.split('/')[0].split('(')[0].trim()
                      const isSelected = stopName === name
                      return (
                        <button
                          key={name}
                          type="button"
                          onClick={() => handleSelectPreset(name)}
                          className={
                            'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-all ' +
                            (isSelected
                              ? 'bg-ink text-white shadow-xs'
                              : 'bg-white text-slate-800 border border-amber-200/80 hover:bg-amber-100')
                          }
                        >
                          📍 {shortName}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* 3. Stop Landmark / Gate Name with Auto-Detect */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink">
                    Stop Landmark / Waiting Spot Name *
                  </label>
                  <button
                    type="button"
                    disabled={geocoding || !stopName?.trim()}
                    onClick={handleAutoFindLocation}
                    className="text-[11px] font-bold text-amber-700 hover:text-amber-900 disabled:opacity-40"
                  >
                    {geocoding ? 'Detecting…' : '🔍 Auto-Find Location'}
                  </button>
                </div>
                <div className="relative mt-1">
                  <input
                    type="text"
                    required
                    placeholder="e.g. Atlas Hotel Gate, Sarbet Laphto, or CMC Michael Square"
                    value={stopName}
                    onChange={(e) => {
                      setStopName(e.target.value)
                      setSelectedPreset('')
                    }}
                    className="w-full rounded-lg border border-field p-2.5 text-sm text-ink pr-20"
                  />
                  {stopName?.trim() && (
                    <button
                      type="button"
                      onClick={handleAutoFindLocation}
                      disabled={geocoding}
                      className="absolute right-2 top-2 rounded-md bg-amber/20 px-2 py-1 text-[10px] font-bold text-amber-950 hover:bg-amber/30"
                    >
                      {geocoding ? 'Finding…' : 'Find GPS'}
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  Use clear, well-known landmarks (gates, crossroads, hotels) so parents and drivers know where to wait.
                </p>
              </div>

              {/* 4. Visual Mini Map with Click-to-Pin */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
                    <span>🗺️</span>
                    <span>Visual Map Pin</span>
                  </span>
                  <span className="text-[11px] text-muted">
                    Tap anywhere on map to fine-tune
                  </span>
                </div>
                <StopMapPicker
                  lat={parseFloat(stopLat)}
                  lng={parseFloat(stopLng)}
                  onLocationSelect={handleMapLocationSelect}
                  landmarkName={stopName}
                />
              </div>

              {/* 5. GPS Status Banner & Hidden Coordinates Toggle */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-900 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-200 text-emerald-800 text-[10px] font-bold">
                    ✓
                  </span>
                  <span className="font-medium">
                    {geocodeMsg || `GPS pin ready for "${stopName || 'this stop'}"`}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowManualCoords(!showManualCoords)}
                  className="text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 underline"
                >
                  {showManualCoords ? 'Hide numbers' : 'Show numbers'}
                </button>
              </div>

              {/* Optional raw coordinates (collapsed by default for lazy managers) */}
              {showManualCoords && (
                <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-gray-50 border border-gray-200">
                  <div>
                    <label className="text-[11px] font-semibold text-muted">Latitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={stopLat}
                      onChange={(e) => setStopLat(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-field p-2 font-mono text-xs text-ink bg-white"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-semibold text-muted">Longitude</label>
                    <input
                      type="number"
                      step="0.0001"
                      required
                      value={stopLng}
                      onChange={(e) => setStopLng(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-field p-2 font-mono text-xs text-ink bg-white"
                    />
                  </div>
                </div>
              )}

              {/* 6. Sequence & School Campus Terminal */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-gray-100">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={stopIsSchool}
                    onChange={(e) => setStopIsSchool(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-amber focus:ring-amber"
                  />
                  <span className="text-xs font-semibold text-ink">
                    🏫 School Campus Terminal (Final Stop)
                  </span>
                </label>

                <div className="flex items-center gap-1.5 shrink-0">
                  <label className="text-xs text-muted font-medium">Pickup Seq:</label>
                  <input
                    type="number"
                    placeholder={`${(currentRoute.stops?.length || 0) + 1}`}
                    value={stopSequence}
                    onChange={(e) => setStopSequence(e.target.value)}
                    className="w-14 rounded-lg border border-field p-1.5 text-center text-xs font-bold text-ink"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="mt-2 flex justify-end gap-3 border-t border-gray-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddStopModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingStop}
                  className="rounded-xl bg-amber px-6 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50 shadow-xs"
                >
                  {addingStop ? 'Adding Stop…' : 'Add Stop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 4: Assign Bus to Route & Driver */}
      {assigningBus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">
                  Link Bus {assigningBus.busNumber}
                </h3>
                <p className="font-mono text-xs text-muted">
                  Plate: {assigningBus.plateNumber}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAssigningBus(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {assignError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {assignError}
              </div>
            )}

            <form onSubmit={handleSaveAssignment} className="mt-4 flex flex-col gap-4">
              {/* Route Selector */}
              <div>
                <label className="text-xs font-semibold text-ink">Assigned Route *</label>
                <select
                  required
                  value={assignRouteId}
                  onChange={(e) => setAssignRouteId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink bg-white"
                >
                  <option value="" disabled>-- Select Route --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code || 'Route'})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted">
                  Assigning a route determines which student stops this bus services.
                </p>
              </div>

              {/* Driver Selector */}
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-ink">Assigned Driver</label>
                  <button
                    type="button"
                    onClick={() => setShowDriverModal(true)}
                    className="text-[11px] font-bold text-amber-700 hover:text-amber-900"
                  >
                    + Provision New Driver
                  </button>
                </div>
                <select
                  value={assignDriverId}
                  onChange={(e) => setAssignDriverId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink bg-white"
                >
                  <option value="">-- No Driver Assigned (Unassigned) --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>
                      👤 {d.full_name} {d.phone ? `(${d.phone})` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-muted">
                  The assigned driver will see this bus and route when logging into the driver app.
                </p>
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAssigningBus(null)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingAssignment}
                  className="rounded-xl bg-ink px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {savingAssignment ? 'Saving…' : 'Save Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 5: Provision Driver Account */}
      {showDriverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">Provision Driver Account</h3>
                <p className="text-xs text-muted">Create login credentials for a school bus driver</p>
              </div>
              <button
                type="button"
                onClick={() => setShowDriverModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {driverError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {driverError}
              </div>
            )}

            <form onSubmit={handleProvisionDriver} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">Driver Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Abebe Kebede"
                  value={driverName}
                  onChange={(e) => setDriverName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Driver Phone Number *</label>
                <input
                  type="tel"
                  required
                  placeholder="e.g. 0911223344 or +251911223344"
                  value={driverPhone}
                  onChange={(e) => setDriverPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
                <p className="mt-1 text-[11px] text-muted">
                  Used for driver identification and phone login.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Driver Email (Optional)</label>
                <input
                  type="email"
                  placeholder="e.g. abebe.driver@schoolbus.local"
                  value={driverEmail}
                  onChange={(e) => setDriverEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Temporary Password *</label>
                <input
                  type="text"
                  required
                  value={driverPassword}
                  onChange={(e) => setDriverPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 font-mono text-sm text-ink"
                />
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowDriverModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={provisioningDriver}
                  className="rounded-xl bg-amber px-5 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
                >
                  {provisioningDriver ? 'Creating Account…' : 'Create Driver Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 6: Driver Credentials Created Success Card */}
      {createdDriverCreds && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-xl shrink-0">
                ✅
              </span>
              <div>
                <h3 className="text-lg font-bold text-ink">Driver Account Created!</h3>
                <p className="text-xs text-muted">
                  Share these login credentials with the driver.
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Driver Name:</span>
                <span className="font-bold text-ink">{createdDriverCreds.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Login ID / Phone:</span>
                <span className="font-mono font-bold text-ink">
                  {createdDriverCreds.email || createdDriverCreds.phone}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Temporary Password:</span>
                <span className="font-mono font-bold text-ink">{createdDriverCreds.password}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Role:</span>
                <span className="rounded bg-amber-100 px-2 py-0.5 font-bold text-amber-900">
                  School Bus Driver
                </span>
              </div>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={handleCopyCreds}
                className="flex-1 rounded-xl bg-amber px-4 py-2.5 text-xs font-bold text-ink hover:opacity-95 shadow-xs"
              >
                {copiedCreds ? '✓ Copied to Clipboard!' : '📋 Copy Driver Login'}
              </button>
              <button
                type="button"
                onClick={() => setCreatedDriverCreds(null)}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}