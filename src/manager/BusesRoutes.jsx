import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'
import { QUICK_CHIP_LANDMARKS, lookupEthiopiaLocation } from '../lib/ethiopiaLandmarks.js'

const INPUT_CLASS = 'h-10 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs text-[#172033] placeholder:text-[#94A3B8] focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] focus:outline-none transition-colors'

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

  // Navigation tab inside Fleet & Routes: 'fleet' | 'routes'
  const [activeTab, setActiveTab] = useState('fleet')
  const [selectedRouteId, setSelectedRouteId] = useState(null)
  const [direction, setDirection] = useState('Morning')
  const [toastMsg, setToastMsg] = useState(null)
  const [initLoading, setInitLoading] = useState(false)

  // 1. Add Vehicle Modal
  const [showAddBusModal, setShowAddBusModal] = useState(false)
  const [busNumber, setBusNumber] = useState('')
  const [plateNumber, setPlateNumber] = useState('')
  const [capacity, setCapacity] = useState('32')
  const [assignDriverId, setAssignDriverId] = useState('')
  const [assignRouteId, setAssignRouteId] = useState('')
  const [savingBus, setSavingBus] = useState(false)
  const [busError, setBusError] = useState(null)

  // 2. Add Route Modal
  const [showAddRouteModal, setShowAddRouteModal] = useState(false)
  const [routeName, setRouteName] = useState('')
  const [routeStartTime, setRouteStartTime] = useState('06:45')
  const [savingRoute, setSavingRoute] = useState(false)
  const [routeError, setRouteError] = useState(null)

  // 3. Add Stop Modal
  const [showAddStopModal, setShowAddStopModal] = useState(false)
  const [stopRouteId, setStopRouteId] = useState('')
  const [stopName, setStopName] = useState('')
  const [stopIsSchool, setStopIsSchool] = useState(false)
  const [savingStop, setSavingStop] = useState(false)
  const [stopError, setStopError] = useState(null)

  // 4. Quick Change Assignment Popover
  const [quickChangeBus, setQuickChangeBus] = useState(null)
  const [changeType, setChangeType] = useState(null) // 'driver' | 'route'
  const [changeTargetId, setChangeTargetId] = useState('')
  const [savingChange, setSavingChange] = useState(false)

  // 5. Delete Confirmation Modal
  const [busToDelete, setBusToDelete] = useState(null)
  const [stopToDelete, setStopToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Operational Counts & Balance
  const totalBuses = buses.length
  const totalRoutes = routes.length
  const totalDrivers = drivers.length
  const unassignedBuses = buses.filter((b) => !b.driverName || !b.routeId)
  const busesWithoutDriver = buses.filter((b) => !b.driverName)
  const busesWithoutRoute = buses.filter((b) => !b.routeId)

  // Current active route object
  const activeRoute = routes.find((r) => r.id === (selectedRouteId || routes[0]?.id)) || routes[0] || null

  // --- Handlers ---

  async function handleAddBusSubmit(e) {
    e.preventDefault()
    setBusError(null)
    setSavingBus(true)

    try {
      const busRes = await addBus({
        busNumber: busNumber.trim(),
        plateNumber: plateNumber.trim().toUpperCase(),
        capacity: Number(capacity) || 32,
      })

      const createdBus = busRes.bus
      if (assignRouteId && createdBus?.id) {
        await assignBusToRouteAndDriver({
          busId: createdBus.id,
          routeId: assignRouteId,
          driverProfileId: assignDriverId || null,
        })
      }

      setToastMsg(`Vehicle ${busNumber} successfully registered into fleet.`)
      setShowAddBusModal(false)
      setBusNumber('')
      setPlateNumber('')
      setCapacity('32')
      setAssignDriverId('')
      setAssignRouteId('')
    } catch (err) {
      setBusError(err.message || 'Failed to add vehicle.')
    } finally {
      setSavingBus(false)
    }
  }

  async function handleAddRouteSubmit(e) {
    e.preventDefault()
    setRouteError(null)
    setSavingRoute(true)

    try {
      const res = await addRoute({
        name: routeName.trim(),
        startTime: routeStartTime || '06:45',
      })

      setToastMsg(`Route "${routeName}" created successfully.`)
      setShowAddRouteModal(false)
      setRouteName('')
      setRouteStartTime('06:45')
      if (res.route?.id) {
        setSelectedRouteId(res.route.id)
        setActiveTab('routes')
      }
    } catch (err) {
      setRouteError(err.message || 'Failed to create route.')
    } finally {
      setSavingRoute(false)
    }
  }

  async function handleAddStopSubmit(e) {
    e.preventDefault()
    setStopError(null)
    setSavingStop(true)

    try {
      const targetRouteId = stopRouteId || activeRoute?.id
      if (!targetRouteId) throw new Error('Please select a target route.')

      const loc = lookupEthiopiaLocation(stopName)
      const lat = loc ? loc.lat : 9.0200 + (Math.random() * 0.02 - 0.01)
      const lng = loc ? loc.lng : 38.7500 + (Math.random() * 0.02 - 0.01)

      const targetRoute = routes.find((r) => r.id === targetRouteId)
      const stopOrder = (targetRoute?.stops?.length || 0) + 1

      await addStopToRoute({
        routeId: targetRouteId,
        name: stopName.trim(),
        stopOrder,
        lat,
        lng,
        isSchool: stopIsSchool,
      })

      setToastMsg(`Stop "${stopName.trim()}" added to route.`)
      setStopName('')
      setStopIsSchool(false)
      setShowAddStopModal(false)
    } catch (err) {
      setStopError(err.message || 'Failed to add stop.')
    } finally {
      setSavingStop(false)
    }
  }

  async function handleMoveStop(route, stopIndex, delta) {
    const stopsList = [...(route.stops || [])]
    const targetIndex = stopIndex + delta
    if (targetIndex < 0 || targetIndex >= stopsList.length) return

    const temp = stopsList[stopIndex]
    stopsList[stopIndex] = stopsList[targetIndex]
    stopsList[targetIndex] = temp

    try {
      await reorderStops(route.id, stopsList)
      setToastMsg(`Stop order updated for ${route.name}.`)
    } catch (err) {
      alert(err.message || 'Failed to reorder stops.')
    }
  }

  async function handleSaveQuickChange() {
    if (!quickChangeBus) return
    setSavingChange(true)
    try {
      const currentRouteId = changeType === 'route' ? changeTargetId : quickChangeBus.routeId
      const currentDriverId = changeType === 'driver' ? (changeTargetId || null) : quickChangeBus.driverProfileId

      if (!currentRouteId) {
        throw new Error('A bus must have an assigned route.')
      }

      await assignBusToRouteAndDriver({
        busId: quickChangeBus.id,
        routeId: currentRouteId,
        driverProfileId: currentDriverId,
      })

      setToastMsg(`Updated ${changeType} for ${quickChangeBus.name || `Bus ${quickChangeBus.busNumber}`}.`)
      setQuickChangeBus(null)
      setChangeType(null)
      setChangeTargetId('')
    } catch (err) {
      alert(err.message || 'Failed to update assignment.')
    } finally {
      setSavingChange(false)
    }
  }

  async function handleConfirmDeleteBus() {
    if (!busToDelete) return
    setDeleting(true)
    try {
      await deleteBus(busToDelete.id)
      setToastMsg(`Vehicle ${busToDelete.busNumber} decommissioned from fleet.`)
      setBusToDelete(null)
    } catch (err) {
      alert(err.message || 'Failed to remove vehicle.')
    } finally {
      setDeleting(false)
    }
  }

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

  async function handleInitialize() {
    setInitLoading(true)
    try {
      await initializeDefaultRoutesAndBuses()
      setToastMsg('Standard transit routes, stops, and vehicles created successfully.')
    } catch (err) {
      alert(err.message || 'Failed to initialize fleet.')
    } finally {
      setInitLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0D9488] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Toast Alert */}
      {toastMsg && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-semibold text-emerald-900 shadow-2xs">
          <div className="flex items-center gap-2">
            <span className="text-[#0D9488] font-bold">✓</span>
            <span>{toastMsg}</span>
          </div>
          <button onClick={() => setToastMsg(null)} className="text-emerald-700 hover:text-emerald-900 font-bold ml-4">✕</button>
        </div>
      )}

      {/* Operational Header & Action Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033]">Fleet &amp; Routes</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Vehicle registration, driver pairings, and scheduled transit route sequences.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowAddRouteModal(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#172033] hover:bg-slate-50 transition-colors shadow-2xs"
          >
            <span className="text-sm font-bold leading-none text-[#64748B]">＋</span>
            <span>New Route</span>
          </button>
          <button
            type="button"
            onClick={() => setShowAddBusModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0F766E] transition-colors shadow-2xs"
          >
            <span className="text-sm font-bold leading-none">＋</span>
            <span>Register Vehicle</span>
          </button>
        </div>
      </div>

      {/* Operational Readiness Ribbon */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#E2E8F0] bg-white p-3.5 text-xs">
        <div className="flex flex-wrap items-center gap-4 text-[#64748B]">
          <span className="flex items-center gap-1.5">
            <span className="font-bold text-[#172033]">{totalBuses}</span>
            <span>Vehicles</span>
          </span>
          <span className="text-[#CBD5E1]">|</span>
          <span className="flex items-center gap-1.5">
            <span className="font-bold text-[#172033]">{totalRoutes}</span>
            <span>Routes</span>
          </span>
          <span className="text-[#CBD5E1]">|</span>
          <span className="flex items-center gap-1.5">
            <span className="font-bold text-[#172033]">{totalDrivers}</span>
            <span>Assigned Drivers</span>
          </span>
        </div>

        {/* Operational Health Badges */}
        <div className="flex items-center gap-2">
          {unassignedBuses.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 border border-amber-200">
              <span>⚠️</span>
              <span>{unassignedBuses.length} {unassignedBuses.length === 1 ? 'vehicle needs' : 'vehicles need'} assignment</span>
            </span>
          ) : totalBuses > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
              <span>All vehicles fully routed</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* Guided Empty State: When no buses or routes exist */}
      {totalBuses === 0 && totalRoutes === 0 ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-left shadow-2xs">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-2 rounded-md bg-[#E6F4F1] px-2.5 py-1 text-[11px] font-bold text-[#0D9488]">
              Transit Setup Guide
            </div>
            <h2 className="text-lg font-bold text-[#172033] mt-2">Set Up Your School's Transportation Network</h2>
            <p className="text-xs text-[#64748B] mt-1 leading-relaxed">
              Before students can be assigned to stops and drivers can track trips, configure your school's transit infrastructure:
            </p>

            <div className="mt-6 flex flex-col gap-3">
              <div className="flex items-start gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1D3557] text-white text-xs font-bold">1</span>
                <div>
                  <p className="text-xs font-bold text-[#172033]">Register Vehicles</p>
                  <p className="text-[11px] text-[#64748B]">Add bus identifiers, plate numbers, and passenger capacity limits.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1D3557] text-white text-xs font-bold">2</span>
                <div>
                  <p className="text-xs font-bold text-[#172033]">Pair Drivers</p>
                  <p className="text-[11px] text-[#64748B]">Assign certified bus drivers to specific buses and routes for trip logging.</p>
                </div>
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1D3557] text-white text-xs font-bold">3</span>
                <div>
                  <p className="text-xs font-bold text-[#172033]">Configure Route Stops</p>
                  <p className="text-[11px] text-[#64748B]">Establish sequential pickup landmarks (Bole, Kazanchis, Piassa) leading to campus.</p>
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAddBusModal(true)}
                className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0F766E] transition-colors shadow-2xs"
              >
                + Register First Vehicle
              </button>
              <button
                type="button"
                disabled={initLoading}
                onClick={handleInitialize}
                className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#172033] hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-2xs"
              >
                {initLoading ? 'Configuring Network…' : '⚡ 1-Click Transit Setup (Bole & Kazanchis)'}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Segmented View Switcher */}
          <div className="flex items-center gap-1 border-b border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => setActiveTab('fleet')}
              className={
                'relative flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ' +
                (activeTab === 'fleet'
                  ? 'border-[#0D9488] text-[#0D9488]'
                  : 'border-transparent text-[#64748B] hover:text-[#172033]')
              }
            >
              <span>Fleet Inventory &amp; Drivers</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[#64748B]">
                {buses.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('routes')}
              className={
                'relative flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors ' +
                (activeTab === 'routes'
                  ? 'border-[#0D9488] text-[#0D9488]'
                  : 'border-transparent text-[#64748B] hover:text-[#172033]')
              }
            >
              <span>Routes &amp; Stop Sequences</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[#64748B]">
                {routes.length}
              </span>
            </button>
          </div>

          {/* TAB 1: FLEET INVENTORY & DRIVER PAIRINGS */}
          {activeTab === 'fleet' && (
            <div className="flex flex-col gap-4">
              <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-2xs">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                        <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Vehicle / Unit</th>
                        <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">License Plate</th>
                        <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Assigned Driver</th>
                        <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Assigned Route</th>
                        <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Operational Status</th>
                        <th className="py-3 px-4 text-right font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {buses.length === 0 ? (
                        <tr>
                          <td colSpan="6" className="py-8 text-center text-xs text-[#64748B]">
                            No vehicles registered. Click <strong>+ Register Vehicle</strong> to add to fleet.
                          </td>
                        </tr>
                      ) : (
                        buses.map((bus) => {
                          const assignedRoute = routes.find((r) => r.id === bus.routeId)
                          const hasDriver = Boolean(bus.driverName)
                          const hasRoute = Boolean(assignedRoute)
                          const isFullyOperational = hasDriver && hasRoute

                          return (
                            <tr key={bus.id} className="hover:bg-[#F8FAFC]/80 transition-colors">
                              {/* Vehicle / Unit */}
                              <td className="py-3.5 px-4">
                                <div className="flex items-center gap-2.5">
                                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#E6F4F1] text-[#0D9488] font-bold text-xs border border-[#0D9488]/20">
                                    🚌
                                  </div>
                                  <div>
                                    <p className="font-bold text-[#172033] text-xs">
                                      {bus.name || `Bus ${bus.busNumber}`}
                                    </p>
                                    <p className="text-[11px] text-[#64748B]">
                                      {bus.capacity || 32} Passenger Seats
                                    </p>
                                  </div>
                                </div>
                              </td>

                              {/* License Plate */}
                              <td className="py-3.5 px-4 font-mono font-medium text-[#172033]">
                                <span className="inline-block rounded border border-[#E2E8F0] bg-slate-50 px-2 py-0.5 text-[11px]">
                                  {bus.plateNumber || 'Pending Plate'}
                                </span>
                              </td>

                              {/* Assigned Driver */}
                              <td className="py-3.5 px-4">
                                {hasDriver ? (
                                  <div>
                                    <p className="font-semibold text-[#172033]">{bus.driverName}</p>
                                    <p className="text-[11px] text-[#64748B] font-mono">{bus.driverPhone || 'No direct phone'}</p>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQuickChangeBus(bus)
                                      setChangeType('driver')
                                      setChangeTargetId('')
                                    }}
                                    className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                                  >
                                    <span>⚠️</span>
                                    <span>Assign Driver</span>
                                  </button>
                                )}
                              </td>

                              {/* Assigned Route */}
                              <td className="py-3.5 px-4">
                                {hasRoute ? (
                                  <div>
                                    <p className="font-semibold text-[#172033]">{assignedRoute.name}</p>
                                    <p className="text-[11px] text-[#64748B]">
                                      Departs: {assignedRoute.startTime || '06:45 AM'} · {assignedRoute.stops?.length || 0} stops
                                    </p>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQuickChangeBus(bus)
                                      setChangeType('route')
                                      setChangeTargetId('')
                                    }}
                                    className="inline-flex items-center gap-1 rounded bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-800 border border-amber-200 hover:bg-amber-100 transition-colors"
                                  >
                                    <span>⚠️</span>
                                    <span>Assign Route</span>
                                  </button>
                                )}
                              </td>

                              {/* Operational Status */}
                              <td className="py-3.5 px-4">
                                {isFullyOperational ? (
                                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
                                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                                    <span>Operational</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    <span>Requires Setup</span>
                                  </span>
                                )}
                              </td>

                              {/* Actions */}
                              <td className="py-3.5 px-4 text-right">
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQuickChangeBus(bus)
                                      setChangeType('driver')
                                      setChangeTargetId(bus.driverProfileId || '')
                                    }}
                                    className="rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-semibold text-[#172033] hover:bg-slate-50 transition-colors"
                                    title="Reassign driver"
                                  >
                                    Driver
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setQuickChangeBus(bus)
                                      setChangeType('route')
                                      setChangeTargetId(bus.routeId || '')
                                    }}
                                    className="rounded border border-[#E2E8F0] bg-white px-2 py-1 text-[11px] font-semibold text-[#172033] hover:bg-slate-50 transition-colors"
                                    title="Reassign route"
                                  >
                                    Route
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setBusToDelete(bus)}
                                    className="rounded border border-red-200 bg-white px-2 py-1 text-[11px] font-semibold text-[#DC2626] hover:bg-red-50 transition-colors"
                                    title="Decommission vehicle"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: ROUTES & STOP SEQUENCES (Operational Split View) */}
          {activeTab === 'routes' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
              {/* Left Column: Route Roster (Master List) */}
              <div className="lg:col-span-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#64748B]">Active Routes</h3>
                  <button
                    type="button"
                    onClick={() => setShowAddRouteModal(true)}
                    className="text-xs font-bold text-[#0D9488] hover:underline"
                  >
                    + Add Route
                  </button>
                </div>

                <div className="flex flex-col gap-2">
                  {routes.length === 0 ? (
                    <div className="rounded-lg border border-[#E2E8F0] bg-white p-4 text-center text-xs text-[#64748B]">
                      No routes defined yet.
                    </div>
                  ) : (
                    routes.map((route) => {
                      const isSelected = activeRoute?.id === route.id
                      const assignedBus = buses.find((b) => b.routeId === route.id)
                      const stopCount = route.stops?.length || 0

                      return (
                        <button
                          key={route.id}
                          type="button"
                          onClick={() => setSelectedRouteId(route.id)}
                          className={
                            'w-full text-left rounded-lg border p-3 transition-all ' +
                            (isSelected
                              ? 'border-[#0D9488] bg-[#E6F4F1]/40 shadow-xs ring-1 ring-[#0D9488]'
                              : 'border-[#E2E8F0] bg-white hover:border-[#CBD5E1]')
                          }
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[#172033] text-xs">{route.name}</span>
                            <span className="font-mono text-[11px] font-semibold text-[#64748B]">
                              {route.startTime || '06:45'}
                            </span>
                          </div>

                          <div className="mt-2 flex items-center justify-between text-[11px] text-[#64748B]">
                            <span>
                              {assignedBus ? `🚌 Bus ${assignedBus.busNumber}` : '⚠️ No vehicle linked'}
                            </span>
                            <span className="font-medium">
                              {stopCount} {stopCount === 1 ? 'stop' : 'stops'}
                            </span>
                          </div>
                        </button>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Stop Sequences Detail */}
              <div className="lg:col-span-8">
                {activeRoute ? (
                  <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 shadow-2xs">
                    {/* Route Detail Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#E2E8F0] pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h2 className="text-base font-bold text-[#172033]">{activeRoute.name}</h2>
                          <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-[#64748B]">
                            Departure: {activeRoute.startTime || '06:45 AM'}
                          </span>
                        </div>
                        <p className="text-xs text-[#64748B] mt-0.5">
                          Sequential pickup timeline. Vehicles follow this exact order from first stop to school.
                        </p>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {/* Direction Toggle */}
                        <div className="inline-flex rounded-lg border border-[#E2E8F0] bg-slate-50 p-0.5 text-xs">
                          <button
                            type="button"
                            onClick={() => setDirection('Morning')}
                            className={
                              'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
                              (direction === 'Morning'
                                ? 'bg-white text-[#172033] shadow-xs'
                                : 'text-[#64748B] hover:text-[#172033]')
                            }
                          >
                            Morning (To School)
                          </button>
                          <button
                            type="button"
                            onClick={() => setDirection('Afternoon')}
                            className={
                              'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
                              (direction === 'Afternoon'
                                ? 'bg-white text-[#172033] shadow-xs'
                                : 'text-[#64748B] hover:text-[#172033]')
                            }
                          >
                            Afternoon (Return)
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setStopRouteId(activeRoute.id)
                            setShowAddStopModal(true)
                          }}
                          className="flex items-center gap-1 rounded-lg bg-[#0D9488] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#0F766E] transition-colors shadow-2xs"
                        >
                          <span>＋ Add Stop</span>
                        </button>
                      </div>
                    </div>

                    {/* Sequential Stop Timeline */}
                    <div className="mt-5">
                      {(!activeRoute.stops || activeRoute.stops.length === 0) ? (
                        <div className="rounded-lg border border-dashed border-[#CBD5E1] p-8 text-center text-xs text-[#64748B]">
                          <p className="font-semibold text-[#172033]">No stops configured for {activeRoute.name}</p>
                          <p className="mt-1">Add sequential landmarks (e.g. Bole Medhanealem, Atlas, Olympia) to map pickup locations.</p>
                          <button
                            type="button"
                            onClick={() => {
                              setStopRouteId(activeRoute.id)
                              setShowAddStopModal(true)
                            }}
                            className="mt-3 rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0F766E]"
                          >
                            + Add First Stop
                          </button>
                        </div>
                      ) : (
                        <div className="relative pl-6 space-y-3 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-[2px] before:bg-[#E2E8F0]">
                          {(direction === 'Morning' ? activeRoute.stops : [...activeRoute.stops].reverse()).map((stop, index, arr) => {
                            const isFirst = index === 0
                            const isLast = index === arr.length - 1
                            const isCampus = stop.is_school || stop.isSchool

                            return (
                              <div
                                key={stop.id}
                                className="relative flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white p-3 hover:border-[#CBD5E1] transition-colors"
                              >
                                {/* Bullet indicator on the line */}
                                <div
                                  className={
                                    'absolute -left-6 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ' +
                                    (isCampus
                                      ? 'bg-[#1D3557] text-white ring-4 ring-white'
                                      : 'bg-[#0D9488] text-white ring-4 ring-white')
                                  }
                                >
                                  {isCampus ? '🏫' : index + 1}
                                </div>

                                <div className="min-w-0 pr-3">
                                  <div className="flex items-center gap-2">
                                    <p className="font-bold text-[#172033] text-xs truncate">
                                      {stop.name}
                                    </p>
                                    {isCampus && (
                                      <span className="rounded bg-[#E6F4F1] px-1.5 py-0.5 text-[10px] font-bold text-[#0D9488]">
                                        Destination / Campus Gate
                                      </span>
                                    )}
                                    {isFirst && !isCampus && (
                                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-[#64748B]">
                                        Route Origin
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[11px] text-[#64748B] mt-0.5 font-mono">
                                    Lat: {Number(stop.lat || 9.02).toFixed(4)}, Lng: {Number(stop.lng || 38.75).toFixed(4)}
                                  </p>
                                </div>

                                {/* Reordering & Remove Controls */}
                                <div className="flex items-center gap-1 shrink-0">
                                  {direction === 'Morning' && (
                                    <>
                                      <button
                                        type="button"
                                        disabled={isFirst}
                                        onClick={() => handleMoveStop(activeRoute, index, -1)}
                                        className="flex h-7 w-7 items-center justify-center rounded border border-[#E2E8F0] text-xs text-[#64748B] hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none"
                                        title="Move earlier in pickup sequence"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        type="button"
                                        disabled={isLast}
                                        onClick={() => handleMoveStop(activeRoute, index, 1)}
                                        className="flex h-7 w-7 items-center justify-center rounded border border-[#E2E8F0] text-xs text-[#64748B] hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none"
                                        title="Move later in pickup sequence"
                                      >
                                        ↓
                                      </button>
                                    </>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setStopToDelete(stop)}
                                    className="flex h-7 w-7 items-center justify-center rounded border border-red-200 text-xs text-[#DC2626] hover:bg-red-50 ml-1"
                                    title="Remove stop"
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-xs text-[#64748B]">
                    Select a route from the list to manage stop sequences.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* 1. Add Vehicle Modal */}
      {showAddBusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E2E8F0]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#172033]">Register New Vehicle</h3>
                <p className="text-xs text-[#64748B]">Add a bus to the school transit fleet.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddBusModal(false)}
                className="text-[#64748B] hover:text-[#172033]"
              >
                ✕
              </button>
            </div>

            {busError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-[#DC2626]">
                ✕ {busError}
              </div>
            )}

            <form onSubmit={handleAddBusSubmit} className="mt-4 flex flex-col gap-3.5">
              <div>
                <label className="text-xs font-bold text-[#172033]">Vehicle / Bus Number *</label>
                <input
                  type="text"
                  required
                  value={busNumber}
                  onChange={(e) => setBusNumber(e.target.value)}
                  placeholder="e.g. Bus 01, Bus A"
                  className={INPUT_CLASS}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-[#172033]">Plate Number *</label>
                  <input
                    type="text"
                    required
                    value={plateNumber}
                    onChange={(e) => setPlateNumber(e.target.value)}
                    placeholder="e.g. 3-AA-12345"
                    className={INPUT_CLASS}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-[#172033]">Passenger Capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={capacity}
                    onChange={(e) => setCapacity(e.target.value)}
                    className={INPUT_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-[#172033]">Assign to Route (Optional)</label>
                <select
                  value={assignRouteId}
                  onChange={(e) => setAssignRouteId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">-- No route assigned now --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.startTime || '06:45'})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-[#172033]">Assign Driver (Optional)</label>
                <select
                  value={assignDriverId}
                  onChange={(e) => setAssignDriverId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">-- No driver assigned now --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name} ({d.phone || 'No phone'})</option>
                  ))}
                </select>
              </div>

              <div className="mt-3 flex justify-end gap-2.5 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAddBusModal(false)}
                  className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBus}
                  className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
                >
                  {savingBus ? 'Registering…' : 'Register Vehicle'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Add Route Modal */}
      {showAddRouteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E2E8F0]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#172033]">Create Transit Route</h3>
                <p className="text-xs text-[#64748B]">Define a morning and afternoon bus journey.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddRouteModal(false)}
                className="text-[#64748B] hover:text-[#172033]"
              >
                ✕
              </button>
            </div>

            {routeError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-[#DC2626]">
                ✕ {routeError}
              </div>
            )}

            <form onSubmit={handleAddRouteSubmit} className="mt-4 flex flex-col gap-3.5">
              <div>
                <label className="text-xs font-bold text-[#172033]">Route Name *</label>
                <input
                  type="text"
                  required
                  value={routeName}
                  onChange={(e) => setRouteName(e.target.value)}
                  placeholder="e.g. Bole - Kazanchis Express"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#172033]">Morning Departure Time *</label>
                <input
                  type="time"
                  required
                  value={routeStartTime}
                  onChange={(e) => setRouteStartTime(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>

              <div className="mt-3 flex justify-end gap-2.5 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAddRouteModal(false)}
                  className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingRoute}
                  className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
                >
                  {savingRoute ? 'Creating…' : 'Create Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 3. Add Stop Modal */}
      {showAddStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#E2E8F0]">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <h3 className="text-base font-bold text-[#172033]">Add Stop to Route</h3>
                <p className="text-xs text-[#64748B]">Add a pickup stop or school destination to the sequence.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStopModal(false)}
                className="text-[#64748B] hover:text-[#172033]"
              >
                ✕
              </button>
            </div>

            {stopError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-[#DC2626]">
                ✕ {stopError}
              </div>
            )}

            <form onSubmit={handleAddStopSubmit} className="mt-4 flex flex-col gap-3.5">
              <div>
                <label className="text-xs font-bold text-[#172033]">Target Route *</label>
                <select
                  value={stopRouteId || activeRoute?.id || ''}
                  onChange={(e) => setStopRouteId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-[#172033]">Stop Name or Landmark *</label>
                <input
                  type="text"
                  required
                  value={stopName}
                  onChange={(e) => setStopName(e.target.value)}
                  placeholder="e.g. Bole Medhanealem Gate, Olympia Square"
                  className={INPUT_CLASS}
                />
              </div>

              {/* Quick Landmark Chips */}
              <div>
                <span className="text-[11px] font-semibold text-[#64748B]">Quick-Pick Common Landmarks:</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {QUICK_CHIP_LANDMARKS.slice(0, 8).map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => setStopName(chip)}
                      className="rounded border border-[#E2E8F0] bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-[#172033] hover:border-[#0D9488] hover:bg-[#E6F4F1] transition-colors"
                    >
                      {chip}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  id="isCampus"
                  type="checkbox"
                  checked={stopIsSchool}
                  onChange={(e) => setStopIsSchool(e.target.checked)}
                  className="h-4 w-4 rounded border-[#E2E8F0] text-[#0D9488] focus:ring-[#0D9488]"
                />
                <label htmlFor="isCampus" className="text-xs font-semibold text-[#172033] cursor-pointer">
                  This stop is the School Campus Gate (Final Morning Destination)
                </label>
              </div>

              <div className="mt-3 flex justify-end gap-2.5 pt-2 border-t border-[#E2E8F0]">
                <button
                  type="button"
                  onClick={() => setShowAddStopModal(false)}
                  className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStop}
                  className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
                >
                  {savingStop ? 'Adding…' : 'Add Stop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 4. Quick Change Assignment Popover */}
      {quickChangeBus && changeType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-[#E2E8F0]">
            <h3 className="text-sm font-bold text-[#172033]">
              Assign {changeType === 'driver' ? 'Driver' : 'Route'} to {quickChangeBus.name || `Bus ${quickChangeBus.busNumber}`}
            </h3>
            <p className="text-xs text-[#64748B] mt-0.5">
              Select the active {changeType} to pair with this vehicle.
            </p>

            <div className="mt-4">
              {changeType === 'driver' ? (
                <select
                  value={changeTargetId}
                  onChange={(e) => setChangeTargetId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">-- No driver assigned --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name} ({d.phone || 'No phone'})</option>
                  ))}
                </select>
              ) : (
                <select
                  value={changeTargetId}
                  onChange={(e) => setChangeTargetId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">-- Select route --</option>
                  {routes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name} ({r.startTime || '06:45'})</option>
                  ))}
                </select>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
              <button
                type="button"
                onClick={() => {
                  setQuickChangeBus(null)
                  setChangeType(null)
                }}
                className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingChange}
                onClick={handleSaveQuickChange}
                className="rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
              >
                {savingChange ? 'Saving…' : 'Save Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. Delete Vehicle Confirmation */}
      {busToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-red-200">
            <h3 className="text-sm font-bold text-[#DC2626]">Decommission Vehicle</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Are you sure you want to remove <strong>Bus {busToDelete.busNumber}</strong> ({busToDelete.plateNumber || 'No plate'}) from the school fleet? This will unassign its route pairing.
            </p>

            <div className="mt-4 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
              <button
                type="button"
                onClick={() => setBusToDelete(null)}
                className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDeleteBus}
                className="rounded-lg bg-[#DC2626] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Removing…' : 'Remove Vehicle'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. Delete Stop Confirmation */}
      {stopToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-red-200">
            <h3 className="text-sm font-bold text-[#DC2626]">Remove Transit Stop</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Are you sure you want to remove stop <strong>"{stopToDelete.name}"</strong>? Students assigned to this stop will need reassignment.
            </p>

            <div className="mt-4 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
              <button
                type="button"
                onClick={() => setStopToDelete(null)}
                className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDeleteStop}
                className="rounded-lg bg-[#DC2626] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Removing…' : 'Remove Stop'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
