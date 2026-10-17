import { useState } from 'react'
import Chip from './Chip.jsx'
import { BUSES, ROUTES, STUDENTS, TRIPS, busById, routeById } from './managerData.js'

const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

function statusChip(trip) {
  if (trip.problem) return <Chip tone="red">In progress</Chip>
  if (trip.status === 'in_progress') return <Chip tone="green">In progress</Chip>
  return <Chip>Scheduled {trip.startsAt}</Chip>
}


// PROTOTYPE ONLY: the numbers are sample values and nothing is really deleted.
// In the real app this calls a protected server function that checks the user is
// a manager of this school, deletes location history of FINISHED trips from before
// today (never a trip in progress), and records who did it in the audit log.
const SAMPLE_PENDING = { records: 2160, trips: 12, oldestDaysAgo: 2 }
const AUTO_DELETE_DAYS = 3

function LocationHistoryCard() {
  const [pending, setPending] = useState(SAMPLE_PENDING)
  const [confirming, setConfirming] = useState(false)
  const [lastDeleted, setLastDeleted] = useState(null)

  function deleteNow() {
    setPending({ records: 0, trips: 0, oldestDaysAgo: 0 })
    setLastDeleted(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    setConfirming(false)
  }

  const waiting = pending.records > 0
  return (
    <section className={'rounded-2xl bg-white p-5 ' + (waiting ? 'border-l-[6px] border-amber' : '')}>
      <h2 className="mb-2 text-lg font-bold">Location history</h2>
      {waiting ? (
        <p className="text-[15px] leading-relaxed">
          <b>{pending.records.toLocaleString('en-GB')} location records</b> from {pending.trips} finished trips (before today) are waiting to be deleted. The oldest is {pending.oldestDaysAgo} days old.
        </p>
      ) : (
        <p className="text-[15px] leading-relaxed text-muted">Nothing is waiting. All location history from before today has been deleted.</p>
      )}
      {lastDeleted && <p className="mt-1 text-[13px] text-muted">Last deleted today at {lastDeleted} by Test Manager.</p>}

      {confirming ? (
        <div className="mt-3 flex flex-col gap-3 rounded-xl bg-[#FFF1F1] p-4" role="alertdialog" aria-label="Confirm deleting location history">
          <p className="text-[15px] font-bold">Delete location history of finished trips before today?</p>
          <p className="text-sm leading-relaxed">This cannot be undone. Trips in progress are not touched. Trip summaries (counts and gaps, no locations) are kept.</p>
          <div className="flex gap-2.5">
            <button type="button" onClick={deleteNow} className="min-h-11 rounded-[10px] bg-danger px-4 font-bold text-white">Yes, delete</button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-[10px] border border-field bg-white px-4">Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={!waiting} onClick={() => setConfirming(true)} className="mt-3 min-h-11 rounded-[10px] bg-amber px-4 font-bold disabled:opacity-40">
          Delete location history
        </button>
      )}
      <p className="mt-3 text-[13px] leading-relaxed text-muted">
        Delete it at the end of each school day. As a safety net, anything older than {AUTO_DELETE_DAYS} days is deleted automatically even if nobody presses the button. Each deletion is recorded in the audit log.
      </p>
    </section>
  )
}

export default function Dashboard() {
  const onRoad = TRIPS.filter((t) => t.status === 'in_progress').length
  const problems = TRIPS.filter((t) => t.problem)

  const health = []
  const noStop = STUDENTS.filter((s) => s.stopId === null).length
  if (noStop) health.push(`${noStop} students have no stop`)
  const noPin = ROUTES.flatMap((r) => r.stops).filter((s) => !s.hasPin).length
  if (noPin) health.push(`${noPin} stop has no map pin`)
  ROUTES.forEach((route) => {
    const bus = BUSES.find((b) => b.routeId === route.id)
    if (bus && !bus.driver) health.push(`${route.name} has no assigned driver`)
  })

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[28px] font-bold">Dashboard</h1>
        <p className="text-sm text-muted">{today} · sample data</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl bg-white p-5">
          <p className="text-sm text-muted">Trips today</p>
          <p className="text-[32px] font-extrabold">{TRIPS.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-5">
          <p className="text-sm text-muted">Buses on the road now</p>
          <p className="text-[32px] font-extrabold">{onRoad}</p>
        </div>
        <div className={'rounded-2xl bg-white p-5 ' + (problems.length ? 'border-2 border-danger' : '')}>
          <p className="text-sm font-bold text-[#A62B2B]">Needs attention</p>
          <p className="text-[32px] font-extrabold">{problems.length}</p>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="overflow-x-auto rounded-2xl bg-white p-5 xl:col-span-2">
          <h2 className="mb-2 text-lg font-bold">Today's trips</h2>
          <table className="w-full min-w-[520px] text-left text-[15px]">
            <thead className="text-[13px] text-muted">
              <tr className="border-b border-line">
                <th scope="col" className="py-2 font-normal">Bus</th>
                <th scope="col" className="py-2 font-normal">Route</th>
                <th scope="col" className="py-2 font-normal">Driver</th>
                <th scope="col" className="py-2 font-normal">Status</th>
                <th scope="col" className="py-2 font-normal">Last location</th>
              </tr>
            </thead>
            <tbody>
              {TRIPS.map((trip) => {
                const bus = busById(trip.busId)
                const route = routeById(bus.routeId)
                return (
                  <tr key={trip.id} className="border-b border-line/40 last:border-0">
                    <th scope="row" className="py-3 font-bold">{bus.name}</th>
                    <td>{route.name} {trip.direction.toLowerCase()}</td>
                    <td className={bus.driver ? '' : 'font-bold text-[#A62B2B]'}>{bus.driver ?? 'No driver'}</td>
                    <td>{statusChip(trip)}</td>
                    <td className={trip.problem ? 'font-bold text-[#A62B2B]' : ''}>{trip.lastSeen}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>

        <div className="flex flex-col gap-4">
          <section className={'rounded-2xl bg-white p-5 ' + (problems.length ? 'border-l-[6px] border-danger' : '')}>
            <h2 className="mb-2 text-lg font-bold">Needs attention</h2>
            {problems.length === 0 && <p className="text-[15px] text-muted">Nothing needs attention right now.</p>}
            {problems.map((trip) => (
              <div key={trip.id}>
                <p className="text-[15px] leading-relaxed">
                  <b>{busById(trip.busId).name}:</b> the driver app has sent no location for {trip.silentMinutes} minutes.
                </p>
                <div className="mt-3 flex gap-2.5">
                  <button type="button" disabled title="Built in a later step" className="min-h-11 rounded-[10px] bg-amber px-4 font-bold opacity-50">Call driver</button>
                  <button type="button" disabled title="Built in a later step" className="min-h-11 rounded-[10px] border border-field px-4 opacity-50">Report delay</button>
                </div>
              </div>
            ))}
          </section>
          <LocationHistoryCard />
          <section className="rounded-2xl bg-white p-5">
            <h2 className="mb-2 text-lg font-bold">Setup health</h2>
            {health.length === 0 && <p className="text-[15px] text-muted">Everything is set up.</p>}
            <ul className="flex flex-col gap-2 text-[15px]">
              {health.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        </div>
      </div>
      <p className="text-[13px] font-semibold text-muted">Prototype: sample data, nothing is really deleted, and no sign-in protects this page yet.</p>
    </div>
  )
}
