import { useState } from 'react'
import { useManagerData } from '../lib/useManagerData.js'

const FIELD = 'min-h-11 rounded-xl border border-field bg-white px-3.5 text-sm focus:border-amber focus:outline-none'

export default function Students() {
  const { students, routes, loading, addStudent, deleteStudent, unlinkParent } = useManagerData()

  const [query, setQuery] = useState('')
  const [routeId, setRouteId] = useState('all')
  const [status, setStatus] = useState('all')

  // Add Student modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [newStudentName, setNewStudentName] = useState('')
  const [newStudentGrade, setNewStudentGrade] = useState('3')
  const [adding, setAdding] = useState(false)
  const [modalError, setModalError] = useState(null)

  // Delete & Unlink modal state
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [deletingStudent, setDeletingStudent] = useState(false)
  const [parentToUnlink, setParentToUnlink] = useState(null)
  const [unlinkingParent, setUnlinkingParent] = useState(false)
  const [actionError, setActionError] = useState('')
  const [toastMessage, setToastMessage] = useState(null)

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
    </div>
  )
}