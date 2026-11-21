import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'
import { ETHIOPIA_LANDMARKS, QUICK_CHIP_LANDMARKS, lookupEthiopiaLocation } from '../lib/ethiopiaLandmarks.js'

const FIELD = 'min-h-11 rounded-2xl border border-[#E2E8F0] bg-white px-3.5 text-sm text-[#172033] focus:border-[#0D9488] focus:ring-2 focus:ring-[#0D9488]/20 focus:outline-none transition-all'

export default function BusesRoutes() {
  const {
    buses,
    routes,
    drivers,
    loading,
    addBus,
    addRoute,
    addStopToRoute,
    deleteStop,
    reorderStops,
    deleteBus,
    assignBusToRouteAndDriver,
    provisionDriver,
    initializeDefaultRoutesAndBuses,
  } = useManagerData()

  // Direction toggle per bus or global (default Morning)
  const [direction, setDirection] = useState('Morning')
  const [toastMsg, setToastMsg] = useState(null)
  const [initLoading, setInitLoading] = useState(false)

  // 1. Unified Add Bus & Route Wizard Modal
  const [showAddUnifiedModal, setShowAddUnifiedModal] = useState(false)
  const [newBusNumber, setNewBusNumber] = useState('')
  const [newPlateNumber, setNewPlateNumber] = useState('')
  const [newCapacity, setNewCapacity] = useState('32')
  const [driverMode, setDriverMode] = useState('existing') // 'existing' | 'new' | 'none'
  const [selectedDriverId, setSelectedDriverId] = useState('')
  const [newDriverName, setNewDriverName] = useState('')
  const [newDriverPhone, setNewDriverPhone] = useState('')
  const [routeMode, setRouteMode] = useState('existing') // 'existing' | 'new' | 'none'
  const [selectedRouteId, setSelectedRouteId] = useState('')
  const [newRouteName, setNewRouteName] = useState('')
  const [newRouteTime, setNewRouteTime] = useState('06:45')
  const [savingUnified, setSavingUnified] = useState(false)
  const [unifiedError, setUnifiedError] = useState(null)

  // 2. Simplified Add Stop Modal
  const [stopTargetRoute, setStopTargetRoute] = useState(null)
  const [newStopName, setNewStopName] = useState('')
  const [newStopIsSchool, setNewStopIsSchool] = useState(false)
  const [savingStop, setSavingStop] = useState(false)
  const [stopError, setStopError] = useState(null)

  // 3. Quick Change Driver / Route Popover State
  const [changingBus, setChangingBus] = useState(null)
  const [changeType, setChangeType] = useState(null) // 'driver' | 'route'
  const [targetId, setTargetId] = useState('')
  const [savingChange, setSavingChange] = useState(false)

  // 4. Delete Confirmation State
  const [busToDelete, setBusToDelete] = useState(null)
  const [stopToDelete, setStopToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // --- Handlers ---

  // Unified Setup Handler (Creates Bus, Driver if needed, Route if needed, and links them)
  async function handleUnifiedSubmit(e) {
    e.preventDefault()
    setUnifiedError(null)
    setSavingUnified(true)

    try {
      // 1. Create Bus
      const busRes = await addBus({
        busNumber: newBusNumber.trim(),
        plateNumber: newPlateNumber.trim().toUpperCase(),
        capacity: Number(newCapacity) || 30,
      })
      const createdBus = busRes.bus

      // 2. Handle Driver (pick existing or create new)
      let finalDriverId = null
      if (driverMode === 'existing' && selectedDriverId) {
        finalDriverId = selectedDriverId
      } else if (driverMode === 'new' && newDriverName.trim()) {
        const dRes = await provisionDriver({
          fullName: newDriverName.trim(),
          phone: newDriverPhone.trim() || undefined,
          tempPassword: 'Driver' + Math.floor(1000 + Math.random() * 9000) + '!',
        })
        finalDriverId = dRes.user_id
      }

      // 3. Handle Route (pick existing or create new)
      let finalRouteId = null
      if (routeMode === 'existing' && selectedRouteId) {
        finalRouteId = selectedRouteId
      } else if (routeMode === 'new' && newRouteName.trim()) {
        const rRes = await addRoute({
          name: newRouteName.trim(),
          startTime: newRouteTime || '06:45',
        })
        finalRouteId = rRes.route?.id
      }

      // 4. Link Bus to Route & Driver if any selected
      if (finalRouteId && createdBus?.id) {
        await assignBusToRouteAndDriver({
          busId: createdBus.id,
          routeId: finalRouteId,
          driverProfileId: finalDriverId,
        })
      }

      setToastMsg(`Bus ${newBusNumber} successfully added and configured!`)
      setShowAddUnifiedModal(false)
      resetUnifiedForm()
    } catch (err) {
      console.error('Unified bus creation error:', err)
      setUnifiedError(err.message || 'Failed to add bus.')
    } finally {
      setSavingUnified(false)
    }
  }

  function resetUnifiedForm() {
    setNewBusNumber('')
    setNewPlateNumber('')
    setNewCapacity('32')
    setDriverMode('existing')
    setSelectedDriverId('')
    setNewDriverName('')
    setNewDriverPhone('')
    setRouteMode('existing')
    setSelectedRouteId('')
    setNewRouteName('')
    setNewRouteTime('06:45')
    setUnifiedError(null)
  }

  // Quick Change Driver or Route for an existing bus
  async function handleSaveQuickChange() {
    if (!changingBus) return
    setSavingChange(true)
    try {
      const currentRouteId = changeType === 'route' ? targetId : changingBus.routeId
      const currentDriverId = changeType === 'driver' ? (targetId || null) : changingBus.driverProfileId

      if (!currentRouteId) {
        throw new Error('A bus must have an assigned route.')
      }

      await assignBusToRouteAndDriver({
        busId: changingBus.id,
        routeId: currentRouteId,
        driverProfileId: currentDriverId,
      })

      setToastMsg(`Updated ${changeType} for Bus ${changingBus.busNumber}!`)
      setChangingBus(null)
      setChangeType(null)
      setTargetId('')
    } catch (err) {
      alert(err.message || 'Failed to update assignment.')
    } finally {
      setSavingChange(false)
    }
  }

  // Add Stop to a Route
  async function handleAddStopSubmit(e) {
    e.preventDefault()
    if (!stopTargetRoute?.id) return
    if (!newStopName.trim()) return

    setSavingStop(true)
    setStopError(null)

    try {
      // Lookup coordinates from Ethiopian landmarks or central fallback
      let lat = 9.025
      let lng = 38.765
      const foundPreset = ETHIOPIA_LANDMARKS.find(
        (l) => l.name.toLowerCase() === newStopName.trim().toLowerCase()
      )
      if (foundPreset) {
        lat = foundPreset.lat
        lng = foundPreset.lng
      } else {
        const lookedUp = await lookupEthiopiaLocation(newStopName.trim()).catch(() => null)
        if (lookedUp) {
          lat = lookedUp.lat
          lng = lookedUp.lng
        }
      }

      await addStopToRoute({
        routeId: stopTargetRoute.id,
        name: newStopName.trim(),
        lat,
        lng,
        isSchool: newStopIsSchool,
      })

      setToastMsg(`Added "${newStopName.trim()}" to ${stopTargetRoute.name}!`)
      setNewStopName('')
      setNewStopIsSchool(false)
      setStopTargetRoute(null)
    } catch (err) {
      console.error('Add stop error:', err)
      setStopError(err.message || 'Failed to add stop.')
    } finally {
      setSavingStop(false)
    }
  }

  // Move Stop Up or Down in sequence
  async function handleMoveStop(route, stopIndex, delta) {
    const stopsList = [...(route.stops || [])]
    const targetIndex = stopIndex + delta
    if (targetIndex < 0 || targetIndex >= stopsList.length) return

    // Swap elements
    const temp = stopsList[stopIndex]
    stopsList[stopIndex] = stopsList[targetIndex]
    stopsList[targetIndex] = temp

    try {
      await reorderStops(route.id, stopsList)
      setToastMsg(`Reordered stops for ${route.name}!`)
    } catch (err) {
      console.error('Reorder error:', err)
      alert(err.message || 'Failed to reorder stops.')
    }
  }

  // Delete Bus
  async function handleConfirmDeleteBus() {
    if (!busToDelete) return
    setDeleting(true)
    try {
      await deleteBus(busToDelete.id)
      setToastMsg(`Bus ${busToDelete.busNumber} removed from fleet.`)
      setBusToDelete(null)
    } catch (err) {
      alert(err.message || 'Failed to remove bus.')
    } finally {
      setDeleting(false)
    }
  }

  // Delete Stop
  async function handleConfirmDeleteStop() {
    if (!stopToDelete) return
    setDeleting(true)
    try {
      await deleteStop(stopToDelete.id)
      setToastMsg(`Removed stop "${stopToDelete.name}".`)
      setStopToDelete(null)
    } catch (err) {
      alert(err.message || 'Failed to remove stop.')
    } finally {
      setDeleting(false)
    }
  }

  // 1-Click Route & Fleet Initialization
  async function handleInitialize() {
    setInitLoading(true)
    try {
      await initializeDefaultRoutesAndBuses()
      setToastMsg('Standard routes, stops, and fleet created successfully!')
    } catch (err) {
      alert(err.message || 'Failed to initialize routes.')
    } finally {
      setInitLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-[#0D9488] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Notification */}
      {toastMsg && (
        <div className="card-3d flex items-center justify-between rounded-2xl border border-emerald-300 bg-emerald-50/95 p-3.5 text-xs font-bold text-emerald-950 shadow-sm animate-fadeIn">
          <span className="flex items-center gap-2">
            <span className="text-[#0D9488]">✓</span>
            <span>{toastMsg}</span>
          </span>
          <button onClick={() => setToastMsg(null)} className="text-emerald-800 hover:opacity-75 font-black text-sm">✕</button>
        </div>
      )}

      {/* Main Header */}
      <header className="card-3d flex flex-wrap items-center justify-between gap-4 rounded-3xl p-6 shadow-sm">
        <div>
          <h1 className="text-2xl sm:text-3xl font-black text-[#172033] tracking-tight">Buses &amp; Routes</h1>
          <p className="mt-1 text-xs sm:text-sm font-medium text-[#64748B]">
            Unified view: Each card holds its bus, assigned driver, and sequential route stops.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs font-bold text-[#64748B]">
            <span className="rounded-full bg-[#E6F4F1] text-[#0D9488] px-3 py-1">
              🚌 {buses.length} {buses.length === 1 ? 'Bus' : 'Buses'}
            </span>
            <span className="rounded-full bg-slate-100 text-[#172033] px-3 py-1">
              🛣️ {routes.length} {routes.length === 1 ? 'Route' : 'Routes'}
            </span>
            <span className="rounded-full bg-slate-100 text-[#172033] px-3 py-1">
              👤 {drivers.length} Registered Drivers
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            resetUnifiedForm()
            setShowAddUnifiedModal(true)
          }}
          className="btn-3d-amber flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black text-white shadow-sm"
        >
          <span className="text-base leading-none">＋</span>
          <span>Add Bus &amp; Route</span>
        </button>
      </header>

      {/* Zero Routes Setup Alert Banner */}
      {routes.length === 0 && (
        <div className="card-3d rounded-3xl border border-amber-300 bg-amber-50/90 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-200 text-xl shrink-0 shadow-2xs">
              🗺️
            </span>
            <div>
              <h3 className="text-sm font-black text-amber-950">No Bus Fleet Configured</h3>
              <p className="text-xs text-amber-900 mt-0.5 font-medium leading-relaxed">
                Start by adding your first bus, or initialize standard school routes and stops with 1 click.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={initLoading}
            onClick={handleInitialize}
            className="btn-3d-primary rounded-2xl px-5 py-2.5 text-xs font-black text-white disabled:opacity-50"
          >
            {initLoading ? 'Creating Routes…' : '⚡ Initialize Standard Fleet (1-Click)'}
          </button>
        </div>
      )}

      {/* Fleet Deck: Unified Bus Cards */}
      <div className="flex flex-col gap-6">
        {buses.length === 0 ? (
          <div className="card-3d rounded-3xl p-12 text-center flex flex-col items-center justify-center gap-3">
            <span className="text-4xl">🚌</span>
            <h3 className="text-base font-black text-[#172033]">Your fleet is empty</h3>
            <p className="text-xs text-[#64748B] max-w-sm">
              Add a bus to configure who drives it, which route it services, and its pickup stops.
            </p>
            <button
              type="button"
              onClick={() => {
                resetUnifiedForm()
                setShowAddUnifiedModal(true)
              }}
              className="btn-3d-amber mt-2 rounded-2xl px-6 py-2.5 text-xs font-black text-white"
            >
              ＋ Add First Bus
            </button>
          </div>
        ) : (
          buses.map((bus) => {
            const assignedRoute = routes.find((r) => r.id === bus.routeId) || null
            const rawStops = assignedRoute?.stops || []
            const displayedStops = direction === 'Morning' ? rawStops : [...rawStops].reverse()

            return (
              <section
                key={bus.id}
                className="card-3d rounded-3xl p-6 sm:p-7 shadow-sm border border-[#E2E8F0] flex flex-col gap-5 hover:border-[#CBD5E1] transition-all"
              >
                {/* 1. Bus Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-4">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#E6F4F1] text-2xl font-black text-[#0D9488] shadow-2xs border border-[#0D9488]/20">
                      🚌
                    </div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl font-black text-[#172033]">
                          {bus.name || `Bus ${bus.busNumber}`}
                        </h2>
                        <span className="rounded-lg bg-slate-100 px-2.5 py-0.5 font-mono text-xs font-bold text-[#172033] border border-slate-200">
                          {bus.plateNumber || 'No Plate'}
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] font-medium mt-0.5">
                        {bus.capacity || 30} passenger seats · Single-bus transit isolation
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setBusToDelete(bus)}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-red-500 hover:bg-red-50 hover:border-red-300 transition-all shadow-2xs"
                      title="Remove bus from fleet"
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                {/* 2. Driver & Route Pillars in 2 clean columns */}
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Driver Pillar */}
                  <div className="rounded-2xl bg-slate-50 border border-[#E2E8F0] p-4 flex flex-col justify-between gap-2.5">
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                        <span>👤</span>
                        <span>Assigned Driver</span>
                      </span>
                      {bus.driverName ? (
                        <div className="mt-1.5">
                          <p className="text-sm font-black text-[#172033]">{bus.driverName}</p>
                          <p className="text-xs font-mono text-[#0D9488] font-bold">
                            📞 {bus.driverPhone || 'No phone recorded'}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-1.5">
                          <p className="text-xs font-bold text-amber-800">⚠️ No driver assigned</p>
                          <p className="text-[11px] text-[#64748B]">Driver will not see this bus until linked.</p>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setChangingBus(bus)
                        setChangeType('driver')
                        setTargetId(bus.driverProfileId || '')
                      }}
                      className="self-start rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-[#172033] hover:bg-slate-100 shadow-2xs transition-all"
                    >
                      {bus.driverName ? '🔄 Change Driver' : '＋ Assign Driver'}
                    </button>
                  </div>

                  {/* Route Pillar */}
                  <div className="rounded-2xl bg-slate-50 border border-[#E2E8F0] p-4 flex flex-col justify-between gap-2.5">
                    <div>
                      <span className="text-[11px] font-black uppercase tracking-wider text-[#64748B] flex items-center gap-1.5">
                        <span>🛣️</span>
                        <span>Serviced Route</span>
                      </span>
                      {assignedRoute ? (
                        <div className="mt-1.5">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-black text-[#172033]">{assignedRoute.name}</p>
                            {assignedRoute.code && (
                              <span className="rounded bg-[#E6F4F1] px-1.5 py-0.2 text-[10px] font-mono font-bold text-[#0D9488]">
                                {assignedRoute.code}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[#64748B] font-medium">
                            Starts at <strong>{assignedRoute.start_time || '06:45 AM'}</strong> · {assignedRoute.stops?.length || 0} stops
                          </p>
                        </div>
                      ) : (
                        <div className="mt-1.5">
                          <p className="text-xs font-bold text-rose-800">⚠️ No route linked</p>
                          <p className="text-[11px] text-[#64748B]">Link a route to configure student pickup stops.</p>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setChangingBus(bus)
                        setChangeType('route')
                        setTargetId(bus.routeId || '')
                      }}
                      className="self-start rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-[#172033] hover:bg-slate-100 shadow-2xs transition-all"
                    >
                      {assignedRoute ? '🔄 Change Route' : '＋ Link Route'}
                    </button>
                  </div>
                </div>

                {/* 3. Sequential Route Stops Section */}
                {assignedRoute && (
                  <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4.5 flex flex-col gap-3.5">
                    {/* Direction Toggle & Stop Header */}
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black uppercase tracking-wider text-[#172033]">
                          Bus Stops ({displayedStops.length})
                        </span>
                        <span className="text-[11px] text-[#64748B] font-medium">
                          {direction === 'Morning' ? '• Pickup Sequence' : '• Dropoff Sequence (Reversed)'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 border border-slate-200/80">
                          {['Morning', 'Afternoon'].map((d) => (
                            <button
                              key={d}
                              type="button"
                              onClick={() => setDirection(d)}
                              className={
                                'rounded-lg px-2.5 py-1 text-xs font-bold transition-all ' +
                                (direction === d
                                  ? 'bg-white text-[#172033] shadow-xs'
                                  : 'text-[#64748B] hover:text-[#172033]')
                              }
                            >
                              {d}
                            </button>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setStopTargetRoute(assignedRoute)
                            setNewStopName('')
                            setNewStopIsSchool(false)
                            setStopError(null)
                          }}
                          className="btn-3d-amber rounded-xl px-3 py-1.5 text-xs font-black text-white shadow-2xs"
                        >
                          ＋ Add Stop
                        </button>
                      </div>
                    </div>

                    {/* Ordered List of Stops */}
                    {displayedStops.length === 0 ? (
                      <div className="py-6 text-center flex flex-col items-center justify-center gap-2">
                        <span className="text-2xl">📍</span>
                        <p className="text-xs font-bold text-[#172033]">No stops defined on this route yet</p>
                        <p className="text-[11px] text-[#64748B]">Add pickup stops so parents and drivers know where students wait.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setStopTargetRoute(assignedRoute)
                            setNewStopName('')
                            setNewStopIsSchool(false)
                          }}
                          className="btn-3d-subtle mt-1 rounded-xl px-3 py-1.5 text-xs font-bold text-[#172033]"
                        >
                          ＋ Add First Stop
                        </button>
                      </div>
                    ) : (
                      <ol className="flex flex-col gap-2">
                        {displayedStops.map((stop, index) => {
                          const isFirst = index === 0
                          const isLast = index === displayedStops.length - 1

                          return (
                            <li
                              key={stop.id}
                              className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-xs hover:bg-slate-100/70 transition-all"
                            >
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-white text-xs font-black text-[#0D9488] shadow-2xs border border-slate-200 shrink-0">
                                  {index + 1}
                                </span>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-[#172033] truncate">{stop.name}</span>
                                    {stop.is_school && (
                                      <span className="rounded bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-900 shrink-0">
                                        🏫 Campus Terminal
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-[#64748B]">
                                    Auto-geofenced · 500m proximity notifications
                                  </p>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                {/* Up / Down Reorder Arrows */}
                                <button
                                  type="button"
                                  disabled={isFirst}
                                  onClick={() => handleMoveStop(assignedRoute, index, -1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-all shadow-2xs"
                                  title="Move stop earlier in sequence"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  disabled={isLast}
                                  onClick={() => handleMoveStop(assignedRoute, index, 1)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-30 transition-all shadow-2xs"
                                  title="Move stop later in sequence"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setStopToDelete(stop)}
                                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 bg-white text-red-500 hover:bg-red-50 hover:border-red-300 transition-all shadow-2xs"
                                  title="Remove stop"
                                >
                                  ✕
                                </button>
                              </div>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </div>
                )}
              </section>
            )
          })
        )}
      </div>

      {/* MODAL 1: Unified "Add Bus & Route" Wizard */}
      {showAddUnifiedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-lg rounded-3xl p-6 shadow-2xl border border-white/90 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-[#172033]">Add Bus &amp; Route</h3>
                <p className="text-xs text-[#64748B] font-medium">Configure vehicle, driver, and route in 1 step</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddUnifiedModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            {unifiedError && (
              <div className="mt-3.5 rounded-2xl bg-red-50 border border-red-200 p-3 text-xs font-bold text-[#DC2626]">
                ✕ {unifiedError}
              </div>
            )}

            <form onSubmit={handleUnifiedSubmit} className="mt-4 flex flex-col gap-5">
              {/* Pillar 1: Bus Vehicle Information */}
              <div className="rounded-2xl bg-slate-50 border border-[#E2E8F0] p-4 flex flex-col gap-3">
                <span className="text-xs font-black uppercase tracking-wider text-[#172033] flex items-center gap-1.5">
                  <span>🚌</span>
                  <span>1. Bus Vehicle Details</span>
                </span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-bold text-[#172033]">Bus Number *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Bus 3"
                      value={newBusNumber}
                      onChange={(e) => setNewBusNumber(e.target.value)}
                      className={FIELD + ' mt-1 w-full'}
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#172033]">License Plate *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 3-ET-1029"
                      value={newPlateNumber}
                      onChange={(e) => setNewPlateNumber(e.target.value)}
                      className={FIELD + ' mt-1 w-full uppercase font-mono'}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-[#172033]">Seating Capacity</label>
                  <input
                    type="number"
                    placeholder="32"
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(e.target.value)}
                    className={FIELD + ' mt-1 w-full'}
                  />
                </div>
              </div>

              {/* Pillar 2: Driver Assignment */}
              <div className="rounded-2xl bg-slate-50 border border-[#E2E8F0] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-[#172033] flex items-center gap-1.5">
                    <span>👤</span>
                    <span>2. Bus Driver</span>
                  </span>
                  <div className="flex gap-1 rounded-xl bg-slate-200/80 p-0.5 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setDriverMode('existing')}
                      className={'rounded-lg px-2 py-0.5 ' + (driverMode === 'existing' ? 'bg-white text-[#172033] shadow-xs' : 'text-[#64748B]')}
                    >
                      Pick Driver
                    </button>
                    <button
                      type="button"
                      onClick={() => setDriverMode('new')}
                      className={'rounded-lg px-2 py-0.5 ' + (driverMode === 'new' ? 'bg-white text-[#172033] shadow-xs' : 'text-[#64748B]')}
                    >
                      ＋ New Driver
                    </button>
                  </div>
                </div>

                {driverMode === 'existing' ? (
                  <div>
                    <select
                      value={selectedDriverId}
                      onChange={(e) => setSelectedDriverId(e.target.value)}
                      className={FIELD + ' w-full'}
                    >
                      <option value="">-- No driver yet (Assign later) --</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.full_name} {d.phone ? `(${d.phone})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <div>
                      <input
                        type="text"
                        placeholder="Driver Full Name (e.g. Abebe)"
                        value={newDriverName}
                        onChange={(e) => setNewDriverName(e.target.value)}
                        className={FIELD + ' w-full'}
                      />
                    </div>
                    <div>
                      <input
                        type="tel"
                        placeholder="Driver Phone (e.g. 0911223344)"
                        value={newDriverPhone}
                        onChange={(e) => setNewDriverPhone(e.target.value)}
                        className={FIELD + ' w-full'}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Pillar 3: Route Assignment */}
              <div className="rounded-2xl bg-slate-50 border border-[#E2E8F0] p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-[#172033] flex items-center gap-1.5">
                    <span>🛣️</span>
                    <span>3. Bus Route</span>
                  </span>
                  <div className="flex gap-1 rounded-xl bg-slate-200/80 p-0.5 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => setRouteMode('existing')}
                      className={'rounded-lg px-2 py-0.5 ' + (routeMode === 'existing' ? 'bg-white text-[#172033] shadow-xs' : 'text-[#64748B]')}
                    >
                      Pick Route
                    </button>
                    <button
                      type="button"
                      onClick={() => setRouteMode('new')}
                      className={'rounded-lg px-2 py-0.5 ' + (routeMode === 'new' ? 'bg-white text-[#172033] shadow-xs' : 'text-[#64748B]')}
                    >
                      ＋ New Route
                    </button>
                  </div>
                </div>

                {routeMode === 'existing' ? (
                  <div>
                    <select
                      value={selectedRouteId}
                      onChange={(e) => setSelectedRouteId(e.target.value)}
                      className={FIELD + ' w-full'}
                    >
                      <option value="">-- No route yet (Link later) --</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.code || 'Route'})
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="grid gap-2.5 sm:grid-cols-[1fr_120px]">
                    <div>
                      <input
                        type="text"
                        placeholder="Route Name (e.g. Bole &amp; Sarbet Line)"
                        value={newRouteName}
                        onChange={(e) => setNewRouteName(e.target.value)}
                        className={FIELD + ' w-full'}
                      />
                    </div>
                    <div>
                      <input
                        type="time"
                        value={newRouteTime}
                        onChange={(e) => setNewRouteTime(e.target.value)}
                        className={FIELD + ' w-full'}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-2 flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddUnifiedModal(false)}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingUnified || !newBusNumber.trim() || !newPlateNumber.trim()}
                  className="btn-3d-amber rounded-2xl px-6 py-2.5 text-xs font-black text-white disabled:opacity-50"
                >
                  {savingUnified ? 'Saving Configuration…' : 'Save Bus Configuration ⚡'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Simplified "Add Stop" Modal */}
      {stopTargetRoute && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/90">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-black text-[#172033]">Add Stop to Route</h3>
                <p className="text-xs text-[#0D9488] font-bold">{stopTargetRoute.name}</p>
              </div>
              <button
                type="button"
                onClick={() => setStopTargetRoute(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            {stopError && (
              <div className="mt-3.5 rounded-2xl bg-red-50 border border-red-200 p-3 text-xs font-bold text-[#DC2626]">
                ✕ {stopError}
              </div>
            )}

            <form onSubmit={handleAddStopSubmit} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-bold text-[#172033]">Stop Landmark or Station Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Bole Medhanealem Gate or Atlas Hotel"
                  value={newStopName}
                  onChange={(e) => setNewStopName(e.target.value)}
                  className={FIELD + ' mt-1 w-full'}
                />
              </div>

              {/* Quick Landmark Chips */}
              <div className="rounded-2xl bg-slate-50 border border-[#E2E8F0] p-3 flex flex-col gap-1.5">
                <span className="text-[11px] font-bold text-[#64748B]">Or tap popular landmarks in Addis Ababa:</span>
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pt-1">
                  {QUICK_CHIP_LANDMARKS.slice(0, 10).map((lm) => (
                    <button
                      key={lm}
                      type="button"
                      onClick={() => setNewStopName(lm)}
                      className="rounded-lg bg-white border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-[#172033] hover:border-[#0D9488] hover:text-[#0D9488] transition-all"
                    >
                      📍 {lm.split('/')[0]}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex items-center gap-2.5 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={newStopIsSchool}
                  onChange={(e) => setNewStopIsSchool(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#0D9488] cursor-pointer"
                />
                <span className="text-xs font-bold text-[#172033]">
                  🏫 This is the School Campus Terminal (Final Destination)
                </span>
              </label>

              <div className="mt-2 flex justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setStopTargetRoute(null)}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStop || !newStopName.trim()}
                  className="btn-3d-amber rounded-2xl px-6 py-2.5 text-xs font-black text-white disabled:opacity-50"
                >
                  {savingStop ? 'Saving Stop…' : 'Add Stop ⚡'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: Quick Change Driver or Route */}
      {changingBus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-white/90">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-[#172033]">
                {changeType === 'driver' ? 'Change Driver' : 'Change Route'} for Bus {changingBus.busNumber}
              </h3>
              <button
                type="button"
                onClick={() => { setChangingBus(null); setChangeType(null) }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-4">
              {changeType === 'driver' ? (
                <div>
                  <label className="text-xs font-bold text-[#172033]">Select Driver</label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className={FIELD + ' mt-1 w-full'}
                  >
                    <option value="">-- Unassigned (No Driver) --</option>
                    {drivers.map((d) => (
                      <option key={d.id} value={d.id}>
                        👤 {d.full_name} {d.phone ? `(${d.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="text-xs font-bold text-[#172033]">Select Serviced Route</label>
                  <select
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                    className={FIELD + ' mt-1 w-full'}
                  >
                    <option value="" disabled>-- Select Route --</option>
                    {routes.map((r) => (
                      <option key={r.id} value={r.id}>
                        🛣️ {r.name} ({r.code || 'Route'})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mt-2 flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => { setChangingBus(null); setChangeType(null) }}
                  className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-bold text-[#64748B]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={savingChange}
                  onClick={handleSaveQuickChange}
                  className="btn-3d-amber rounded-2xl px-5 py-2 text-xs font-black text-white disabled:opacity-50"
                >
                  {savingChange ? 'Updating…' : 'Save Change'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Bus Confirmation Modal */}
      {busToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-red-200 text-center">
            <span className="text-3xl">🗑️</span>
            <h3 className="text-base font-black text-[#172033] mt-2">Remove Bus {busToDelete.busNumber}?</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Plate: <strong>{busToDelete.plateNumber}</strong>. This removes the bus vehicle from your fleet.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setBusToDelete(null)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-bold text-[#64748B]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDeleteBus}
                className="rounded-2xl bg-[#DC2626] px-5 py-2 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Removing…' : 'Yes, Remove Bus'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Stop Confirmation Modal */}
      {stopToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-sm rounded-3xl p-6 shadow-2xl border border-red-200 text-center">
            <span className="text-3xl">📍</span>
            <h3 className="text-base font-black text-[#172033] mt-2">Remove Stop?</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Remove <strong>&ldquo;{stopToDelete.name}&rdquo;</strong> from this route?
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStopToDelete(null)}
                className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-bold text-[#64748B]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDeleteStop}
                className="rounded-2xl bg-[#DC2626] px-5 py-2 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Removing…' : 'Yes, Remove Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
