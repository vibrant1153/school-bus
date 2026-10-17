import { useState } from 'react'
import { ROUTES, STUDENTS, routeById, stopById } from './managerData.js'

const FIELD = 'min-h-11 rounded-[10px] border border-field bg-white px-3 text-[15px]'

export default function Students() {
  const [query, setQuery] = useState('')
  const [routeId, setRouteId] = useState('all')
  const [status, setStatus] = useState('all')

  const shown = STUDENTS.filter((s) => {
    const text = `${s.name} ${s.parent}`.toLowerCase()
    return (
      text.includes(query.trim().toLowerCase()) &&
      (routeId === 'all' || s.routeId === routeId) &&
      (status === 'all' || (status === 'nostop' ? s.stopId === null : s.stopId !== null))
    )
  })

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[28px] font-bold">Students &amp; parents</h1>
          <p className="text-sm text-muted">{STUDENTS.length} students · sample data only, never real children in testing</p>
        </div>
        <div className="flex gap-2.5">
          <button type="button" disabled title="Built in the next step with real data" className="min-h-11 rounded-[10px] border border-field bg-white px-4 text-[15px] opacity-50">Import CSV</button>
          <button type="button" disabled title="Built in the next step with real data" className="min-h-11 rounded-[10px] bg-amber px-4 text-[15px] font-bold opacity-50">Add student</button>
        </div>
      </header>

      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search student or parent"
          aria-label="Search student or parent"
          className={FIELD + ' min-w-56 flex-[2]'}
        />
        <select value={routeId} onChange={(e) => setRouteId(e.target.value)} aria-label="Filter by route" className={FIELD + ' flex-1'}>
          <option value="all">All routes</option>
          {ROUTES.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={FIELD + ' flex-1'}>
          <option value="all">All statuses</option>
          <option value="ok">OK</option>
          <option value="nostop">No stop</option>
        </select>
      </div>

      <section className="overflow-x-auto rounded-2xl bg-white px-5 py-2">
        <table className="w-full min-w-[640px] text-left text-[15px]">
          <thead className="text-[13px] text-muted">
            <tr className="border-b border-line">
              <th scope="col" className="py-3 font-normal">Student</th>
              <th scope="col" className="font-normal">Grade</th>
              <th scope="col" className="font-normal">Route</th>
              <th scope="col" className="font-normal">Stop</th>
              <th scope="col" className="font-normal">Parent (phone hidden)</th>
              <th scope="col" className="font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((s) => (
              <tr key={s.id} className={'border-b border-line/40 last:border-0 ' + (s.stopId === null ? 'bg-[#FFF6E0]' : '')}>
                <th scope="row" className="py-3.5 font-bold">{s.name}</th>
                <td>{s.grade}</td>
                <td>{routeById(s.routeId).name}</td>
                <td className={s.stopId === null ? 'font-bold text-[#A62B2B]' : ''}>{s.stopId ? stopById(s.stopId).name : 'No stop'}</td>
                <td>{s.parent}</td>
                <td className={'font-bold ' + (s.stopId === null ? 'text-[#A62B2B]' : 'text-live')}>{s.stopId === null ? 'Needs a stop' : 'OK'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="py-6 text-center text-muted">No students match your search.</p>}
        <p className="py-3 text-[13px] text-muted">
          Showing {shown.length} of {STUDENTS.length}. Parents log in with email or phone. The school resets passwords here, and every reset will be logged.
        </p>
      </section>
      <p className="text-[13px] font-semibold text-muted">Prototype: search and filters work on sample data. Adding and importing come with the database.</p>
    </div>
  )
}