import { useEffect, useRef, useState } from 'react'
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

function MapController({ center, zoom }) {
  const map = useMap()
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.setView(center, zoom || map.getZoom() || 15, { animate: true })
      setTimeout(() => map.invalidateSize(), 150)
    }
  }, [center?.[0], center?.[1], zoom, map])
  return null
}

function ZoomControls() {
  const map = useMap()
  return (
    <div className="absolute right-2.5 top-2.5 z-[1000] flex flex-col gap-1 rounded-lg bg-white/95 p-1 shadow-md border border-slate-200">
      <button
        type="button"
        title="Zoom In"
        onClick={(e) => {
          e.stopPropagation()
          map.zoomIn()
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-base font-bold text-slate-800 hover:bg-slate-100 hover:text-ink transition-colors shadow-2xs"
      >
        +
      </button>
      <button
        type="button"
        title="Zoom Out"
        onClick={(e) => {
          e.stopPropagation()
          map.zoomOut()
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-base font-bold text-slate-800 hover:bg-slate-100 hover:text-ink transition-colors shadow-2xs"
      >
        −
      </button>
    </div>
  )
}

export default function StopMapPicker({ lat, lng, onLocationSelect, landmarkName }) {
  const validLat = typeof lat === 'number' && !isNaN(lat) ? lat : 9.025
  const validLng = typeof lng === 'number' && !isNaN(lng) ? lng : 38.765
  const [isExpanded, setIsExpanded] = useState(false)
  const containerRef = useRef(null)

  // Prevent browser window pinch-zoom when interacting with the map on trackpads/touchpads
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e) => {
      // If ctrlKey is pressed (trackpad pinch gesture on Chrome Windows), prevent browser page zoom
      if (e.ctrlKey) {
        e.preventDefault()
      }
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative w-full overflow-hidden rounded-xl border border-slate-300 shadow-inner transition-all duration-300 ${
        isExpanded ? 'h-80' : 'h-56'
      }`}
    >
      <MapContainer
        center={[validLat, validLng]}
        zoom={15}
        scrollWheelZoom={true}
        doubleClickZoom={true}
        touchZoom={true}
        zoomControl={false} // Use our cleaner custom controls
        className="h-full w-full cursor-crosshair"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController center={[validLat, validLng]} />
        <MapClickHandler onLocationSelect={onLocationSelect} />
        <ZoomControls />

        <CircleMarker
          center={[validLat, validLng]}
          radius={9}
          pathOptions={{
            color: '#1e293b',
            fillColor: '#f59e0b',
            fillOpacity: 1,
            weight: 2.5,
          }}
        >
          <Tooltip permanent direction="top" offset={[0, -10]}>
            <span className="font-sans text-[11px] font-bold text-slate-900">
              📍 {landmarkName || 'Stop Pin'}
            </span>
          </Tooltip>
        </CircleMarker>
      </MapContainer>

      {/* Floating Header Controls */}
      <div className="pointer-events-auto absolute left-2.5 top-2.5 z-[1000] flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="rounded-lg bg-white/95 px-2.5 py-1 text-[11px] font-bold text-slate-700 shadow-md border border-slate-200 hover:bg-white hover:text-ink transition-colors"
        >
          {isExpanded ? '↙ Collapse Map' : '↗ Expand Map'}
        </button>
      </div>

      {/* Floating Bottom Tip */}
      <div className="pointer-events-none absolute bottom-2 left-2 right-2 z-[1000] flex items-center justify-between rounded-lg bg-white/95 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-sm border border-slate-200 backdrop-blur-xs">
        <span className="flex items-center gap-1">
          <span>💡</span>
          <span>Click anywhere to move pin · Scroll or use + / − to zoom</span>
        </span>
        <span className="font-mono text-slate-900 font-bold">
          {validLat.toFixed(4)}, {validLng.toFixed(4)}
        </span>
      </div>
    </div>
  )
}
