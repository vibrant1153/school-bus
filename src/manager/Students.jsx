import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'

const FIELD = 'min-h-11 rounded-xl border border-field bg-white px-3.5 text-sm focus:border-amber focus:outline-none'

export default function Students() {
  const {
    students,
    routes,
    loading,
    addStudent,
    deleteStudent,
    unlinkParent,
    assignStudentStop,
    linkParentToStudent,
    initializeDefaultRoutesAndBuses,
  } = useManagerData()

  const [query, setQuery] = useState('')
  const [routeId, setRouteId] = useState('all')
  const [status, setStatus] = useState('all')

  // Add Student modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [newStudentName, setNewStudentName] = useState('')
  const [newStudentGrade, setNewStudentGrade] = useState('3')
  const [adding, setAdding] = useState(false)
  const [modalError, setModalError] = useState(null)

  // Assign Route, Stop & Link Parent modal state
  const [studentToAssign, setStudentToAssign] = useState(null)
  const [assignRouteId, setAssignRouteId] = useState('')
  const [assignStopId, setAssignStopId] = useState('')
  const [parentFullName, setParentFullName] = useState('')
  const [parentEmail, setParentEmail] = useState('')
  const [parentPhone, setParentPhone] = useState('')
  const [parentRelationship, setParentRelationship] = useState('Parent')
  const [parentTempPassword, setParentTempPassword] = useState('')
  const [assigning, setAssigning] = useState(false)
  const [assignError, setAssignError] = useState('')
  const [parentCredentials, setParentCredentials] = useState(null)
  const [copiedCreds, setCopiedCreds] = useState(false)
  const [initRoutesLoading, setInitRoutesLoading] = useState(false)

  // Delete & Unlink modal state
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [deletingStudent, setDeletingStudent] = useState(false)
  const [parentToUnlink, setParentToUnlink] = useState(null)
  const [unlinkingParent, setUnlinkingParent] = useState(false)
  const [actionError, setActionError] = useState('')
  const [toastMessage, setToastMessage] = useState(null)

  function openAssignModal(student) {
    setStudentToAssign(student)
    const initialRoute = student.routeId || (routes[0]?.id || '')
    setAssignRouteId(initialRoute)
    setAssignStopId('')
    setParentFullName(student.parentName !== 'No parent linked' ? student.parentName : '')
    setParentEmail('')
    setParentPhone(student.parentPhone || '')
    setParentRelationship('Parent')
    setParentTempPassword('')
    setAssignError('')
  }

  async function handleAssignSubmit(e) {
    e.preventDefault()
    if (!studentToAssign) return
    setAssigning(true)
    setAssignError('')

    try {
      // 1. Assign bus stop if selected
      if (assignStopId) {
        await assignStudentStop({
          studentId: studentToAssign.id,
          stopId: assignStopId,
        })
      }

      // 2. Link or provision parent if email or phone is provided
      if (parentEmail.trim() || parentPhone.trim()) {
        const creds = await linkParentToStudent({
          studentId: studentToAssign.id,
          fullName: parentFullName.trim() || 'Parent Guardian',
          email: parentEmail.trim().toLowerCase(),
          phone: parentPhone.trim() || undefined,
          relationship: parentRelationship,
          tempPassword: parentTempPassword.trim() || undefined,
        })

        if (creds?.temp_password) {
          setParentCredentials({
            fullName: creds.full_name,
            email: creds.email,
            password: creds.temp_password,
            studentName: studentToAssign.fullName,
          })
        }
      }

      setToastMessage(`Updated assignment for ${studentToAssign.fullName}!`)
      setStudentToAssign(null)
      setTimeout(() => setToastMessage(null), 5000)
    } catch (err) {
      console.error('Failed to assign student / link parent:', err)
      setAssignError(err.message || 'Failed to update student assignment.')
    } finally {
      setAssigning(false)
    }
  }

  async function handleInitializeRoutes() {
    setInitRoutesLoading(true)
    try {
      await initializeDefaultRoutesAndBuses()
      setToastMessage('Standard routes and stops created successfully! You can now assign stops.')
      setTimeout(() => setToastMessage(null), 5000)
    } catch (err) {
      alert(err.message || 'Failed to initialize routes.')
    } finally {
      setInitRoutesLoading(false)
    }
  }

  async function handleDeleteStudent() {
    if (!studentToDelete) return
    setDeletingStudent(true)
    setActionError('')
    try {
      await deleteStudent(studentToDelete.id)
      setToastMessage(`Student "${studentToDelete.fullName}" was removed from the roster.`)
      setStudentToDelete(null)
      setTimeout(() => setToastMessage(null), 5000)
    } catch (err) {
      console.error('Failed to delete student:', err)
      setActionError(err.message || 'Failed to delete student.')
    } finally {
      setDeletingStudent(false)
    }
  }

  async function handleUnlinkParent() {
    if (!parentToUnlink || !parentToUnlink.guardianId) return
    setUnlinkingParent(true)
    setActionError('')
    try {
      await unlinkParent(parentToUnlink.guardianId)
      setToastMessage(`Unlinked parent "${parentToUnlink.parentName}" from ${parentToUnlink.fullName}.`)
      setParentToUnlink(null)
      setTimeout(() => setToastMessage(null), 5000)
    } catch (err) {
      console.error('Failed to unlink parent:', err)
      setActionError(err.message || 'Failed to unlink parent.')
    } finally {
      setUnlinkingParent(false)
    }
  }

  const shown = students.filter((s) => {
    const text = `${s.fullName} ${s.parentName}`.toLowerCase()
    const matchesQuery = text.includes(query.trim().toLowerCase())
    const matchesRoute = routeId === 'all' || s.routeId === routeId
    const matchesStatus =
      status === 'all' ||
      (status === 'nostop' ? !s.hasStop : s.hasStop)
    return matchesQuery && matchesRoute && matchesStatus
  })

  async function handleAddStudent(e) {
    e.preventDefault()
    setModalError(null)
    setAdding(true)

    try {
      await addStudent({
        fullName: newStudentName,
        grade: newStudentGrade,
      })
      setNewStudentName('')
      setShowAddModal(false)
    } catch (err) {
      setModalError(err.message || 'Failed to add student.')
    } finally {
      setAdding(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {toastMessage && (
        <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-800">
          <span>✓ {toastMessage}</span>
          <button onClick={() => setToastMessage(null)} className="text-green-800 hover:opacity-75">✕</button>
        </div>
      )}

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold text-ink">Students &amp; Parents</h1>
          <p className="text-sm text-muted">
            {students.length} students enrolled in school transportation roster.
          </p>
        </div>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="rounded-xl bg-amber px-4 py-2.5 text-sm font-bold text-ink hover:opacity-95 shadow-xs"
          >
            + Add Student
          </button>
        </div>
      </header>

      {/* Route Setup Alert Banner when school has 0 routes */}
      {routes.length === 0 && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-200 text-lg shrink-0">
              📍
            </span>
            <div>
              <h3 className="text-sm font-bold text-amber-950">No Bus Routes Configured</h3>
              <p className="text-xs text-amber-900 mt-0.5">
                Students show <strong>&quot;Needs a stop&quot;</strong> because this school has no routes or stops yet. Initialize standard routes to assign bus stops.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={initRoutesLoading}
            onClick={handleInitializeRoutes}
            className="rounded-xl bg-ink px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition-all"
          >
            {initRoutesLoading ? 'Creating Routes…' : '⚡ Initialize Standard Routes & Stops (1-Click)'}
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search student or parent…"
          aria-label="Search student or parent"
          className={FIELD + ' min-w-56 flex-[2]'}
        />
        <select
          value={routeId}
          onChange={(e) => setRouteId(e.target.value)}
          aria-label="Filter by route"
          className={FIELD + ' flex-1'}
        >
          <option value="all">All routes</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className={FIELD + ' flex-1'}
        >
          <option value="all">All statuses</option>
          <option value="ok">Has stop assigned</option>
          <option value="nostop">Needs a stop</option>
        </select>
      </div>

      {/* Students Table */}
      <section className="overflow-x-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="border-b border-gray-200 text-xs font-semibold text-muted uppercase tracking-wider">
            <tr>
              <th scope="col" className="pb-3.5">Student</th>
              <th scope="col" className="pb-3.5">Grade</th>
              <th scope="col" className="pb-3.5">Route</th>
              <th scope="col" className="pb-3.5">Assigned Stop</th>
              <th scope="col" className="pb-3.5">Parent / Guardian</th>
              <th scope="col" className="pb-3.5">Status</th>
              <th scope="col" className="pb-3.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((s) => (
              <tr
                key={s.id}
                className={'hover:bg-gray-50/75 ' + (!s.hasStop ? 'bg-amber-50/40' : '')}
              >
                <td className="py-3.5 font-bold text-ink">{s.fullName}</td>
                <td className="py-3.5 text-muted">{s.grade ?? '—'}</td>
                <td className="py-3.5 text-ink">{s.routeName}</td>
                <td className={'py-3.5 ' + (!s.hasStop ? 'font-bold text-red-700' : 'text-muted')}>
                  {s.morningStop || s.afternoonStop || 'No stop assigned'}
                </td>
                <td className="py-3.5 text-ink">
                  <div>{s.parentName}</div>
                  {s.parentPhone && (
                    <div className="font-mono text-xs text-muted">{s.parentPhone}</div>
                  )}
                </td>
                <td className="py-3.5">
                  <span
                    className={
                      'inline-block rounded-md px-2 py-0.5 text-xs font-bold ' +
                      (s.hasStop
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'bg-red-50 text-red-700')
                    }
                  >
                    {s.hasStop ? 'OK' : 'Needs a stop'}
                  </span>
                </td>
                <td className="py-3.5 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => openAssignModal(s)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100 hover:border-amber-400 transition-colors shadow-2xs"
                      title={`Assign route, stop or link parent for ${s.fullName}`}
                    >
                      ✏️ Assign / Link
                    </button>
                    {s.guardianId && (
                      <button
                        type="button"
                        onClick={() => { setParentToUnlink(s); setActionError('') }}
                        className="rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-semibold text-muted hover:bg-gray-100 hover:text-ink transition-colors"
                        title={`Unlink parent ${s.parentName} from ${s.fullName}`}
                      >
                        Unlink Parent
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => { setStudentToDelete(s); setActionError('') }}
                      className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-100 hover:text-red-700 transition-colors shadow-xs"
                      title={`Delete ${s.fullName} from roster`}
                    >
                      🗑️ Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {shown.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">No students match your filter.</p>
        )}

        <div className="border-t border-gray-100 pt-3 text-xs text-muted">
          Showing {shown.length} of {students.length} students. Protected under single-school tenant isolation.
        </div>
      </section>

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Add New Student</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAddStudent} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">Student Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Yonas Bekele"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Grade Level</label>
                <select
                  value={newStudentGrade}
                  onChange={(e) => setNewStudentGrade(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field bg-white p-2.5 text-sm text-ink"
                >
                  {[...Array(13).keys()].map((g) => (
                    <option key={g} value={g}>
                      {g === 0 ? 'Kindergarten' : `Grade ${g}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="rounded-xl bg-amber px-5 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
                >
                  {adding ? 'Saving…' : 'Add Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Student Confirmation Modal */}
      {studentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-red-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Delete Student</h3>
              <button
                type="button"
                onClick={() => { setStudentToDelete(null); setActionError('') }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-700">
              Are you sure you want to permanently delete <strong className="text-ink">{studentToDelete.fullName}</strong> (Grade {studentToDelete.grade ?? '—'}) from your school roster?
            </p>

            <div className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-800">
              ⚠️ <strong>Roster Deletion:</strong> This removes the student, associated stop assignments, attendance/absence records, and parent links.
            </div>

            {actionError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {actionError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setStudentToDelete(null); setActionError('') }}
                disabled={deletingStudent}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteStudent}
                disabled={deletingStudent}
                className="rounded-xl bg-danger px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {deletingStudent ? 'Deleting…' : 'Yes, Delete Student'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlink Parent Confirmation Modal */}
      {parentToUnlink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Unlink Parent</h3>
              <button
                type="button"
                onClick={() => { setParentToUnlink(null); setActionError('') }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-700">
              Unlink parent <strong className="text-ink">{parentToUnlink.parentName}</strong> from student <strong className="text-ink">{parentToUnlink.fullName}</strong>?
            </p>

            <p className="mt-2 text-xs text-muted">
              The parent user account will remain active, but they will no longer receive live bus alerts or view trip progress for this student.
            </p>

            {actionError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {actionError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setParentToUnlink(null); setActionError('') }}
                disabled={unlinkingParent}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnlinkParent}
                disabled={unlinkingParent}
                className="rounded-xl bg-amber px-4 py-2.5 text-xs font-bold text-ink shadow-sm hover:opacity-95 disabled:opacity-50"
              >
                {unlinkingParent ? 'Unlinking…' : 'Yes, Unlink Parent'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Assign Route, Stop & Link Parent Modal */}
      {studentToAssign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-gray-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3.5">
              <div className="flex items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-lg">
                  ✏️
                </span>
                <div>
                  <h3 className="text-lg font-bold text-ink">Assign Route &amp; Link Parent</h3>
                  <p className="text-xs text-muted font-medium">
                    {studentToAssign.fullName} • Grade {studentToAssign.grade ?? '—'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setStudentToAssign(null); setAssignError('') }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {assignError && (
              <div className="mt-4 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                {assignError}
              </div>
            )}

            <form onSubmit={handleAssignSubmit} className="mt-5 flex flex-col gap-5">
              {/* Section 1: Route & Bus Stop Assignment */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
                    <span>🚌</span>
                    <span>Bus Route &amp; Stop Assignment</span>
                  </span>
                  <span className="text-[11px] font-semibold text-muted">
                    {studentToAssign.hasStop ? '✓ Currently Assigned' : '⚠️ Needs Stop'}
                  </span>
                </div>

                {routes.length === 0 ? (
                  <div className="rounded-lg bg-amber-100/70 p-3 text-xs text-amber-950 flex flex-col gap-2">
                    <p>
                      No bus routes exist for your school yet. Create routes and stops first to assign this student to a bus.
                    </p>
                    <button
                      type="button"
                      disabled={initRoutesLoading}
                      onClick={handleInitializeRoutes}
                      className="self-start rounded-lg bg-ink px-3 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-slate-800 disabled:opacity-50"
                    >
                      {initRoutesLoading ? 'Creating Routes…' : '⚡ Initialize Standard Routes & Stops (1-Click)'}
                    </button>
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-semibold text-ink">Select Bus Route</label>
                      <select
                        value={assignRouteId}
                        onChange={(e) => {
                          setAssignRouteId(e.target.value)
                          setAssignStopId('')
                        }}
                        className="mt-1 w-full rounded-lg border border-field bg-white p-2 text-xs font-medium text-ink"
                      >
                        <option value="">Choose a route…</option>
                        {routes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({r.code || 'Route'})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-ink">Assigned Bus Stop</label>
                      <select
                        value={assignStopId}
                        onChange={(e) => setAssignStopId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-field bg-white p-2 text-xs font-medium text-ink"
                      >
                        <option value="">Choose pickup/drop-off stop…</option>
                        {(routes.find((r) => r.id === assignRouteId)?.stops || []).map((st) => (
                          <option key={st.id} value={st.id}>
                            {st.name} {st.is_school ? '(School)' : ''}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[10px] text-muted">
                        Assigned as both morning pickup &amp; afternoon drop-off stop.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Section 2: Parent / Guardian Account */}
              <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 flex flex-col gap-3">
                <span className="text-xs font-bold uppercase tracking-wider text-ink flex items-center gap-1.5">
                  <span>👨‍👩‍👧</span>
                  <span>Parent / Guardian Account</span>
                </span>

                {studentToAssign.guardianId && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 text-xs text-emerald-900 font-medium">
                    Currently linked to: <strong>{studentToAssign.parentName}</strong> {studentToAssign.parentPhone ? `(${studentToAssign.parentPhone})` : ''}
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-ink">Parent Full Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Sabir Ahmed"
                      value={parentFullName}
                      onChange={(e) => setParentFullName(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-field p-2 text-xs text-ink"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-ink">Relationship</label>
                    <select
                      value={parentRelationship}
                      onChange={(e) => setParentRelationship(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-field bg-white p-2 text-xs text-ink"
                    >
                      <option value="Parent">Parent</option>
                      <option value="Mother">Mother</option>
                      <option value="Father">Father</option>
                      <option value="Guardian">Guardian</option>
                    </select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-xs font-semibold text-ink">Parent Login Email</label>
                    <input
                      type="email"
                      placeholder="e.g. parent.halid@gmail.com"
                      value={parentEmail}
                      onChange={(e) => setParentEmail(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-field p-2 text-xs text-ink"
                    />
                    <p className="mt-1 text-[10px] text-muted">
                      Used by the parent to log into the Parent Portal.
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-ink">Contact Phone Number</label>
                    <input
                      type="tel"
                      placeholder="e.g. +251912345678 or 0912345678"
                      value={parentPhone}
                      onChange={(e) => setParentPhone(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-field p-2 text-xs text-ink"
                    />
                    <p className="mt-1 text-[10px] text-muted">
                      Receives 500m proximity SMS / call alerts.
                    </p>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-ink">Temporary Password (Optional)</label>
                  <input
                    type="text"
                    placeholder="Leave blank to auto-generate secure password"
                    value={parentTempPassword}
                    onChange={(e) => setParentTempPassword(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-field p-2 text-xs font-mono text-ink"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => { setStudentToAssign(null); setAssignError('') }}
                  disabled={assigning}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={assigning}
                  className="rounded-xl bg-amber px-5 py-2.5 text-xs font-bold text-ink hover:opacity-95 disabled:opacity-50 shadow-xs"
                >
                  {assigning ? 'Saving Assignment…' : 'Save Assignment & Link'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Parent Credentials Modal */}
      {parentCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-200">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-lg">
                  👨‍👩‍👧
                </span>
                <div>
                  <h3 className="text-base font-bold text-ink">Parent Account Linked!</h3>
                  <p className="text-xs text-muted">Ready for login at the Parent Portal</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setParentCredentials(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-xs text-muted leading-relaxed">
              Parent account for <strong>{parentCredentials.fullName}</strong> is now connected to student <strong>{parentCredentials.studentName}</strong>. Share these login details with the parent:
            </p>

            <div className="mt-3.5 rounded-xl border border-gray-200 bg-gray-50 p-4 font-mono text-xs flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-muted">Login Email:</span>
                <span className="font-bold text-ink">{parentCredentials.email}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200/60 pt-2">
                <span className="text-muted">Temp Password:</span>
                <span className="font-bold text-ink">{parentCredentials.password}</span>
              </div>
              <div className="flex justify-between border-t border-gray-200/60 pt-2">
                <span className="text-muted">Portal URL:</span>
                <span className="font-bold text-amber-900">school-bus-iota.vercel.app/login</span>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const text = `SchoolBus Connect - Parent Portal Login\nStudent: ${parentCredentials.studentName}\nLogin: ${parentCredentials.email}\nTemporary Password: ${parentCredentials.password}\nLogin URL: https://school-bus-iota.vercel.app/login`
                  navigator.clipboard.writeText(text)
                  setCopiedCreds(true)
                  setTimeout(() => setCopiedCreds(false), 3000)
                }}
                className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-xs font-bold text-ink hover:bg-gray-50 shadow-2xs"
              >
                {copiedCreds ? '✓ Copied to Clipboard!' : '📋 Copy Credentials'}
              </button>
              <button
                type="button"
                onClick={() => setParentCredentials(null)}
                className="rounded-xl bg-ink px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}