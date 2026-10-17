import { useState } from 'react'
import Chip from './Chip.jsx'
import { BUSES, STUDENTS, routeById } from './managerData.js'

export default function BusesRoutes() {
  const [busId, setBusId] = useState('b1')
  const [direction, setDirection] = useState('Morning')

  const bus = BUSES.find((b) => b.id === busId)
  const route = routeById(bus.routeId)
  // In the afternoon the bus starts at school and visits the stops in reverse.
  const stops = direction === 'Morning' ? route.stops : [...route.stops].reverse()

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold">Buses &amp; routes</h1>
          <p className="text-sm text-muted">Stops are placed by dropping a pin on the map. Parents then choose from this list.</p>
        </div>
        <button type="button" disabled title="Built in the next step with real data" className="min-h-11 rounded-[10px] bg-amber px-4 text-[15px] font-bold opacity-50">Add bus</button>
      </header>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <ul className="flex flex-col gap-3">
          {BUSES.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                aria-pressed={b.id === busId}
                onClick={() => setBusId(b.id)}
                className={'w-full rounded-2xl bg-white p-4 text-left ' + (b.id === busId ? 'border-2 border-amber' : 'border-2 border-transparent')}
              >
                <span className="text-[17px] font-bold">{b.name}</span>
                <span className="mt-1 block text-sm text-muted">
                  Plate {b.plate} ·{' '}
                  {b.driver ?? <b className="text-[#A62B2B]">No driver assigned</b>}
                  <br />{routeById(b.routeId).name} (morning, afternoon)
                </span>
              </button>
            </li>
          ))}
        </ul>

        <section className="flex flex-col gap-2 rounded-2xl bg-white p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">{route.name}</h2>
            <div className="flex gap-2">
              {['Morning', 'Afternoon'].map((d) => (
                <button
                  key={d}
                  type="button"
                  aria-pressed={direction === d}
                  onClick={() => setDirection(d)}
                  className={'min-h-11 rounded-[10px] px-4 text-sm ' + (direction === d ? 'bg-ink font-bold text-white' : 'border border-field')}
                >
                  {d}
                </button>
              ))}
            </div>
          </div>
          <p className="mb-1.5 text-sm text-muted">
            {bus.name} · {bus.driver ?? 'no driver'} · {direction === 'Morning' ? `starts ${route.startTime}` : 'starts at school, stops in reverse'} · school days
          </p>
          <ol className="flex flex-col gap-2">
            {stops.map((stop, index) => {
              const count = STUDENTS.filter((s) => s.stopId === stop.id).length
              return (
                <li key={stop.id} className={'flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ' + (stop.hasPin ? 'border-line/50' : 'border-danger bg-[#FFF1F1]')}>
                  <span className="flex h-6.5 w-6.5 items-center justify-center rounded-full bg-amber text-[13px] font-bold">{index + 1}</span>
                  <span className="flex-1 text-[15px]">{stop.name}</span>
                  {!stop.hasPin ? <Chip tone="red">No map pin</Chip> : stop.isSchool ? <span className="text-[13px] text-muted">School</span> : <span className="text-[13px] text-muted">{count} {count === 1 ? 'student' : 'students'}</span>}
                </li>
              )
            })}
          </ol>
          <div className="mt-3 flex gap-2.5">
            <button type="button" disabled title="Built in the next step with real data" className="min-h-11 rounded-[10px] border border-field px-4 text-[15px] opacity-50">Add stop</button>
            <button type="button" disabled title="Built in the next step with real data" className="min-h-11 rounded-[10px] border border-field px-4 text-[15px] opacity-50">Place pin on map</button>
          </div>
        </section>
      </div>
      <p className="text-[13px] font-semibold text-muted">Prototype: you can switch bus and direction. Editing comes with the database.</p>
    </div>
  )
}