import { useState, useRef, useEffect } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useManagerData } from '../lib/useManagerData.js'
import { searchEthiopiaLandmarks, lookupEthiopiaLocation } from '../lib/ethiopiaLandmarks.js'

// Custom Leaflet DivIcon for stop placement (offline-safe, no external image assets required)
const STOP_PIN_ICON = L.divIcon({
  className: 'custom-stop-pin',
  html: `<div style="background-color:#0D9488;width:32px;height:32px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.3);border:2px solid white;cursor:grab;"><span style="transform:rotate(45deg);font-size:14px;color:white;">📍</span></div>`,
  iconSize: [32, 32],
  iconAnchor: [16, 32],
})

function MapCenterController({ center, zoom = 14 }) {
  const map = useMap()
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.flyTo(center, zoom, { duration: 0.6 })
    }
  }, [center?.[0], center?.[1], zoom, map])
  return null
}

const INPUT_CLASS = 'h-10 w-full rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs text-[#172033] placeholder:text-[#94A3B8] focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] focus:outline-none transition-colors'

export default function BusesRoutes() {
  const {
    buses,
    routes,
    drivers,
    todayTrips,
    loading,
    addBus,
    addRoute,
    updateRoute,
    deleteRoute,
    addStopToRoute,
    deleteStop,
    reorderStops,
    deleteBus,
    assignBusToRouteAndDriver,
    provisionDriver,
    initializeDefaultRoutesAndBuses,
  } = useManagerData()

  // Navigation Sub-Tabs: 'fleet' | 'routes' | 'drivers'
  const [activeTab, setActiveTab] = useState('fleet')
  const [expandedBusId, setExpandedBusId] = useState(null)
  const [direction, setDirection] = useState('Morning')
  const [toastMsg, setToastMsg] = useState(null)
  const [initLoading, setInitLoading] = useState(false)

  // ── 1. Guided Add Bus Workflow (4-Step Progressive Stepper) ──
  const [showAddBusWizard, setShowAddBusWizard] = useState(false)
  const [wizardStep, setWizardStep] = useState(1) // 1..4
  // Step 1: Bus Details
  const [newBusNumber, setNewBusNumber] = useState('')
  const [newPlateNumber, setNewPlateNumber] = useState('')
  const [newCapacity, setNewCapacity] = useState('30')
  // Step 2: Driver Selection / Creation
  const [wizardDriverOption, setWizardDriverOption] = useState('existing') // 'existing' | 'new' | 'skip'
  const [wizardDriverId, setWizardDriverId] = useState('')
  const [newDriverName, setNewDriverName] = useState('')
  const [newDriverPhone, setNewDriverPhone] = useState('')
  // Step 3: Route Selection / Creation
  const [wizardRouteOption, setWizardRouteOption] = useState('existing') // 'existing' | 'new' | 'skip'
  const [wizardRouteId, setWizardRouteId] = useState('')
  const [newRouteName, setNewRouteName] = useState('')
  const [newRouteStartTime, setNewRouteStartTime] = useState('06:45')
  const [savingWizard, setSavingWizard] = useState(false)
  const [wizardError, setWizardError] = useState(null)

  // ── 2. Stop Creation Experience (Search + Embedded Map Pin) ──
  const [showAddStopModal, setShowAddStopModal] = useState(false)
  const [stopTargetRouteId, setStopTargetRouteId] = useState(null)
  const [stopSearchQuery, setStopSearchQuery] = useState('')
  const [stopSuggestions, setStopSuggestions] = useState([])
  const [confirmedStopName, setConfirmedStopName] = useState('')
  const [selectedCoords, setSelectedCoords] = useState([9.0125, 38.7750]) // Default Atlas Addis Ababa
  const [isSchoolDestination, setIsSchoolDestination] = useState(false)
  const [savingStop, setSavingStop] = useState(false)
  const [stopModalError, setStopModalError] = useState(null)

  // ── 3. Quick Change Drawer / Popover (Driver or Route) ──
  const [quickChangeBus, setQuickChangeBus] = useState(null)
  const [quickChangeType, setQuickChangeType] = useState(null) // 'driver' | 'route'
  const [quickTargetId, setQuickTargetId] = useState('')
  const [savingQuickChange, setSavingQuickChange] = useState(false)

  // ── 4. Independent Route Creation Modal ──
  const [showNewRouteModal, setShowNewRouteModal] = useState(false)
  const [standaloneRouteName, setStandaloneRouteName] = useState('')
  const [standaloneRouteTime, setStandaloneRouteTime] = useState('06:45')
  const [savingStandaloneRoute, setSavingStandaloneRoute] = useState(false)

  // ── 5. Independent Driver Creation Modal ──
  const [showNewDriverModal, setShowNewDriverModal] = useState(false)
  const [standaloneDriverName, setStandaloneDriverName] = useState('')
  const [standaloneDriverPhone, setStandaloneDriverPhone] = useState('')
  const [savingStandaloneDriver, setSavingStandaloneDriver] = useState(false)

  // ── 6. Delete Confirmations ──
  const [busToDelete, setBusToDelete] = useState(null)
  const [stopToDelete, setStopToDelete] = useState(null)
  const [routeToDelete, setRouteToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  // Operational Counts
  const totalBuses = buses.length
  const readyBuses = buses.filter((b) => Boolean(b.driverName && b.routeId))
  const needsSetupBuses = buses.filter((b) => !b.driverName || !b.routeId)

  // Auto-expand first bus if none expanded
  useEffect(() => {
    if (buses.length > 0 && expandedBusId === null) {
      setExpandedBusId(buses[0].id)
    }
  }, [buses, expandedBusId])

  // Autocomplete suggestions as user types in stop search
  useEffect(() => {
    if (showAddStopModal) {
      const results = searchEthiopiaLandmarks(stopSearchQuery)
      setStopSuggestions(results)
    }
  }, [stopSearchQuery, showAddStopModal])

  // ── Handlers ──

  // Reset Add Bus Stepper
  function openAddBusWizard() {
    setWizardStep(1)
    setNewBusNumber('')
    setNewPlateNumber('')
    setNewCapacity('30')
    setWizardDriverOption(drivers.length > 0 ? 'existing' : 'new')
    setWizardDriverId(drivers[0]?.id || '')
    setNewDriverName('')
    setNewDriverPhone('')
    setWizardRouteOption(routes.length > 0 ? 'existing' : 'new')
    setWizardRouteId(routes[0]?.id || '')
    setNewRouteName('')
    setNewRouteStartTime('06:45')
    setWizardError(null)
    setShowAddBusWizard(true)
  }

  // Execute Guided Add Bus Submission (Can save complete or incomplete setups)
  async function handleWizardSubmit(e) {
    if (e) e.preventDefault()
    setWizardError(null)
    setSavingWizard(true)

    try {
      // 1. Create Bus
      if (!newBusNumber.trim()) throw new Error('Vehicle name/number is required.')
      const busRes = await addBus({
        busNumber: newBusNumber.trim(),
        plateNumber: newPlateNumber.trim().toUpperCase() || '3-ET-1000',
        capacity: Number(newCapacity) || 30,
      })
      const createdBus = busRes.bus

      // 2. Handle Driver if specified
      let finalDriverId = null
      if (wizardDriverOption === 'existing' && wizardDriverId) {
        finalDriverId = wizardDriverId
      } else if (wizardDriverOption === 'new' && newDriverName.trim()) {
        const dRes = await provisionDriver({
          fullName: newDriverName.trim(),
          phone: newDriverPhone.trim() || undefined,
          tempPassword: 'Driver' + Math.floor(1000 + Math.random() * 9000) + '!',
        })
        finalDriverId = dRes.user_id
      }

      // 3. Handle Route if specified
      let finalRouteId = null
      if (wizardRouteOption === 'existing' && wizardRouteId) {
        finalRouteId = wizardRouteId
      } else if (wizardRouteOption === 'new' && newRouteName.trim()) {
        const rRes = await addRoute({
          name: newRouteName.trim(),
          startTime: newRouteStartTime || '06:45',
        })
        finalRouteId = rRes.route?.id
      }

      // 4. Link Assignment if route is selected
      if (finalRouteId && createdBus?.id) {
        await assignBusToRouteAndDriver({
          busId: createdBus.id,
          routeId: finalRouteId,
          driverProfileId: finalDriverId || null,
        })
      }

      setToastMsg(`Vehicle ${newBusNumber} added to fleet successfully!`)
      setShowAddBusWizard(false)
      if (createdBus?.id) setExpandedBusId(createdBus.id)
    } catch (err) {
      setWizardError(err.message || 'Failed to save vehicle setup.')
    } finally {
      setSavingWizard(false)
    }
  }

  // Open Stop Creation Modal for a route
  function openAddStopModalForRoute(routeId) {
    setStopTargetRouteId(routeId)
    setStopSearchQuery('')
    setConfirmedStopName('Atlas Hotel Gate')
    setSelectedCoords([9.0125, 38.7750])
    setIsSchoolDestination(false)
    setStopModalError(null)
    setShowAddStopModal(true)
  }

  // Handle Location Suggestion Click
  function handleSelectLandmark(landmark) {
    setConfirmedStopName(landmark.name)
    setStopSearchQuery(landmark.name)
    if (landmark.lat && landmark.lng) {
      setSelectedCoords([landmark.lat, landmark.lng])
    }
  }

  // Execute Add Stop Confirmation
  async function handleConfirmAddStop(e) {
    e.preventDefault()
    if (!stopTargetRouteId) return
    setStopModalError(null)
    setSavingStop(true)

    try {
      const targetRoute = routes.find((r) => r.id === stopTargetRouteId)
      const nextOrder = (targetRoute?.stops?.length || 0) + 1

      await addStopToRoute({
        routeId: stopTargetRouteId,
        name: confirmedStopName.trim() || stopSearchQuery.trim() || 'Scheduled Stop',
        stopOrder: nextOrder,
        lat: selectedCoords[0],
        lng: selectedCoords[1],
        isSchool: isSchoolDestination,
      })

      setToastMsg(`Added stop "${confirmedStopName || stopSearchQuery}" to route.`)
      setShowAddStopModal(false)
    } catch (err) {
      setStopModalError(err.message || 'Failed to save stop.')
    } finally {
      setSavingStop(false)
    }
  }

  // Move Stop Up or Down in sequence
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

  // Quick Change Driver or Route with Active Trip Protection
  async function handleSaveQuickChange() {
    if (!quickChangeBus) return
    setSavingQuickChange(true)

    try {
      // Check if bus is currently in transit
      const activeTrip = todayTrips.find(
        (t) => t.bus_id === quickChangeBus.id && t.status === 'in_progress'
      )
      if (activeTrip) {
        const proceed = window.confirm(
          `⚠️ WARNING: Bus ${quickChangeBus.busNumber} is currently on an ACTIVE trip on the road! Changing assignments now may disrupt driver navigation and live parent tracking. Proceed anyway?`
        )
        if (!proceed) {
          setSavingQuickChange(false)
          return
        }
      }

      const currentRouteId = quickChangeType === 'route' ? quickTargetId : quickChangeBus.routeId
      const currentDriverId = quickChangeType === 'driver' ? (quickTargetId || null) : quickChangeBus.driverProfileId

      if (!currentRouteId) {
        throw new Error('A vehicle must have an assigned route template.')
      }

      await assignBusToRouteAndDriver({
        busId: quickChangeBus.id,
        routeId: currentRouteId,
        driverProfileId: currentDriverId,
      })

      setToastMsg(`Updated ${quickChangeType} for ${quickChangeBus.name || `Bus ${quickChangeBus.busNumber}`}!`)
      setQuickChangeBus(null)
      setQuickChangeType(null)
      setQuickTargetId('')
    } catch (err) {
      alert(err.message || 'Failed to update assignment.')
    } finally {
      setSavingQuickChange(false)
    }
  }

  // Create Standalone Route
  async function handleCreateStandaloneRoute(e) {
    e.preventDefault()
    setSavingStandaloneRoute(true)
    try {
      const res = await addRoute({
        name: standaloneRouteName.trim(),
        startTime: standaloneRouteTime || '06:45',
      })
      setToastMsg(`Route "${standaloneRouteName}" created successfully!`)
      setShowNewRouteModal(false)
      setStandaloneRouteName('')
      setStandaloneRouteTime('06:45')
      if (res.route?.id) {
        openAddStopModalForRoute(res.route.id)
      }
    } catch (err) {
      alert(err.message || 'Failed to create route.')
    } finally {
      setSavingStandaloneRoute(false)
    }
  }

  // Provision Standalone Driver
  async function handleCreateStandaloneDriver(e) {
    e.preventDefault()
    setSavingStandaloneDriver(true)
    try {
      await provisionDriver({
        fullName: standaloneDriverName.trim(),
        phone: standaloneDriverPhone.trim() || undefined,
        tempPassword: 'Driver' + Math.floor(1000 + Math.random() * 9000) + '!',
      })
      setToastMsg(`Driver "${standaloneDriverName}" provisioned successfully.`)
      setShowNewDriverModal(false)
      setStandaloneDriverName('')
      setStandaloneDriverPhone('')
    } catch (err) {
      alert(err.message || 'Failed to provision driver.')
    } finally {
      setSavingStandaloneDriver(false)
    }
  }

  // Delete Handlers
  async function handleConfirmDeleteBus() {
    if (!busToDelete) return
    setDeleting(true)
    try {
      await deleteBus(busToDelete.id)
      setToastMsg(`Vehicle ${busToDelete.busNumber} removed from fleet.`)
      setBusToDelete(null)
    } catch (err) {
      alert(err.message || 'Failed to remove bus.')
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

  async function handleConfirmDeleteRoute() {
    if (!routeToDelete) return
    setDeleting(true)
    try {
      await deleteRoute(routeToDelete.id)
      setToastMsg(`Route "${routeToDelete.name}" deleted.`)
      setRouteToDelete(null)
    } catch (err) {
      alert(err.message || 'Failed to delete route.')
    } finally {
      setDeleting(false)
    }
  }

  async function handleInitialize() {
    setInitLoading(true)
    try {
      await initializeDefaultRoutesAndBuses()
      setToastMsg('Standard transit routes (Bole & Kazanchis) and vehicles configured successfully!')
    } catch (err) {
      setToastMsg(`Error: ${err.message || 'Failed to initialize fleet.'}`)
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
        <div className={`flex items-center justify-between rounded-lg border px-4 py-2.5 text-xs font-semibold shadow-2xs animate-fadeIn ${
          toastMsg.startsWith('Error:')
            ? 'border-red-200 bg-red-50 text-red-900'
            : 'border-emerald-200 bg-emerald-50 text-emerald-900'
        }`}>
          <div className="flex items-center gap-2">
            <span className={toastMsg.startsWith('Error:') ? 'text-[#DC2626] font-bold text-sm' : 'text-[#0D9488] font-bold'}>
              {toastMsg.startsWith('Error:') ? '⚠' : '✓'}
            </span>
            <span>{toastMsg}</span>
          </div>
          <button onClick={() => setToastMsg(null)} className="hover:opacity-75 font-bold ml-4">✕</button>
        </div>
      )}

      {/* ── Fleet Management Header & Actions ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033]">Fleet Management</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Manage buses, drivers and their route assignments.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {totalBuses === 0 && (
            <button
              type="button"
              disabled={initLoading}
              onClick={handleInitialize}
              className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#172033] hover:bg-slate-50 transition-colors shadow-2xs"
            >
              <span>⚡ 1-Click Setup</span>
            </button>
          )}

          <button
            type="button"
            onClick={openAddBusWizard}
            className="flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E] transition-colors shadow-2xs"
          >
            <span className="text-sm font-bold leading-none">＋</span>
            <span>Add Bus</span>
          </button>
        </div>
      </div>

      {/* ── Sub-Navigation: Fleet | Reusable Routes | Driver Directory ── */}
      <div className="flex items-center gap-1 border-b border-[#E2E8F0]">
        <button
          type="button"
          onClick={() => setActiveTab('fleet')}
          className={
            'relative flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-semibold transition-colors ' +
            (activeTab === 'fleet'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-[#64748B] hover:text-[#172033]')
          }
        >
          <span>School Fleet</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[#64748B]">
            {buses.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('routes')}
          className={
            'relative flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-semibold transition-colors ' +
            (activeTab === 'routes'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-[#64748B] hover:text-[#172033]')
          }
        >
          <span>Reusable Routes</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[#64748B]">
            {routes.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('drivers')}
          className={
            'relative flex items-center gap-2 border-b-2 px-4 py-2 text-xs font-semibold transition-colors ' +
            (activeTab === 'drivers'
              ? 'border-[#0D9488] text-[#0D9488]'
              : 'border-transparent text-[#64748B] hover:text-[#172033]')
          }
        >
          <span>Driver Directory</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[#64748B]">
            {drivers.length}
          </span>
        </button>
      </div>

      {/* ── TAB 1: FLEET-FIRST OVERVIEW (As in User Images 1 & 2) ── */}
      {activeTab === 'fleet' && (
        <div className="flex flex-col gap-4">
          {/* Operational Metrics Ribbon: Total buses | Ready | Needs setup */}
          <div className="flex flex-wrap items-center gap-6 rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs">
            <div>
              <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Total buses</p>
              <p className="text-xl sm:text-2xl font-black text-[#172033] mt-0.5">{totalBuses}</p>
            </div>
            <div className="h-8 w-[1px] bg-[#E2E8F0]" />
            <div>
              <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Ready</p>
              <p className="text-xl sm:text-2xl font-black text-emerald-600 mt-0.5">{readyBuses.length}</p>
            </div>
            <div className="h-8 w-[1px] bg-[#E2E8F0]" />
            <div>
              <p className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">Needs setup</p>
              <p className="text-xl sm:text-2xl font-black text-amber-700 mt-0.5">{needsSetupBuses.length}</p>
            </div>
          </div>

          <div className="flex items-center justify-between text-xs text-[#64748B] px-1 font-medium">
            <span>School fleet</span>
            <span>{totalBuses} registered {totalBuses === 1 ? 'bus' : 'buses'}</span>
          </div>

          {/* Bus Cards List */}
          {buses.length === 0 ? (
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-8 text-center shadow-2xs flex flex-col items-center justify-center gap-3">
              <span className="text-3xl">🚌</span>
              <h3 className="text-sm font-bold text-[#172033]">No buses registered in fleet</h3>
              <p className="text-xs text-[#64748B] max-w-sm">
                Add your school vehicles to begin assigning drivers, routes, and pickup sequences.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  onClick={openAddBusWizard}
                  className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E] transition-colors"
                >
                  + Add First Bus
                </button>
                <button
                  type="button"
                  disabled={initLoading}
                  onClick={handleInitialize}
                  className="rounded-lg border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-[#172033] hover:bg-slate-50 transition-colors"
                >
                  ⚡ 1-Click Transit Setup
                </button>
              </div>
            </div>
          ) : (
            buses.map((bus) => {
              const isExpanded = expandedBusId === bus.id
              const assignedRoute = routes.find((r) => r.id === bus.routeId) || null
              const isReady = Boolean(bus.driverName && assignedRoute)
              const rawStops = assignedRoute?.stops || []
              const orderedStops = direction === 'Morning' ? rawStops : [...rawStops].reverse()
              const activeTrip = todayTrips.find(
                (t) => t.bus_id === bus.id && t.status === 'in_progress'
              )

              // Coordinates for map preview
              const stopPoints = rawStops
                .filter((s) => s.lat && s.lng)
                .map((s) => [s.lat, s.lng])
              const mapCenter = stopPoints.length > 0 ? stopPoints[0] : [9.025, 38.765]

              return (
                <div
                  key={bus.id}
                  className={
                    'rounded-xl border transition-all bg-white shadow-2xs ' +
                    (isExpanded ? 'border-[#0D9488]/40 ring-1 ring-[#0D9488]/20' : 'border-[#E2E8F0] hover:border-[#CBD5E1]')
                  }
                >
                  {/* Compact Header Summary Row */}
                  <div className="p-4 sm:p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-base" aria-hidden="true">🚌</span>
                          <h2 className="text-sm sm:text-base font-bold text-[#172033]">
                            {bus.name || `Bus ${bus.busNumber}`}
                          </h2>
                          {activeTrip ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                              <span>Live on Trip</span>
                            </span>
                          ) : isReady ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
                              Ready
                            </span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 border border-amber-200">
                              Needs setup
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[#64748B] font-mono mt-0.5">
                          Plate: {bus.plateNumber || 'Pending'} · {bus.capacity || 30} seats
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => setExpandedBusId(isExpanded ? null : bus.id)}
                        className="flex items-center gap-1 text-xs font-bold text-[#0D9488] hover:underline"
                      >
                        <span>{isExpanded ? 'Hide details ↑' : 'View details ↓'}</span>
                      </button>
                    </div>

                    {/* Driver & Route Quick Glance */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3 pt-3 border-t border-[#E2E8F0] text-xs">
                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-[#64748B]">Driver</span>
                        {bus.driverName ? (
                          <div className="mt-0.5">
                            <p className="font-bold text-[#172033]">{bus.driverName}</p>
                            <p className="text-[11px] text-[#64748B] font-mono">{bus.driverPhone || 'No phone'}</p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setQuickChangeBus(bus)
                              setQuickChangeType('driver')
                              setQuickTargetId('')
                            }}
                            className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-[#0D9488] hover:underline"
                          >
                            <span>＋ Assign driver</span>
                          </button>
                        )}
                      </div>

                      <div>
                        <span className="text-[10px] uppercase font-bold tracking-wider text-[#64748B]">Assigned Route</span>
                        {assignedRoute ? (
                          <div className="mt-0.5">
                            <p className="font-bold text-[#172033]">{assignedRoute.name}</p>
                            <p className="text-[11px] text-[#64748B]">
                              Morning · {assignedRoute.startTime || '06:45 AM'} ({rawStops.length} stops)
                            </p>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setQuickChangeBus(bus)
                              setQuickChangeType('route')
                              setQuickTargetId('')
                            }}
                            className="mt-0.5 flex items-center gap-1 text-[11px] font-bold text-[#0D9488] hover:underline"
                          >
                            <span>＋ Assign route</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* ── EXPANDABLE DETAILS PANEL (As in User Image 2) ── */}
                  {isExpanded && (
                    <div className="border-t border-[#E2E8F0] bg-[#F8FAFC]/60 p-4 sm:p-5 rounded-b-xl flex flex-col gap-4 animate-fadeIn">
                      {/* Driver & Route Change Links */}
                      <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3.5 rounded-lg border border-[#E2E8F0] text-xs">
                        <div className="flex items-center gap-4">
                          <div>
                            <span className="text-[10px] uppercase font-bold text-[#64748B]">Assigned Driver:</span>
                            <span className="ml-1.5 font-bold text-[#172033]">{bus.driverName || 'None'}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickChangeBus(bus)
                                setQuickChangeType('driver')
                                setQuickTargetId(bus.driverProfileId || '')
                              }}
                              className="ml-2 text-[11px] font-bold text-[#0D9488] hover:underline"
                            >
                              Change driver
                            </button>
                          </div>
                          <span className="text-[#CBD5E1]">|</span>
                          <div>
                            <span className="text-[10px] uppercase font-bold text-[#64748B]">Assigned Route:</span>
                            <span className="ml-1.5 font-bold text-[#172033]">{assignedRoute?.name || 'None'}</span>
                            <button
                              type="button"
                              onClick={() => {
                                setQuickChangeBus(bus)
                                setQuickChangeType('route')
                                setQuickTargetId(bus.routeId || '')
                              }}
                              className="ml-2 text-[11px] font-bold text-[#0D9488] hover:underline"
                            >
                              Change route
                            </button>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setBusToDelete(bus)}
                          className="text-[11px] font-bold text-red-600 hover:text-red-700"
                        >
                          Remove vehicle
                        </button>
                      </div>

                      {/* Stops & Map Layout */}
                      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                        {/* Ordered Stops Timeline */}
                        <div className="lg:col-span-7 flex flex-col gap-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <h3 className="text-xs font-bold uppercase tracking-wider text-[#172033]">
                                Route stops
                              </h3>
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-[#64748B]">
                                {rawStops.length} stops
                              </span>
                            </div>

                            {/* Direction toggle */}
                            <div className="inline-flex rounded-md border border-[#E2E8F0] bg-white p-0.5 text-[11px]">
                              <button
                                type="button"
                                onClick={() => setDirection('Morning')}
                                className={
                                  'rounded px-2 py-0.5 font-semibold transition-colors ' +
                                  (direction === 'Morning' ? 'bg-[#1D3557] text-white' : 'text-[#64748B] hover:text-[#172033]')
                                }
                              >
                                Morning
                              </button>
                              <button
                                type="button"
                                onClick={() => setDirection('Afternoon')}
                                className={
                                  'rounded px-2 py-0.5 font-semibold transition-colors ' +
                                  (direction === 'Afternoon' ? 'bg-[#1D3557] text-white' : 'text-[#64748B] hover:text-[#172033]')
                                }
                              >
                                Afternoon
                              </button>
                            </div>
                          </div>

                          {(!assignedRoute || rawStops.length === 0) ? (
                            <div className="rounded-lg border border-dashed border-[#CBD5E1] bg-white p-6 text-center text-xs text-[#64748B]">
                              <p className="font-semibold text-[#172033]">
                                {!assignedRoute ? 'No route assigned to this bus' : 'No stops configured on this route'}
                              </p>
                              <p className="mt-0.5 text-[11px]">
                                Add stops to define where this bus picks up students.
                              </p>
                              {assignedRoute && (
                                <button
                                  type="button"
                                  onClick={() => openAddStopModalForRoute(assignedRoute.id)}
                                  className="mt-2.5 rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F766E]"
                                >
                                  + Add First Stop
                                </button>
                              )}
                            </div>
                          ) : (
                            <div className="relative pl-6 space-y-2.5 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-[1.5px] before:bg-[#E2E8F0]">
                              {orderedStops.map((stop, sIdx, arr) => {
                                const isFinal = sIdx === arr.length - 1
                                const isCampus = stop.is_school || stop.isSchool

                                return (
                                  <div
                                    key={stop.id}
                                    className="relative flex items-center justify-between rounded-lg border border-[#E2E8F0] bg-white p-2.5 hover:border-[#CBD5E1] transition-colors"
                                  >
                                    {/* Stop sequence bullet */}
                                    <div
                                      className={
                                        'absolute -left-6 top-1/2 -translate-y-1/2 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ring-4 ring-white ' +
                                        (isCampus ? 'bg-[#1D3557] text-white' : 'bg-[#0D9488] text-white')
                                      }
                                    >
                                      {isCampus ? '🏫' : sIdx + 1}
                                    </div>

                                    <div className="min-w-0 pr-2">
                                      <p className="font-bold text-[#172033] text-xs truncate">{stop.name}</p>
                                      <p className="text-[10px] text-[#64748B]">
                                        {isCampus ? 'Final destination / School Campus' : 'Pickup point'}
                                      </p>
                                    </div>

                                    {/* Stop Reorder & Remove */}
                                    <div className="flex items-center gap-1 shrink-0">
                                      {direction === 'Morning' && (
                                        <>
                                          <button
                                            type="button"
                                            disabled={sIdx === 0}
                                            onClick={() => handleMoveStop(assignedRoute, sIdx, -1)}
                                            className="h-6 w-6 rounded border border-[#E2E8F0] text-xs text-[#64748B] hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none"
                                            title="Move earlier"
                                          >
                                            ↑
                                          </button>
                                          <button
                                            type="button"
                                            disabled={isFinal}
                                            onClick={() => handleMoveStop(assignedRoute, sIdx, 1)}
                                            className="h-6 w-6 rounded border border-[#E2E8F0] text-xs text-[#64748B] hover:bg-slate-50 disabled:opacity-30 disabled:pointer-events-none"
                                            title="Move later"
                                          >
                                            ↓
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        onClick={() => setStopToDelete(stop)}
                                        className="h-6 w-6 rounded border border-red-200 text-xs text-[#DC2626] hover:bg-red-50 ml-1"
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

                          {assignedRoute && (
                            <div className="flex items-center justify-between pt-1">
                              <button
                                type="button"
                                onClick={() => openAddStopModalForRoute(assignedRoute.id)}
                                className="text-xs font-bold text-[#0D9488] hover:underline"
                              >
                                + Add stop
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setActiveTab('routes')
                                }}
                                className="text-xs font-semibold text-[#64748B] hover:text-[#172033]"
                              >
                                Edit route template →
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Small Route Map Preview (As in User Image 3) */}
                        <div className="lg:col-span-5 flex flex-col gap-1.5">
                          <span className="text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                            Route Map Preview
                          </span>
                          <div className="relative h-56 w-full rounded-lg border border-[#E2E8F0] overflow-hidden bg-slate-100">
                            {stopPoints.length > 0 ? (
                              <MapContainer
                                center={mapCenter}
                                zoom={13}
                                zoomControl={false}
                                className="h-full w-full"
                              >
                                <MapCenterController center={mapCenter} zoom={13} />
                                <TileLayer
                                  attribution="&copy; OpenStreetMap contributors"
                                  url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                                />
                                {stopPoints.length > 1 && (
                                  <Polyline
                                    positions={stopPoints}
                                    pathOptions={{ color: '#0D9488', weight: 4, dashArray: '5 5' }}
                                  />
                                )}
                                {rawStops.map((st, i) => (
                                  <CircleMarker
                                    key={st.id || i}
                                    center={[st.lat || 9.02, st.lng || 38.76]}
                                    radius={st.is_school ? 9 : 7}
                                    pathOptions={{
                                      color: '#ffffff',
                                      weight: 2,
                                      fillColor: st.is_school ? '#1D3557' : '#0D9488',
                                      fillOpacity: 1,
                                    }}
                                  >
                                    <Tooltip direction="top" offset={[0, -6]}>
                                      {st.name}
                                    </Tooltip>
                                  </CircleMarker>
                                ))}
                              </MapContainer>
                            ) : (
                              <div className="h-full w-full flex items-center justify-center p-4 text-center text-xs text-[#64748B]">
                                Map preview available once stops are added.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}

      {/* ── TAB 2: REUSABLE ROUTE MANAGEMENT (Images 6 & 7) ── */}
      {activeTab === 'routes' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#172033]">Transit Route Templates</h2>
              <p className="text-xs text-[#64748B]">
                Routes are reusable templates. Multiple buses can operate the same route without duplicating stops.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewRouteModal(true)}
              className="rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F766E] shadow-2xs"
            >
              + Create Route
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.length === 0 ? (
              <div className="col-span-2 rounded-xl border border-[#E2E8F0] bg-white p-8 text-center text-xs text-[#64748B]">
                No routes created yet. Click "+ Create Route" to define a school transit route.
              </div>
            ) : (
              routes.map((route) => {
                const assignedBuses = buses.filter((b) => b.routeId === route.id)
                const stops = route.stops || []

                return (
                  <div key={route.id} className="rounded-xl border border-[#E2E8F0] bg-white p-4 shadow-2xs flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-sm font-bold text-[#172033]">{route.name}</h3>
                          <p className="text-xs text-[#64748B] mt-0.5">
                            Morning start: <strong>{route.startTime || '06:45 AM'}</strong> · {stops.length} stops
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRouteToDelete(route)}
                          className="text-xs text-red-500 hover:text-red-700"
                          title="Delete route"
                        >
                          🗑️
                        </button>
                      </div>

                      {/* Buses Assigned to this Route (Can be 1 or multiple buses!) */}
                      <div className="mt-3 rounded-lg bg-[#F8FAFC] border border-[#E2E8F0] p-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                          Assigned Fleet Units:
                        </span>
                        {assignedBuses.length > 0 ? (
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {assignedBuses.map((b) => (
                              <span
                                key={b.id}
                                className="rounded bg-white border border-[#E2E8F0] px-2 py-0.5 text-[11px] font-bold text-[#172033]"
                              >
                                🚌 {b.name || `Bus ${b.busNumber}`} ({b.driverName || 'No driver'})
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="mt-0.5 text-[11px] text-[#64748B] italic">
                            No vehicles currently operating this route.
                          </p>
                        )}
                      </div>

                      {/* Stop Sequence Preview */}
                      <div className="mt-3">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">
                          Stop Sequence:
                        </span>
                        {stops.length > 0 ? (
                          <ul className="mt-1 space-y-1">
                            {stops.map((s, idx) => (
                              <li key={s.id || idx} className="text-xs text-[#172033] flex items-center justify-between">
                                <span className="truncate max-w-[200px]">
                                  {idx + 1}. {s.name} {s.is_school ? '🏫' : ''}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => setStopToDelete(s)}
                                  className="text-[10px] text-red-500 hover:text-red-700"
                                >
                                  ✕
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="text-[11px] text-[#64748B] italic mt-0.5">No stops added yet.</p>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[#E2E8F0] flex justify-end">
                      <button
                        type="button"
                        onClick={() => openAddStopModalForRoute(route.id)}
                        className="rounded-lg bg-[#E6F4F1] text-[#0D9488] font-bold px-3 py-1 text-xs hover:bg-[#0D9488] hover:text-white transition-colors"
                      >
                        + Add Stop
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ── TAB 3: DRIVER DIRECTORY ── */}
      {activeTab === 'drivers' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-[#172033]">School Driver Directory</h2>
              <p className="text-xs text-[#64748B]">
                Certified school bus operators and their active vehicle pairings.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowNewDriverModal(true)}
              className="rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F766E] shadow-2xs"
            >
              + Add Driver
            </button>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-2xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Driver Name</th>
                  <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Contact Phone</th>
                  <th className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Assigned Vehicle</th>
                  <th className="py-3 px-4 text-right font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {drivers.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-8 text-center text-[#64748B]">
                      No drivers registered. Click "+ Add Driver" to create a driver login.
                    </td>
                  </tr>
                ) : (
                  drivers.map((d) => {
                    const assignedBus = buses.find((b) => b.driverProfileId === d.id)

                    return (
                      <tr key={d.id} className="hover:bg-[#F8FAFC]/80">
                        <td className="py-3 px-4 font-bold text-[#172033]">{d.full_name}</td>
                        <td className="py-3 px-4 font-mono text-[#64748B]">{d.phone || 'No phone recorded'}</td>
                        <td className="py-3 px-4">
                          {assignedBus ? (
                            <span className="font-semibold text-[#172033]">
                              🚌 {assignedBus.name || `Bus ${assignedBus.busNumber}`}
                            </span>
                          ) : (
                            <span className="text-[#64748B] italic">Available (Unassigned)</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {assignedBus ? (
                            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800 border border-emerald-200">
                              Active
                            </span>
                          ) : (
                            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-[#64748B]">
                              Available
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 1. GUIDED "ADD BUS" WORKFLOW MODAL (Images 3 & 4) ── */}
      {showAddBusWizard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-[#E2E8F0] max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <h2 className="text-base font-bold text-[#172033]">Set up a new bus</h2>
                <p className="text-xs text-[#64748B]">Register a bus and prepare it for school transportation.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddBusWizard(false)}
                className="text-[#64748B] hover:text-[#172033]"
              >
                ✕
              </button>
            </div>

            {/* Stepper Progress Bar (4 segments) */}
            <div className="mt-4 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-[#64748B] uppercase tracking-wider">
                <span>
                  STEP {wizardStep} OF 4 · {
                    wizardStep === 1 ? 'BUS INFORMATION' :
                    wizardStep === 2 ? 'DRIVER ASSIGNMENT' :
                    wizardStep === 3 ? 'ROUTE ASSIGNMENT' : 'REVIEW & SAVE'
                  }
                </span>
                <span>{wizardStep * 25}%</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 h-1.5 w-full">
                <div className={'rounded-full ' + (wizardStep >= 1 ? 'bg-[#0D9488]' : 'bg-[#E2E8F0]')} />
                <div className={'rounded-full ' + (wizardStep >= 2 ? 'bg-[#0D9488]' : 'bg-[#E2E8F0]')} />
                <div className={'rounded-full ' + (wizardStep >= 3 ? 'bg-[#0D9488]' : 'bg-[#E2E8F0]')} />
                <div className={'rounded-full ' + (wizardStep >= 4 ? 'bg-[#0D9488]' : 'bg-[#E2E8F0]')} />
              </div>
            </div>

            {wizardError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-[#DC2626]">
                ✕ {wizardError}
              </div>
            )}

            {/* STEP 1: VEHICLE INFORMATION */}
            {wizardStep === 1 && (
              <div className="mt-4 flex flex-col gap-3.5">
                <h3 className="text-sm font-bold text-[#172033]">Vehicle details</h3>
                <div>
                  <label className="text-xs font-bold text-[#172033]">Bus name or number *</label>
                  <input
                    type="text"
                    required
                    value={newBusNumber}
                    onChange={(e) => setNewBusNumber(e.target.value)}
                    placeholder="e.g. Bus 01"
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[#172033]">Registration plate *</label>
                  <input
                    type="text"
                    required
                    value={newPlateNumber}
                    onChange={(e) => setNewPlateNumber(e.target.value)}
                    placeholder="e.g. 3-ET-1029"
                    className={INPUT_CLASS}
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-[#172033]">Seating capacity</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={newCapacity}
                    onChange={(e) => setNewCapacity(e.target.value)}
                    placeholder="30 seats"
                    className={INPUT_CLASS}
                  />
                </div>

                <div className="mt-4 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
                  <button
                    type="button"
                    onClick={() => setShowAddBusWizard(false)}
                    className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={!newBusNumber.trim()}
                    onClick={() => setWizardStep(2)}
                    className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
                  >
                    Next: Driver Assignment →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: DRIVER ASSIGNMENT */}
            {wizardStep === 2 && (
              <div className="mt-4 flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#172033]">Who will drive this bus?</h3>
                  <button
                    type="button"
                    onClick={() => setWizardDriverOption(wizardDriverOption === 'new' ? 'existing' : 'new')}
                    className="text-xs font-bold text-[#0D9488] hover:underline"
                  >
                    {wizardDriverOption === 'new' ? '← Pick existing driver' : '+ New driver'}
                  </button>
                </div>

                {wizardDriverOption === 'existing' && (
                  <div>
                    <label className="text-xs font-semibold text-[#64748B]">Select an existing driver:</label>
                    <select
                      value={wizardDriverId}
                      onChange={(e) => setWizardDriverId(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">-- No driver assigned for now (skip) --</option>
                      {drivers.map((d) => (
                        <option key={d.id} value={d.id}>{d.full_name} ({d.phone || 'No phone'})</option>
                      ))}
                    </select>
                  </div>
                )}

                {wizardDriverOption === 'new' && (
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 flex flex-col gap-2.5">
                    <p className="text-[11px] font-bold text-[#172033]">Quick-provision new driver account:</p>
                    <div>
                      <label className="text-xs font-bold text-[#172033]">Driver full name *</label>
                      <input
                        type="text"
                        value={newDriverName}
                        onChange={(e) => setNewDriverName(e.target.value)}
                        placeholder="e.g. Abebe Kebede"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#172033]">Phone number</label>
                      <input
                        type="tel"
                        value={newDriverPhone}
                        onChange={(e) => setNewDriverPhone(e.target.value)}
                        placeholder="e.g. 0911223344"
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E]"
                  >
                    Next: Route Assignment →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: ROUTE ASSIGNMENT */}
            {wizardStep === 3 && (
              <div className="mt-4 flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[#172033]">Which route will this bus serve?</h3>
                  <button
                    type="button"
                    onClick={() => setWizardRouteOption(wizardRouteOption === 'new' ? 'existing' : 'new')}
                    className="text-xs font-bold text-[#0D9488] hover:underline"
                  >
                    {wizardRouteOption === 'new' ? '← Pick existing route' : '+ Create new route'}
                  </button>
                </div>

                {wizardRouteOption === 'existing' && (
                  <div>
                    <label className="text-xs font-semibold text-[#64748B]">Select existing route template:</label>
                    <select
                      value={wizardRouteId}
                      onChange={(e) => setWizardRouteId(e.target.value)}
                      className={INPUT_CLASS}
                    >
                      <option value="">-- No route assigned for now (skip) --</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.startTime || '06:45'}) · {r.stops?.length || 0} stops
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {wizardRouteOption === 'new' && (
                  <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 flex flex-col gap-2.5">
                    <p className="text-[11px] font-bold text-[#172033]">Create new reusable route template:</p>
                    <div>
                      <label className="text-xs font-bold text-[#172033]">Route Name *</label>
                      <input
                        type="text"
                        value={newRouteName}
                        onChange={(e) => setNewRouteName(e.target.value)}
                        placeholder="e.g. Bole Route"
                        className={INPUT_CLASS}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-[#172033]">Morning Departure Time</label>
                      <input
                        type="time"
                        value={newRouteStartTime}
                        onChange={(e) => setNewRouteStartTime(e.target.value)}
                        className={INPUT_CLASS}
                      />
                    </div>
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(4)}
                    className="rounded-lg bg-[#0D9488] px-4 py-2 text-xs font-bold text-white hover:bg-[#0F766E]"
                  >
                    Next: Review &amp; Confirm →
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: REVIEW & CONFIRM */}
            {wizardStep === 4 && (
              <div className="mt-4 flex flex-col gap-3.5">
                <div>
                  <h3 className="text-sm font-bold text-[#172033]">Confirm your bus setup</h3>
                  <p className="text-xs text-[#64748B]">Review vehicle, driver, and route before saving.</p>
                </div>

                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Bus Name / Unit:</span>
                    <strong className="text-[#172033]">{newBusNumber}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Registration Plate:</span>
                    <span className="font-mono text-[#172033]">{newPlateNumber || '3-ET-1000'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Capacity:</span>
                    <span className="text-[#172033]">{newCapacity} seats</span>
                  </div>
                  <div className="h-[1px] bg-[#E2E8F0]" />
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Driver:</span>
                    <span className="font-semibold text-[#172033]">
                      {wizardDriverOption === 'new' ? (newDriverName || 'New Driver') :
                       wizardDriverId ? (drivers.find((d) => d.id === wizardDriverId)?.full_name || 'Assigned Driver') :
                       'None (Incomplete setup)'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Route:</span>
                    <span className="font-semibold text-[#172033]">
                      {wizardRouteOption === 'new' ? (newRouteName || 'New Route') :
                       wizardRouteId ? (routes.find((r) => r.id === wizardRouteId)?.name || 'Assigned Route') :
                       'None (Incomplete setup)'}
                    </span>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-[#E2E8F0] pt-3">
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    disabled={savingWizard}
                    onClick={handleWizardSubmit}
                    className="rounded-lg bg-[#0D9488] px-5 py-2.5 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50 shadow-2xs"
                  >
                    {savingWizard ? 'Saving setup…' : 'Save Bus Setup'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── 2. STOP CREATION MODAL WITH LOCATION SEARCH & MAP PIN (Image 5) ── */}
      {showAddStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl border border-[#E2E8F0] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
              <div>
                <h2 className="text-base font-bold text-[#172033]">Add a route stop</h2>
                <p className="text-xs text-[#64748B]">Search a landmark or address to pin an exact pickup gate.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddStopModal(false)}
                className="text-[#64748B] hover:text-[#172033]"
              >
                ✕
              </button>
            </div>

            {stopModalError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-semibold text-[#DC2626]">
                ✕ {stopModalError}
              </div>
            )}

            <form onSubmit={handleConfirmAddStop} className="mt-4 flex flex-col gap-3.5">
              {/* Landmark search input */}
              <div>
                <label className="text-xs font-bold text-[#172033]">Search for a location</label>
                <div className="relative mt-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#94A3B8]">🔍</span>
                  <input
                    type="text"
                    required
                    value={stopSearchQuery}
                    onChange={(e) => {
                      setStopSearchQuery(e.target.value)
                      setConfirmedStopName(e.target.value)
                    }}
                    placeholder="Search landmark, hotel, school, roundabout…"
                    className="h-10 w-full rounded-lg border border-[#E2E8F0] bg-white pl-9 pr-3 text-xs text-[#172033] focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] focus:outline-none"
                  />
                </div>

                {/* Autocomplete suggestion pills/list */}
                {stopSuggestions.length > 0 && (
                  <div className="mt-1.5 flex flex-col rounded-lg border border-[#E2E8F0] bg-white shadow-xs max-h-36 overflow-y-auto">
                    {stopSuggestions.map((lm, i) => (
                      <button
                        key={lm.name || i}
                        type="button"
                        onClick={() => handleSelectLandmark(lm)}
                        className="flex items-center gap-2 px-3 py-2 text-left text-xs text-[#172033] hover:bg-[#E6F4F1] border-b border-[#E2E8F0] last:border-b-0 transition-colors"
                      >
                        <span className="text-[#0D9488]">📍</span>
                        <span className="font-semibold">{lm.name}</span>
                        {lm.area && <span className="text-[10px] text-[#64748B]">({lm.area})</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Confirm pickup location Panel with Embedded Interactive Leaflet Map */}
              <div className="rounded-xl border border-[#0D9488]/30 bg-[#E6F4F1]/30 p-3.5 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#0D9488] flex items-center gap-1.5">
                    <span>📍</span>
                    <span>Confirm pickup location</span>
                  </span>
                  <span className="rounded bg-white px-2 py-0.5 text-[10px] font-bold text-[#0D9488] border border-[#0D9488]/20">
                    {isSchoolDestination ? 'School Destination' : 'Pickup'}
                  </span>
                </div>

                {/* Leaflet Pin Map */}
                <div className="h-52 w-full rounded-lg border border-[#E2E8F0] overflow-hidden relative">
                  <MapContainer
                    center={selectedCoords}
                    zoom={15}
                    zoomControl={false}
                    className="h-full w-full"
                  >
                    <MapCenterController center={selectedCoords} zoom={15} />
                    <TileLayer
                      attribution="&copy; OpenStreetMap contributors"
                      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Marker
                      position={selectedCoords}
                      icon={STOP_PIN_ICON}
                      draggable={true}
                      eventHandlers={{
                        dragend: (e) => {
                          const marker = e.target
                          const pos = marker.getLatLng()
                          setSelectedCoords([pos.lat, pos.lng])
                        },
                      }}
                    >
                      <Tooltip permanent direction="top" offset={[0, -30]}>
                        {confirmedStopName || 'Selected Pickup Gate'}
                      </Tooltip>
                    </Marker>
                  </MapContainer>
                </div>
                <p className="text-[11px] text-[#64748B] italic">
                  Drag the pin on the map to adjust the exact pickup gate entrance if necessary.
                </p>
              </div>

              {/* Stop Destination Checkbox */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  id="isFinalSchool"
                  type="checkbox"
                  checked={isSchoolDestination}
                  onChange={(e) => setIsSchoolDestination(e.target.checked)}
                  className="h-4 w-4 rounded border-[#E2E8F0] text-[#0D9488] focus:ring-[#0D9488]"
                />
                <label htmlFor="isFinalSchool" className="text-xs font-semibold text-[#172033] cursor-pointer">
                  This stop is the School Campus Gate (Final Morning Destination)
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="mt-2 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
                <button
                  type="button"
                  onClick={() => setShowAddStopModal(false)}
                  className="rounded-lg border border-[#E2E8F0] px-3.5 py-2 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStop || !confirmedStopName}
                  className="rounded-lg bg-[#0D9488] px-5 py-2 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50 shadow-2xs"
                >
                  {savingStop ? 'Saving stop…' : 'Confirm & Add Stop'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 3. QUICK CHANGE ASSIGNMENT POPOVER ── */}
      {quickChangeBus && quickChangeType && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-[#E2E8F0]">
            <h3 className="text-sm font-bold text-[#172033]">
              Assign {quickChangeType === 'driver' ? 'Driver' : 'Route'} to {quickChangeBus.name || `Bus ${quickChangeBus.busNumber}`}
            </h3>
            <p className="text-xs text-[#64748B] mt-0.5">
              Select an active {quickChangeType} to pair with this vehicle.
            </p>

            <div className="mt-3.5">
              {quickChangeType === 'driver' ? (
                <select
                  value={quickTargetId}
                  onChange={(e) => setQuickTargetId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">-- No driver assigned --</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id}>{d.full_name} ({d.phone || 'No phone'})</option>
                  ))}
                </select>
              ) : (
                <select
                  value={quickTargetId}
                  onChange={(e) => setQuickTargetId(e.target.value)}
                  className={INPUT_CLASS}
                >
                  <option value="">-- Select route template --</option>
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
                  setQuickChangeType(null)
                }}
                className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingQuickChange}
                onClick={handleSaveQuickChange}
                className="rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
              >
                {savingQuickChange ? 'Saving…' : 'Save Assignment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. CREATE STANDALONE ROUTE MODAL ── */}
      {showNewRouteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-[#E2E8F0]">
            <h3 className="text-sm font-bold text-[#172033]">Create Reusable Route</h3>
            <p className="text-xs text-[#64748B] mt-0.5">Define a route template that can be assigned to buses.</p>

            <form onSubmit={handleCreateStandaloneRoute} className="mt-3.5 flex flex-col gap-3">
              <div>
                <label className="text-xs font-bold text-[#172033]">Route Name *</label>
                <input
                  type="text"
                  required
                  value={standaloneRouteName}
                  onChange={(e) => setStandaloneRouteName(e.target.value)}
                  placeholder="e.g. Bole Route"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#172033]">Morning Start Time</label>
                <input
                  type="time"
                  required
                  value={standaloneRouteTime}
                  onChange={(e) => setStandaloneRouteTime(e.target.value)}
                  className={INPUT_CLASS}
                />
              </div>

              <div className="mt-2 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewRouteModal(false)}
                  className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStandaloneRoute}
                  className="rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
                >
                  {savingStandaloneRoute ? 'Creating…' : 'Create Route'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 5. PROVISION DRIVER MODAL ── */}
      {showNewDriverModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-[#E2E8F0]">
            <h3 className="text-sm font-bold text-[#172033]">Provision Driver Account</h3>
            <p className="text-xs text-[#64748B] mt-0.5">Register a driver for mobile trip tracking.</p>

            <form onSubmit={handleCreateStandaloneDriver} className="mt-3.5 flex flex-col gap-3">
              <div>
                <label className="text-xs font-bold text-[#172033]">Driver Full Name *</label>
                <input
                  type="text"
                  required
                  value={standaloneDriverName}
                  onChange={(e) => setStandaloneDriverName(e.target.value)}
                  placeholder="e.g. Dawit Hailu"
                  className={INPUT_CLASS}
                />
              </div>

              <div>
                <label className="text-xs font-bold text-[#172033]">Mobile Phone Number *</label>
                <input
                  type="tel"
                  required
                  value={standaloneDriverPhone}
                  onChange={(e) => setStandaloneDriverPhone(e.target.value)}
                  placeholder="e.g. 0911223344"
                  className={INPUT_CLASS}
                />
              </div>

              <div className="mt-2 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
                <button
                  type="button"
                  onClick={() => setShowNewDriverModal(false)}
                  className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStandaloneDriver}
                  className="rounded-lg bg-[#0D9488] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-[#0F766E] disabled:opacity-50"
                >
                  {savingStandaloneDriver ? 'Creating…' : 'Create Driver'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 6. DELETE CONFIRMATIONS ── */}
      {busToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-red-200">
            <h3 className="text-sm font-bold text-[#DC2626]">Decommission Vehicle</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Remove <strong>{busToDelete.name || `Bus ${busToDelete.busNumber}`}</strong> from the school fleet? Active assignments will be unlinked.
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

      {stopToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-red-200">
            <h3 className="text-sm font-bold text-[#DC2626]">Remove Stop</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Remove <strong>"{stopToDelete.name}"</strong>? Students assigned to this stop will need reassignment.
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

      {routeToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl border border-red-200">
            <h3 className="text-sm font-bold text-[#DC2626]">Delete Route</h3>
            <p className="text-xs text-[#64748B] mt-1">
              Delete route <strong>"{routeToDelete.name}"</strong>? Vehicles and stops associated with this route will be affected.
            </p>
            <div className="mt-4 flex justify-end gap-2 border-t border-[#E2E8F0] pt-3">
              <button
                type="button"
                onClick={() => setRouteToDelete(null)}
                className="rounded-lg border border-[#E2E8F0] px-3 py-1.5 text-xs font-semibold text-[#64748B] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={handleConfirmDeleteRoute}
                className="rounded-lg bg-[#DC2626] px-3.5 py-1.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete Route'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
