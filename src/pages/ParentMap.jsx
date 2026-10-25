import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, Circle, CircleMarker, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '../i18n/useI18n.js'
import { useParentData } from '../lib/useParentData.js'
import {
  describeAge,
  formatDistance,
  formatRadius,
  ROUTE as FALLBACK_ROUTE,
} from '../prototype.js'

export default function ParentMap() {
  const { t } = useI18n()
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

  // Child stop position (or fallback London coordinate for prototype demo)
  const stopPosition = selectedChild?.morningStop?.lat && selectedChild?.morningStop?.lng
    ? [selectedChild.morningStop.lat, selectedChild.morningStop.lng]
    : [51.518, -0.113]

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
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <div className="relative min-h-0 flex-1">
        <MapContainer
          center={mapCenter}
          zoom={14}
          zoomControl={false}
          className="absolute inset-0"
        >
          {/* OpenStreetMap public tiles for development */}
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          {/* Route path */}
          <Polyline
            positions={mapRoute}
            pathOptions={{ color: '#F5B301', weight: 5, dashArray: noBus ? undefined : '6 6' }}
          />

          {/* Child Stop Alert Radius Circle (200m / 500m / 1000m) */}
          <Circle
            center={stopPosition}
            radius={alertMeters}
            pathOptions={{ color: '#1F7A4D', weight: 2, dashArray: '6 5', fillOpacity: 0.12 }}
          />

          {/* Child's Assigned Stop Marker */}
          <CircleMarker
            center={stopPosition}
            radius={10}
            pathOptions={{ color: '#10223A', weight: 3, fillColor: '#F5B301', fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top">
              {stopName}
            </Tooltip>
          </CircleMarker>

          {/* Live / Stale Bus Marker: never shown when no trip is running or no point for this trip */}
          {!noBus && busPosition && (
            <CircleMarker
              center={busPosition}
              radius={12}
              pathOptions={{
                color: '#ffffff',
                weight: 3,
                fillColor: stale ? '#8A99AB' : '#10223A',
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
        <div className="pointer-events-none absolute inset-x-4 top-4 z-[1000] flex items-center justify-between">
          <Link
            to="/home"
            className="pointer-events-auto flex min-h-11 items-center rounded-xl bg-white px-3.5 text-[15px] font-bold text-ink shadow-md hover:bg-gray-50"
          >
            {t('map.back')}
          </Link>
          <p
            className={
              'rounded-xl bg-white px-3.5 py-2.5 text-[13px] font-bold shadow-md ' +
              (busStatus.mode === 'live' ? 'text-live' : 'text-muted')
            }
          >
            {isWaiting
              ? '● WAITING FOR BUS GPS'
              : noTrip
              ? t('home.none.badge')
              : stale
              ? `● ${t('home.lastSeen', { age }).toUpperCase()}`
              : `● ${t('home.live').split(' · ')[0]} · ${age}`}
          </p>
        </div>
      </div>

      {/* Bottom Sheet */}
      <section className="flex flex-col gap-3 rounded-t-[20px] bg-white p-5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
        {noBus ? (
          <>
            <p className="text-[26px] leading-tight font-extrabold text-ink">
              {isWaiting ? 'Trip in Progress' : t('map.noTrip.title')}
            </p>
            <p className="text-[15px] text-muted">
              {isWaiting ? 'Waiting for the first location update from the bus...' : t('map.noTrip.body')}
            </p>
          </>
        ) : (
          <>
            <p className={'leading-tight font-extrabold ' + (stale ? 'text-[26px] text-muted' : 'text-3xl text-ink')}>
              {stale ? t('home.lastKnown', { distance }) : t('home.about', { distance })}
            </p>
            <p className="text-[15px] text-ink">
              {t('home.heading', { bus: t('home.bus', { n: busNumber }), stop: stopName })}
            </p>
            {stale ? (
              <p className="rounded-xl bg-[#FFF6E0] p-3 text-sm leading-relaxed text-amber-900" role="alert">
                {t('map.staleWarning')}
              </p>
            ) : (
              <p className="text-[13px] text-muted">{t('map.approx')}</p>
            )}
          </>
        )}

        <div className="flex items-center justify-between border-t border-line pt-3">
          <div>
            <p className="text-[15px] font-bold text-ink">
              {t('map.radius', { radius: formatRadius(alertMeters, t) })}
            </p>
            <p className="text-[13px] text-muted">{t('map.dashed')}</p>
          </div>
          <Link
            to="/home"
            className="flex min-h-11 items-center rounded-[10px] border border-field px-4 text-[15px] font-semibold text-ink hover:bg-gray-50"
          >
            {t('map.change')}
          </Link>
        </div>
      </section>
    </div>
  )
}
