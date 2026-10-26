// PROTOTYPE ONLY: sample data and helpers used until the real database exists.

// Sample location. The coordinates are arbitrary: change ORIGIN to your own
// city (lat, lng) to see the sample route there. Real routes come from the school.
const ORIGIN = { lat: 9.0205, lng: 38.7500 }

// Converts metres east/north of ORIGIN into [lat, lng].
function fromMeters(eastM, northM) {
  const lat = ORIGIN.lat + northM / 111320
  const lng = ORIGIN.lng + eastM / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180))
  return [lat, lng]
}

// Straight-line distance in metres between two [lat, lng] points.
export function distanceMeters([lat1, lng1], [lat2, lng2]) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// t is the translate function from useI18n(), so units follow the chosen language.
export function formatDistance(meters, t) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} ${t('unit.km')}`
    : `${Math.round(meters / 100) * 100} ${t('unit.m')}`
}

// "200 m", "500 m", "1 km" for the alert-radius choices.
export function formatRadius(meters, t) {
  return meters >= 1000 ? `${meters / 1000} ${t('unit.km')}` : `${meters} ${t('unit.m')}`
}

export const ROUTE = [
  [9.0205, 38.7500],
  [9.0230, 38.7530],
  [9.0260, 38.7560],
  [9.0290, 38.7590],
  [9.0320, 38.7620],
]

export const STOPS = [
  { id: 1, position: [9.0205, 38.7500] },
  { id: 2, position: [9.0230, 38.7530] },
  { id: 3, position: [9.0260, 38.7560] },
  { id: 4, position: [9.0290, 38.7590] },
  { id: 5, position: [9.0320, 38.7620] },
]
export const MY_STOP = STOPS[3]
export const BUS_POSITION = [9.0245, 38.7545]
export const BUS_DISTANCE_M = distanceMeters(BUS_POSITION, MY_STOP.position)

// How old a bus position may be before parents see it as "last seen" instead of live.
// With updates every 12 seconds, 60 seconds means about 4 missed updates.
export const STALE_AFTER_SECONDS = 60

// PROTOTYPE ONLY: lets you preview the three states a parent can see.
// The real state will come from the database (is a trip running, and when did
// the bus last report).
export const DEMO_STATES = [
  { id: 'live', label: 'Live', secondsAgo: 8 },
  { id: 'stale', label: 'Last seen', secondsAgo: 190 },
  { id: 'none', label: 'No trip', secondsAgo: null },
]
const DEMO_KEY = 'schoolbus.demoState'
export function getDemoState() {
  try {
    const id = localStorage.getItem(DEMO_KEY)
    return DEMO_STATES.some((d) => d.id === id) ? id : 'live'
  } catch {
    return 'live'
  }
}
export function setDemoState(id) {
  try {
    localStorage.setItem(DEMO_KEY, id)
  } catch {
    // Storage can be blocked; the choice then lasts only for this screen.
  }
}

// Turns a demo state into what the screens need.
// mode: 'live' | 'stale' | 'none'
export function busStatus(demoId) {
  const demo = DEMO_STATES.find((d) => d.id === demoId) ?? DEMO_STATES[0]
  if (demo.secondsAgo === null) return { mode: 'none', secondsAgo: null }
  const mode = demo.secondsAgo >= STALE_AFTER_SECONDS ? 'stale' : 'live'
  return { mode, secondsAgo: demo.secondsAgo }
}

export function describeAge(seconds, t) {
  return seconds < 60 ? t('age.sec', { n: seconds }) : t('age.min', { n: Math.round(seconds / 60) })
}

// The parent's chosen alert radius is kept in this browser only, for now.
const ALERT_KEY = 'schoolbus.alertMeters'
export const ALERT_PRESETS = [{ meters: 200 }, { meters: 500 }, { meters: 1000 }]
export function getAlertMeters() {
  try {
    const value = Number(localStorage.getItem(ALERT_KEY))
    return ALERT_PRESETS.some((p) => p.meters === value) ? value : 500
  } catch {
    return 500
  }
}
export function setAlertMeters(meters) {
  try {
    localStorage.setItem(ALERT_KEY, String(meters))
  } catch {
    // Storage can be blocked; the choice then lasts only for this screen.
  }
}

// PROTOTYPE ONLY: sample alerts, newest first within each day.
// Alerts are stored as an event type plus values, not as finished text, so each
// parent sees them in their own language.
export const SAMPLE_ALERTS = [
  { id: 1, day: 'today', time: '7:26 AM', type: 'nearStop', bus: 3, radius: 500 },
  { id: 2, day: 'today', time: '7:19 AM', type: 'delayed', bus: 3, reason: 'traffic' },
  { id: 3, day: 'today', time: '7:12 AM', type: 'tripStarted', bus: 3, direction: 'morning' },
  { id: 4, day: 'yesterday', time: '4:41 PM', type: 'tripCompleted', bus: 3, direction: 'afternoon' },
  { id: 5, day: 'yesterday', time: '4:33 PM', type: 'nearStop', bus: 3, radius: 500 },
  { id: 6, day: 'yesterday', time: '4:05 PM', type: 'tripStarted', bus: 3, direction: 'afternoon' },
]
