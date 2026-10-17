import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, Polyline, Circle, CircleMarker, Tooltip } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { useI18n } from '../i18n/useI18n.js'
import {
  BUS_DISTANCE_M,
  BUS_POSITION,
  MY_STOP,
  ROUTE,
  STOPS,
  busStatus,
  describeAge,
  formatDistance,
  formatRadius,
  getAlertMeters,
  getDemoState,
} from '../prototype.js'

export default function ParentMap() {
  const { t } = useI18n()
  const alertMeters = getAlertMeters()
  const status = busStatus(getDemoState())
  const stale = status.mode === 'stale'
  const noTrip = status.mode === 'none'
  const age = noTrip ? '' : describeAge(status.secondsAgo, t)
  const distance = formatDistance(BUS_DISTANCE_M, t)

  return (
    <div className="mx-auto flex h-dvh w-full max-w-md flex-col">
      <div className="relative min-h-0 flex-1">
        <MapContainer
          bounds={ROUTE}
          boundsOptions={{ padding: [30, 30] }}
          zoomControl={false}
          className="absolute inset-0"
        >
          {/* The public OpenStreetMap server is fine for development only.
              A production tile provider is chosen in a later step. */}
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <Polyline positions={ROUTE} pathOptions={{ color: '#F5B301', weight: 6 }} />
          <Circle
            center={MY_STOP.position}
            radius={alertMeters}
            pathOptions={{ color: '#1F7A4D', weight: 2, dashArray: '6 5', fillOpacity: 0.12 }}
          />
          {STOPS.filter((stop) => stop.id !== MY_STOP.id).map((stop) => (
            <CircleMarker
              key={stop.id}
              center={stop.position}
              radius={6}
              pathOptions={{ color: '#10223A', weight: 2.5, fillColor: '#ffffff', fillOpacity: 1 }}
            />
          ))}
          <CircleMarker
            center={MY_STOP.position}
            radius={10}
            pathOptions={{ color: '#10223A', weight: 3, fillColor: '#F5B301', fillOpacity: 1 }}
          >
            <Tooltip permanent direction="top">{t('map.yourStop')}</Tooltip>
          </CircleMarker>
          {/* No bus marker at all when there is no trip. A stale bus is grey, never shown as live. */}
          {!noTrip && (
            <CircleMarker
              center={BUS_POSITION}
              radius={12}
              pathOptions={{ color: '#ffffff', weight: 3, fillColor: stale ? '#8A99AB' : '#10223A', fillOpacity: 1 }}
            >
              <Tooltip permanent direction="right">
                {stale ? t('map.busStale', { n: 3, age }) : t('map.bus', { n: 3 })}
              </Tooltip>
            </CircleMarker>
          )}
        </MapContainer>

        <div className="pointer-events-none absolute inset-x-4 top-4 z-[1000] flex items-center justify-between">
          <Link to="/home" className="pointer-events-auto flex min-h-11 items-center rounded-xl bg-white px-3.5 text-[15px] font-bold shadow">
            {t('map.back')}
          </Link>
          <p className={'rounded-xl bg-white px-3.5 py-2.5 text-[13px] font-bold shadow ' + (status.mode === 'live' ? 'text-live' : 'text-muted')}>
            {noTrip ? t('home.none.badge') : stale ? `● ${t('home.lastSeen', { age }).toUpperCase()}` : `● ${t('home.live').split(' · ')[0]} · ${age}`}
          </p>
        </div>
      </div>

      <section className="flex flex-col gap-3 rounded-t-[20px] bg-white p-5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
        {noTrip ? (
          <>
            <p className="text-[26px] leading-tight font-extrabold">{t('map.noTrip.title')}</p>
            <p className="text-[15px]">{t('map.noTrip.body')}</p>
          </>
        ) : (
          <>
            <p className={'leading-tight font-extrabold ' + (stale ? 'text-[26px] text-muted' : 'text-3xl')}>
              {stale ? t('home.lastKnown', { distance }) : t('home.about', { distance })}
            </p>
            <p className="text-[15px]">{t('home.heading', { bus: t('home.bus', { n: 3 }), stop: t('home.stop', { n: 4 }) })}</p>
            {stale ? (
              <p className="rounded-xl bg-[#FFF6E0] p-3 text-sm leading-relaxed" role="alert">
                {t('map.staleWarning')}
              </p>
            ) : (
              <p className="text-[13px] text-muted">
                {t('map.approx')}
              </p>
            )}
          </>
        )}
        <div className="flex items-center justify-between border-t border-line pt-3">
          <div>
            <p className="text-[15px] font-bold">{t('map.radius', { radius: formatRadius(alertMeters, t) })}</p>
            <p className="text-[13px] text-muted">{t('map.dashed')}</p>
          </div>
          <Link to="/home" className="flex min-h-11 items-center rounded-[10px] border border-field px-4 text-[15px]">
            {t('map.change')}
          </Link>
        </div>
      </section>
    </div>
  )
}
