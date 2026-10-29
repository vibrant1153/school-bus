import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMapEvents, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

function MapClickHandler({ onLocationSelect }) {
  useMapEvents({
    click(e) {
      if (onLocationSelect) {
        onLocationSelect(parseFloat(e.latlng.lat.toFixed(5)), parseFloat(e.latlng.lng.toFixed(5)))
      }
    },
  })
  return null
}

function MapCenterUpdater({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.setView(center, 14, { animate: true })
      // Ensure tiles render cleanly when displayed in a modal
      setTimeout(() => map.invalidateSize(), 200)
    }
  }, [center?.[0], center?.[1], map])
  return null
}

export default function StopMapPicker({ lat, lng, onLocationSelect, landmarkName }) {
  const validLat = typeof lat === 'number' && !isNaN(lat) ? lat : 9.025
  const validLng = typeof lng === 'number' && !isNaN(lng) ? lng : 38.765

  return (
    <div className="relative h-44 w-full overflow-hidden rounded-xl border border-slate-300 shadow-inner">
      <MapContainer
        center={[validLat, validLng]}
        zoom={14}
        scrollWheelZoom={false}
        className="h-full w-full cursor-crosshair"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapCenterUpdater center={[validLat, validLng]} />
        <MapClickHandler onLocationSelect={onLocationSelect} />

        <CircleMarker
          center={[validLat, validLng]}
          radius={8}
          pathOptions={{
            color: '#1e293b',
            fillColor: '#f59e0b',
            fillOpacity: 1,
            weight: 2,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -8]}>
            <span className="font-sans text-[11px] font-bold text-slate-900">
              📍 {landmarkName || 'Stop Pin'}
            </span>
          </Tooltip>
        </CircleMarker>
      </MapContainer>

      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-lg bg-white/90 px-2 py-1 text-[10px] font-semibold text-slate-700 backdrop-blur-xs">
        <span>💡 Tap anywhere on the map to adjust stop pin</span>
        <span className="font-mono">{validLat.toFixed(4)}, {validLng.toFixed(4)}</span>
      </div>
    </div>
  )
}
