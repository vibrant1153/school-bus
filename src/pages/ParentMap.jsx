import { useRef, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, Circle, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '../i18n/useI18n.js'
import { useAuth } from '../lib/useAuth.js'
import { useParentData } from '../lib/useParentData.js'
import ParentNav from '../components/ParentNav.jsx'
import {
  describeAge,
  formatDistance,
  formatRadius,
  ROUTE as FALLBACK_ROUTE,
} from '../prototype.js'

function MapController({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.panTo(center, { animate: true, duration: 0.8 })
    }
  }, [center?.[0], center?.[1], map])
  return null
}

function MapRefBinder({ mapRef }) {
  const map = useMap()
  useEffect(() => {
    mapRef.current = map
  }, [map, mapRef])
  return null
}

export default function ParentMap() {
  const { t } = useI18n()
  const { signOut } = useAuth()
  const mapRef = useRef(null)
  const {
    selectedChild,
    activeTrip,
    busPosition,
    busDistanceM,
    busStatus,
  } = useParentData()

  const alertMeters = selectedChild?.alertRadiusM || 500
  const busNumber = activeTrip?.buses?.bus_number || selectedChild?.busNumber || 1
  const stopName = selectedChild?.morningStop?.name || t('map.yourStop')

  // Child stop position (or fallback Addis Ababa coordinate for prototype demo)
  const stopPosition = selectedChild?.morningStop?.lat && selectedChild?.morningStop?.lng
    ? [selectedChild.morningStop.lat, selectedChild.morningStop.lng]
    : [9.0290, 38.7590]

  const stale = busStatus.mode === 'stale'
  const noTrip = busStatus.mode === 'none'
  const isWaiting = busStatus.mode === 'waiting'
  const noBus = noTrip || isWaiting || !busPosition
  const age = noTrip || isWaiting ? '' : describeAge(busStatus.secondsAgo ?? 0, t)
  const distance = formatDistance(busDistanceM, t)

  // Map center: prefer bus if active and location available, otherwise child stop
  const mapCenter = !noBus && busPosition ? busPosition : stopPosition

  // Route positions: if active bus and stop available, render connection line, or fallback
  const mapRoute = !noBus && busPosition ? [busPosition, stopPosition] : FALLBACK_ROUTE

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col bg-[#F8FAFC]">
      <div className="relative min-h-0 flex-1">
        <MapContainer
          center={mapCenter}
          zoom={14}
          zoomControl={false}
          zoomSnap={0.25}
          zoomDelta={0.5}
          wheelPxPerZoomLevel={120}
          className="absolute inset-0"
        >
          <MapRefBinder mapRef={mapRef} />
          <MapController center={mapCenter} />

          {/* OpenStreetMap public tiles with buffer caching */}
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
            keepBuffer={6}
            updateWhenZooming={false}
          />

          {/* Route path with modern Teal accent */}
          <Polyline
            positions={mapRoute}
            pathOptions={{ color: '#0D9488', weight: 4.5, dashArray: noBus ? undefined : '6 6', opacity: 0.85 }}
          />

          {/* Child Stop Alert Radius Circle (200m / 500m / 1000m) */}
          <Circle
            center={stopPosition}
            radius={alertMeters}
            pathOptions={{ color: '#0D9488', weight: 2, dashArray: '6 5', fillColor: '#0D9488', fillOpacity: 0.12 }}
          />

          {/* Child's Assigned Stop Marker */}
          <CircleMarker
            center={stopPosition}
            radius={10}
            pathOptions={{ color: '#1D3557', weight: 3, fillColor: '#0D9488', fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top">
              {stopName}
            </Tooltip>
          </CircleMarker>

          {/* Live / Stale Bus Marker */}
          {!noBus && busPosition && (
            <CircleMarker
              center={busPosition}
              radius={12}
              pathOptions={{
                color: '#ffffff',
                weight: 3,
                fillColor: stale ? '#64748B' : '#1D3557',
                fillOpacity: 1,
              }}
            >
              <Tooltip permanent direction="right">
                {stale
                  ? t('map.busStale', { n: busNumber, age })
                  : t('map.bus', { n: busNumber })}
              </Tooltip>
            </CircleMarker>
          )}
        </MapContainer>

        {/* Floating Top Header */}
        <div className="pointer-events-none absolute inset-x-3 sm:inset-x-4 top-3 sm:top-4 z-[1000] flex items-center justify-between gap-2">
          <div className="pointer-events-auto flex items-center gap-2">
            <Link
              to="/home"
              className="btn-3d-subtle flex min-h-10 items-center rounded-2xl px-3.5 text-xs sm:text-sm font-black text-[#172033]"
            >
              ← {t('map.back')}
            </Link>
            <div
              className={
                'card-3d flex items-center gap-2 rounded-2xl px-3.5 py-2 text-xs sm:text-sm font-black ' +
                (busStatus.mode === 'live' ? 'text-[#0D9488] border-[#0D9488]/30 bg-[#E6F4F1] radar-live' : 'text-[#64748B]')
              }
            >
              <span
                className={
                  'h-2 w-2 rounded-full ' +
                  (busStatus.mode === 'live' ? 'bg-[#0D9488]' : 'bg-[#64748B]')
                }
              />
              <span>
                {isWaiting
                  ? 'WAITING GPS'
                  : noTrip
                  ? t('home.none.badge')
                  : stale
                  ? `${t('home.lastSeen', { age }).toUpperCase()}`
                  : `${t('home.live').split(' · ')[0]} · ${age}`}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={signOut}
            title="Sign Out"
            aria-label="Sign out"
            className="pointer-events-auto flex h-10 w-10 items-center justify-center rounded-2xl border border-[#E2E8F0] bg-white text-[#64748B] hover:text-[#DC2626] hover:bg-red-50 hover:border-red-200 active:scale-95 transition-all shadow-sm"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>

        {/* Floating Zoom & Recenter Controls */}
        <div className="pointer-events-none absolute right-3 sm:right-4 top-18 z-[1000] flex flex-col gap-2">
          <div className="pointer-events-auto card-3d flex flex-col overflow-hidden rounded-2xl shadow-md border border-[#E2E8F0]">
            <button
              type="button"
              onClick={() => mapRef.current?.zoomIn(0.5)}
              aria-label="Zoom in"
              className="flex h-10 w-10 items-center justify-center text-lg font-black text-[#172033] hover:bg-[#F8FAFC] active:bg-[#E2E8F0] transition-colors"
            >
              +
            </button>
            <div className="h-[1px] bg-[#E2E8F0]" />
            <button
              type="button"
              onClick={() => mapRef.current?.zoomOut(0.5)}
              aria-label="Zoom out"
              className="flex h-10 w-10 items-center justify-center text-lg font-black text-[#172033] hover:bg-[#F8FAFC] active:bg-[#E2E8F0] transition-colors"
            >
              −
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              if (mapRef.current && mapCenter) {
                mapRef.current.flyTo(mapCenter, 15, { duration: 0.8 })
              }
            }}
            title="Recenter on bus / stop"
            aria-label="Recenter"
            className="pointer-events-auto card-3d flex h-10 w-10 items-center justify-center rounded-2xl text-base shadow-md hover:scale-105 active:scale-95 transition-all border border-[#E2E8F0]"
          >
            🎯
          </button>
        </div>
      </div>

      {/* 3D Bottom Sheet */}
      <section className="card-3d relative z-20 flex flex-col gap-3 rounded-t-3xl p-5 sm:p-6 shadow-[0_-12px_36px_rgba(15,23,42,0.06)] border-t border-[#E2E8F0]">
        {noBus ? (
          <>
            <p className="text-xl sm:text-2xl font-black text-[#172033] tracking-tight leading-tight">
              {isWaiting ? 'Trip in Progress' : t('map.noTrip.title')}
            </p>
            <p className="text-xs sm:text-sm font-medium text-[#64748B] leading-relaxed">
              {isWaiting ? 'Waiting for the first location update from the bus...' : t('map.noTrip.body')}
            </p>
          </>
        ) : (
          <>
            <p className={'font-black tracking-tight leading-tight ' + (stale ? 'text-2xl text-[#64748B]' : 'text-3xl text-[#172033]')}>
              {stale ? t('home.lastKnown', { distance }) : t('home.about', { distance })}
            </p>
            <p className="text-xs sm:text-sm font-bold text-[#64748B]">
              {t('home.heading', { bus: t('home.bus', { n: busNumber }), stop: stopName })}
            </p>
            {stale ? (
              <p className="rounded-2xl bg-amber-50/90 border border-amber-300 p-3 text-xs leading-relaxed font-semibold text-amber-950" role="alert">
                {t('map.staleWarning')}
              </p>
            ) : (
              <p className="text-xs font-semibold text-[#64748B]">{t('map.approx')}</p>
            )}
          </>
        )}

        <div className="flex items-center justify-between border-t border-[#E2E8F0] pt-3.5">
          <div>
            <p className="text-xs font-black text-[#172033]">
              {t('map.radius', { radius: formatRadius(alertMeters, t) })}
            </p>
            <p className="text-[11px] font-medium text-[#64748B]">{t('map.dashed')}</p>
          </div>
          <Link
            to="/alerts"
            className="btn-3d-subtle flex min-h-10 items-center rounded-xl px-3.5 text-xs font-black text-[#172033]"
          >
            {t('map.change')} ⚙️
          </Link>
        </div>
      </section>
      <ParentNav active="map" />
    </div>
  )
}
