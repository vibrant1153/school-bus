import { useState, useRef } from 'react'
import { useManagerData } from '../lib/useManagerData.js'
import {
  parseStudentFile,
  downloadStudentTemplateCsv,
  downloadInvitesCsv,
} from '../lib/fileParser.js'

const FIELD = 'h-10 rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs text-[#172033] focus:border-[#0D9488] focus:ring-1 focus:ring-[#0D9488] focus:outline-none transition-colors'

export default function Students() {
  const {
    school,
    students,
    routes,
    loading,
    addStudent,
    bulkAddStudents,
    deleteStudent,
    unlinkParent,
    assignStudentStop,
    generateParentInvite,
    revokeParentInvite,
    initializeDefaultRoutesAndBuses,
  } = useManagerData()

  const [query, setQuery] = useState('')
  const [routeId, setRouteId] = useState('all')
  const [status, setStatus] = useState('all')

  // Add Student modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [newStudentName, setNewStudentName] = useState('')
  const [newStudentGrade, setNewStudentGrade] = useState('3')
  const [newParentPhone, setNewParentPhone] = useState('')
  const [newRouteId, setNewRouteId] = useState('')
  const [newStopId, setNewStopId] = useState('')
  const [adding, setAdding] = useState(false)
  const [modalError, setModalError] = useState(null)

  // Bulk CSV / File Import state
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [bulkFile, setBulkFile] = useState(null)
  const [parsedRoster, setParsedRoster] = useState(null)
  const [parsingFile, setParsingFile] = useState(false)
  const [importingBatch, setImportingBatch] = useState(false)
  const [autoGenInvites, setAutoGenInvites] = useState(true)
  const [importResult, setImportResult] = useState(null)
  const [bulkError, setBulkError] = useState(null)
  const [copiedBatchInvites, setCopiedBatchInvites] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  // Invitation Modal State
  const [inviteModalStudent, setInviteModalStudent] = useState(null)
  const [inviteLinkData, setInviteLinkData] = useState(null)
  const [invitePhoneNumber, setInvitePhoneNumber] = useState('')
  const [generatingInvite, setGeneratingInvite] = useState(false)
  const [inviteError, setInviteError] = useState(null)
  const [copiedLink, setCopiedLink] = useState(false)
  const [revokingInvite, setRevokingInvite] = useState(false)

  // Assign Stop Modal state
  const [studentToAssignStop, setStudentToAssignStop] = useState(null)
  const [assignRouteId, setAssignRouteId] = useState('')
  const [assignStopId, setAssignStopId] = useState('')
  const [savingStop, setSavingStop] = useState(false)
  const [stopError, setStopError] = useState('')
  const [stopSuccess, setStopSuccess] = useState('')

  // Delete & Unlink modal state
  const [studentToDelete, setStudentToDelete] = useState(null)
  const [deletingStudent, setDeletingStudent] = useState(false)
  const [parentToUnlink, setParentToUnlink] = useState(null)
  const [unlinkingParent, setUnlinkingParent] = useState(false)
  const [actionError, setActionError] = useState('')
  const [toastMessage, setToastMessage] = useState(null)
  const [initRoutesLoading, setInitRoutesLoading] = useState(false)

  // 1. File Upload & Parse Handlers
  async function handleFileSelect(file) {
    if (!file) return
    setBulkFile(file)
    setParsingFile(true)
    setBulkError(null)
    setImportResult(null)

    try {
      const result = await parseStudentFile(file, routes)
      setParsedRoster(result)
    } catch (err) {
      console.error('File parse error:', err)
      setBulkError(err.message || 'Failed to parse file. Please verify CSV or text formatting.')
    } finally {
      setParsingFile(false)
    }
  }

  async function handleExecuteBulkImport() {
    if (!parsedRoster || parsedRoster.rows.length === 0) return
    setImportingBatch(true)
    setBulkError(null)

    try {
      const validRows = parsedRoster.rows.filter((r) => r.status !== 'error')
      if (validRows.length === 0) {
        throw new Error('No valid students to import. Please ensure students have names.')
      }

      const res = await bulkAddStudents(validRows, {
        generateInvites: autoGenInvites,
      })

      setImportResult(res)
      setToastMessage(`Successfully imported ${res.count} students!`)
    } catch (err) {
      console.error('Bulk import error:', err)
      setBulkError(err.message || 'Failed to complete bulk student import.')
    } finally {
      setImportingBatch(false)
    }
  }

  function handleResetBulkModal() {
    setBulkFile(null)
    setParsedRoster(null)
    setBulkError(null)
    setImportResult(null)
    setCopiedBatchInvites(false)
    setShowBulkModal(false)
  }

  function handleCopyAllInvites() {
    if (!importResult?.invitations?.length) return
    const text = importResult.invitations
      .map((inv) => `${inv.studentName} (${inv.phoneNumber}): ${inv.url}`)
      .join('\n')
    navigator.clipboard.writeText(text)
    setCopiedBatchInvites(true)
    setTimeout(() => setCopiedBatchInvites(false), 3000)
  }

  // 2. Open Invite Modal for a student
  function openInviteModal(student) {
    setInviteModalStudent(student)
    setInvitePhoneNumber(student.parentPhone || '')
    setInviteLinkData(null)
    setInviteError(null)
    setCopiedLink(false)

    if (student.parentPhone) {
      handleGenerateInvite(student, student.parentPhone)
    }
  }

  // Generate / Regenerate invitation link
  async function handleGenerateInvite(student, phoneToUse) {
    const targetStudent = student || inviteModalStudent
    const targetPhone = phoneToUse || invitePhoneNumber || targetStudent?.parentPhone

    if (!targetStudent) return
    if (!targetPhone?.trim()) {
      setInviteError('Please enter a parent phone number.')
      return
    }

    setGeneratingInvite(true)
    setInviteError(null)

    try {
      const res = await generateParentInvite({
        studentId: targetStudent.id,
        phoneNumber: targetPhone.trim(),
      })

      const origin = window.location.origin
      const inviteUrl = `${origin}/invite/${res.token}`

      setInviteLinkData({
        url: inviteUrl,
        token: res.token,
        phoneNumber: res.phone_number,
        expiresAt: res.expires_at,
        studentName: targetStudent.fullName,
      })
      setInvitePhoneNumber(res.phone_number)
      setToastMessage(`Generated single-use invite for ${targetStudent.fullName}!`)
    } catch (err) {
      console.error('Failed to generate invite:', err)
      setInviteError(err.message || 'Failed to generate invitation link.')
    } finally {
      setGeneratingInvite(false)
    }
  }

  // Revoke invitation
  async function handleRevokeInvite() {
    if (!inviteModalStudent) return
    setRevokingInvite(true)
    setInviteError(null)

    try {
      await revokeParentInvite({
        studentId: inviteModalStudent.id,
        inviteId: inviteModalStudent.latestInvite?.id,
      })
      setInviteLinkData(null)
      setToastMessage(`Revoked invitation for ${inviteModalStudent.fullName}.`)
      setInviteModalStudent(null)
    } catch (err) {
      console.error('Failed to revoke invite:', err)
      setInviteError(err.message || 'Failed to revoke invitation.')
    } finally {
      setRevokingInvite(false)
    }
  }

  // Share helpers
  function copyInviteLink() {
    if (!inviteLinkData?.url) return
    navigator.clipboard.writeText(inviteLinkData.url)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 3000)
  }

  function shareWhatsApp() {
    if (!inviteLinkData?.url || !inviteModalStudent) return
    const msg = `Hello! You are invited to connect to SchoolBus Connect to track ${inviteModalStudent.fullName}'s school bus live.\n\nPlease open this link to create your account and connect to your child:\n${inviteLinkData.url}\n\n(This secure link is single-use and expires in 72 hours.)`
    const digits = (inviteLinkData.phoneNumber || '').replace(/\D/g, '')
    const waUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`
    window.open(waUrl, '_blank')
  }

  function shareSMS() {
    if (!inviteLinkData?.url || !inviteModalStudent) return
    const msg = `SchoolBus Connect: Track ${inviteModalStudent.fullName}'s bus live. Open link to register: ${inviteLinkData.url}`
    const digits = (inviteLinkData.phoneNumber || '').replace(/\D/g, '')
    const smsUrl = `sms:${digits}?body=${encodeURIComponent(msg)}`
    window.location.href = smsUrl
  }

  // 3. Open Stop Assignment modal
  function openAssignStopModal(student) {
    setStudentToAssignStop(student)
    const initialRoute = student.routeId || (routes[0]?.id || '')
    setAssignRouteId(initialRoute)
    setAssignStopId(student.stopId || '')
    setStopError('')
    setStopSuccess('')
  }

  async function handleSaveStop(e) {
    if (e) e.preventDefault()
    if (!studentToAssignStop) return
    if (!assignStopId) {
      setStopError('Please select a bus stop from the list.')
      return
    }
    setSavingStop(true)
    setStopError('')
    setStopSuccess('')
    try {
      await assignStudentStop({
        studentId: studentToAssignStop.id,
        stopId: assignStopId,
      })
      setStopSuccess('✓ Bus stop updated successfully!')
      setToastMessage(`Updated bus stop for ${studentToAssignStop.fullName}!`)
      setStudentToAssignStop((prev) => prev ? { ...prev, hasStop: true, stopId: assignStopId } : null)
      setTimeout(() => {
        setStopSuccess('')
        setStudentToAssignStop(null)
      }, 1200)
    } catch (err) {
      console.error('Failed to assign stop:', err)
      setStopError(err.message || 'Failed to assign stop.')
    } finally {
      setSavingStop(false)
    }
  }

  async function handleAddStudent(e) {
    e.preventDefault()
    setModalError(null)
    setAdding(true)

    try {
      const res = await addStudent({
        fullName: newStudentName,
        grade: newStudentGrade,
        parentPhone: newParentPhone || undefined,
        stopId: newStopId || undefined,
      })

      const createdStudent = res.student
      setShowAddModal(false)
      setNewStudentName('')
      setNewParentPhone('')
      setNewRouteId('')
      setNewStopId('')

      setToastMessage(`Added student "${createdStudent.full_name}" successfully!`)

      if (newParentPhone.trim() && createdStudent?.id) {
        openInviteModal({
          id: createdStudent.id,
          fullName: createdStudent.full_name,
          parentPhone: newParentPhone.trim(),
        })
      }
    } catch (err) {
      setModalError(err.message || 'Failed to add student.')
    } finally {
      setAdding(false)
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
      setToastMessage(`Unlinked parent from ${parentToUnlink.fullName}.`)
      setParentToUnlink(null)
      setTimeout(() => setToastMessage(null), 5000)
    } catch (err) {
      console.error('Failed to unlink parent:', err)
      setActionError(err.message || 'Failed to unlink parent.')
    } finally {
      setUnlinkingParent(false)
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

  // Filter students
  const shown = students.filter((s) => {
    const text = `${s.fullName} ${s.parentName} ${s.parentPhone || ''}`.toLowerCase()
    const matchesQuery = text.includes(query.trim().toLowerCase())
    const matchesRoute = routeId === 'all' || s.routeId === routeId
    const matchesStatus =
      status === 'all' ||
      (status === 'nostop' ? !s.hasStop : false) ||
      (status === 'ok' ? s.hasStop : false) ||
      (status === 'unlinked' ? s.inviteStatus !== 'linked' : false) ||
      (status === 'linked' ? s.inviteStatus === 'linked' : false)
    return matchesQuery && matchesRoute && matchesStatus
  })

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-9 w-9 animate-spin rounded-full border-4 border-amber border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="card-3d flex items-center justify-between rounded-2xl border border-emerald-300 bg-emerald-50/95 p-3.5 text-xs font-bold text-emerald-950 shadow-sm animate-fadeIn">
          <span className="flex items-center gap-2">
            <span className="text-emerald-600">✓</span>
            <span>{toastMessage}</span>
          </span>
          <button onClick={() => setToastMessage(null)} className="text-emerald-800 hover:opacity-75 font-black text-sm">✕</button>
        </div>
      )}

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033]">Students &amp; Rosters</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            {students.length} students enrolled · Invitation-based parent linking and stop assignment
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setBulkFile(null)
              setParsedRoster(null)
              setBulkError(null)
              setImportResult(null)
              setShowBulkModal(true)
            }}
            className="flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3.5 py-2 text-xs font-semibold text-[#172033] hover:bg-slate-50 transition-colors shadow-2xs"
            title="Upload CSV, TSV, or spreadsheet export of students"
          >
            <svg className="h-3.5 w-3.5 text-[#64748B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <span>Import Roster CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[#0D9488] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#0F766E] transition-colors shadow-2xs"
          >
            <span className="text-sm font-bold leading-none">＋</span>
            <span>Add Student</span>
          </button>
        </div>
      </div>

      {/* Route Setup Alert Banner when school has 0 routes */}
      {routes.length === 0 && (
        <div className="card-3d rounded-3xl border border-amber-300 bg-amber-50/90 p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-200 text-xl shrink-0 shadow-2xs">
              📍
            </span>
            <div>
              <h3 className="text-sm font-black text-amber-950">No Bus Routes Configured</h3>
              <p className="text-xs text-amber-900 mt-0.5 font-medium leading-relaxed">
                Students will show <strong>&quot;Needs a stop&quot;</strong> until routes are set up. Click below to initialize standard school bus routes and stops.
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={initRoutesLoading}
            onClick={handleInitializeRoutes}
            className="btn-3d-subtle rounded-2xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {initRoutesLoading ? 'Creating Routes…' : '⚡ Initialize Standard Routes (1-Click)'}
          </button>
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search student, parent, or phone…"
          aria-label="Search student or parent"
          className={FIELD + ' min-w-56 flex-[2] shadow-2xs'}
        />
        <select
          value={routeId}
          onChange={(e) => setRouteId(e.target.value)}
          aria-label="Filter by route"
          className={FIELD + ' flex-1 shadow-2xs'}
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
          className={FIELD + ' flex-1 shadow-2xs'}
        >
          <option value="all">All statuses</option>
          <option value="ok">Has bus stop</option>
          <option value="nostop">Needs bus stop</option>
          <option value="linked">Parent Linked</option>
          <option value="unlinked">Parent Not Linked</option>
        </select>
        {(query || routeId !== 'all' || status !== 'all') && (
          <button
            type="button"
            onClick={() => {
              setQuery('')
              setRouteId('all')
              setStatus('all')
            }}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition-colors shadow-2xs"
          >
            ✕ Reset
          </button>
        )}
      </div>

      {/* Students Table Section */}
      <section className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                <th scope="col" className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Student</th>
                <th scope="col" className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Grade</th>
                <th scope="col" className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Route &amp; Stop</th>
                <th scope="col" className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Parent Status</th>
                <th scope="col" className="py-3 px-4 text-right font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]">
            {shown.map((s) => {
              const isLinked = s.inviteStatus === 'linked'
              const isPending = s.inviteStatus === 'pending'
              const isExpired = s.inviteStatus === 'expired'

              return (
                <tr
                  key={s.id}
                  className="hover:bg-slate-50/70 transition-colors"
                >
                  {/* Student Name */}
                  <td className="py-3.5">
                    <div className="font-black text-slate-900">{s.fullName}</div>
                    <div className="text-[11px] font-semibold text-slate-400">
                      ID: {s.id.slice(0, 8)}…
                    </div>
                  </td>

                  {/* Grade */}
                  <td className="py-3.5 text-xs font-bold text-slate-600">
                    {s.grade === 0 ? 'Kindergarten' : (s.grade ? `Grade ${s.grade}` : '—')}
                  </td>

                  {/* Route & Stop */}
                  <td className="py-3.5">
                    <div className="text-xs font-bold text-slate-800">
                      {s.routeName || 'No Route'}
                    </div>
                    <div className={'text-xs font-medium ' + (!s.hasStop ? 'text-amber-700 font-bold' : 'text-slate-500')}>
                      📍 {s.morningStop || s.afternoonStop || 'No stop assigned'}
                    </div>
                  </td>

                  {/* Parent & Invite Status */}
                  <td className="py-3.5">
                    <div className="flex flex-col gap-1 items-start">
                      {isLinked ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-black text-emerald-800 border border-emerald-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          ✓ Linked: {s.parentName}
                        </span>
                      ) : isPending ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-black text-amber-900 border border-amber-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                          ⏳ Invite Pending
                        </span>
                      ) : isExpired ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-[11px] font-black text-rose-800 border border-rose-200">
                          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                          ⚠️ Invite Expired
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600 border border-slate-200">
                          Not Invited
                        </span>
                      )}

                      {s.parentPhone && (
                        <span className="font-mono text-[11px] text-slate-500">
                          📞 {s.parentPhone}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {/* Invite Parent Button */}
                      {!isLinked && (
                        <button
                          type="button"
                          onClick={() => openInviteModal(s)}
                          className={
                            'rounded-xl px-3 py-1.5 text-xs font-black transition-all shadow-2xs ' +
                            (isPending
                              ? 'btn-3d-amber text-slate-950'
                              : 'btn-3d-subtle text-slate-800')
                          }
                          title={`Generate parent invitation link for ${s.fullName}`}
                        >
                          {isPending ? '🔗 Share Link' : '✉️ Invite Parent'}
                        </button>
                      )}

                      {/* Manage Stop Button */}
                      <button
                        type="button"
                        onClick={() => openAssignStopModal(s)}
                        className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 active:scale-95 transition-all shadow-2xs"
                        title="Assign bus route & stop"
                      >
                        🚌 Stop
                      </button>

                      {/* If linked, allow unlink */}
                      {isLinked && s.guardianId && (
                        <button
                          type="button"
                          onClick={() => { setParentToUnlink(s); setActionError('') }}
                          className="rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-bold text-amber-800 hover:bg-amber-50 active:scale-95 transition-all shadow-2xs"
                          title="Unlink parent from this student"
                        >
                          Unlink
                        </button>
                      )}

                      {/* Delete Student */}
                      <button
                        type="button"
                        onClick={() => { setStudentToDelete(s); setActionError('') }}
                        className="flex h-7 w-7 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs text-red-500 hover:bg-red-50 hover:border-red-300 active:scale-95 transition-all shadow-2xs"
                        title={`Delete ${s.fullName} from roster`}
                      >
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan="5" className="py-8 text-center text-xs text-[#64748B]">
                  No students found matching your search or filter.
                </td>
              </tr>
            )}
          </tbody>
          </table>
        </div>

        <div className="border-t border-[#E2E8F0] px-4 py-3 text-[11px] font-medium text-[#64748B] bg-[#F8FAFC]">
          Showing {shown.length} of {students.length} students enrolled in school transportation.
        </div>
      </section>

      {/* Bulk CSV / File Import Modal */}
      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-2xl rounded-3xl p-6 shadow-2xl border border-white/90 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-lg shadow-2xs">
                  📁
                </span>
                <div>
                  <h3 className="text-lg font-black text-slate-900">Import Students from File</h3>
                  <p className="text-xs text-slate-500 font-medium">Bulk upload CSV, TSV, or spreadsheet export</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleResetBulkModal}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            {bulkError && (
              <div className="mt-4 rounded-2xl bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
                ✕ {bulkError}
              </div>
            )}

            {/* Step 1: No file selected yet */}
            {!parsedRoster && !importResult && (
              <div className="mt-5 flex flex-col gap-4">
                {/* Drag and Drop Zone */}
                <div
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDragging(false)
                    const file = e.dataTransfer.files?.[0]
                    if (file) handleFileSelect(file)
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  className={
                    'cursor-pointer rounded-3xl border-2 border-dashed p-8 text-center transition-all flex flex-col items-center justify-center gap-3 ' +
                    (isDragging
                      ? 'border-amber bg-amber-50/60 scale-[1.01]'
                      : 'border-slate-300 bg-slate-50/70 hover:bg-slate-100/60 hover:border-slate-400')
                  }
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.tsv,.txt,.json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileSelect(file)
                    }}
                  />
                  <span className="text-4xl">📄</span>
                  <div>
                    <p className="text-sm font-black text-slate-800">
                      {parsingFile ? 'Reading & parsing file…' : 'Drop your student roster CSV file here, or browse'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      Supports .csv, .tsv, .txt, or .json with student name, grade, parent phone, and bus stop.
                    </p>
                  </div>
                  <span className="btn-3d-subtle rounded-xl px-4 py-2 text-xs font-black text-slate-800">
                    Browse Files
                  </span>
                </div>

                {/* Sample Template & Help */}
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h4 className="text-xs font-black text-slate-800">Need a format template?</h4>
                    <p className="text-[11px] text-slate-500 font-medium">
                      Download our ready-to-use CSV template pre-filled with column headers and examples.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadStudentTemplateCsv(routes)}
                    className="btn-3d-subtle rounded-xl px-3.5 py-2 text-xs font-black text-slate-900"
                  >
                    📥 Download CSV Template
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: File Parsed - Show Smart Preview */}
            {parsedRoster && !importResult && (
              <div className="mt-5 flex flex-col gap-4">
                {/* Stats Bar */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 border border-slate-200/80 p-3.5">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-slate-800">{bulkFile?.name}</span>
                    <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                      {parsedRoster.totalCount} rows detected
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-xs font-bold">
                    <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px]">
                      ✓ {parsedRoster.validCount} Valid
                    </span>
                    {parsedRoster.warningCount > 0 && (
                      <span className="rounded-full bg-amber-100 text-amber-900 px-2.5 py-0.5 text-[11px]">
                        ⚠️ {parsedRoster.warningCount} Warnings
                      </span>
                    )}
                    {parsedRoster.errorCount > 0 && (
                      <span className="rounded-full bg-rose-100 text-rose-800 px-2.5 py-0.5 text-[11px]">
                        ✕ {parsedRoster.errorCount} Errors
                      </span>
                    )}
                  </div>
                </div>

                {/* Option: Auto Generate Invites */}
                <label className="flex items-center gap-2.5 rounded-2xl border border-amber-200 bg-amber-50/70 p-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoGenInvites}
                    onChange={(e) => setAutoGenInvites(e.target.checked)}
                    className="h-4 w-4 rounded accent-amber-500 cursor-pointer"
                  />
                  <div className="text-xs">
                    <span className="font-extrabold text-amber-950">
                      Automatically generate parent invitation links
                    </span>
                    <p className="text-[11px] text-amber-900/80 font-medium">
                      Creates 1-click single-use invitation links for all students with parent phone numbers.
                    </p>
                  </div>
                </label>

                {/* Preview Table */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200 max-h-60 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-100 text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5">#</th>
                        <th className="p-2.5">Student Name</th>
                        <th className="p-2.5">Grade</th>
                        <th className="p-2.5">Parent Phone</th>
                        <th className="p-2.5">Bus Stop</th>
                        <th className="p-2.5">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {parsedRoster.rows.map((row) => (
                        <tr key={row.index} className={row.status === 'error' ? 'bg-red-50/50' : ''}>
                          <td className="p-2.5 text-slate-400 font-mono text-[10px]">{row.index}</td>
                          <td className="p-2.5 font-bold text-slate-900">{row.fullName || <span className="text-red-500 italic">Missing Name</span>}</td>
                          <td className="p-2.5 text-slate-600">{row.grade !== null ? `Grade ${row.grade}` : (row.rawGrade || '—')}</td>
                          <td className="p-2.5 font-mono text-slate-700">{row.parentPhone || <span className="text-slate-400 italic">None</span>}</td>
                          <td className="p-2.5">
                            <div className="flex flex-col gap-1">
                              <select
                                value={row.matchedStopId || ''}
                                onChange={(e) => {
                                  const selectedId = e.target.value
                                  let selectedStopName = null
                                  routes.forEach((r) => {
                                    const st = (r.stops || []).find((s) => s.id === selectedId)
                                    if (st) selectedStopName = st.name
                                  })

                                  setParsedRoster((prev) => {
                                    if (!prev) return prev
                                    const updatedRows = prev.rows.map((r) => {
                                      if (r.index !== row.index) return r
                                      const hasName = Boolean(r.fullName)
                                      return {
                                        ...r,
                                        matchedStopId: selectedId || null,
                                        matchedStopName: selectedStopName,
                                        status: hasName ? (r.parentPhone ? 'valid' : 'warning') : 'error',
                                        issues: r.parentPhone ? [] : ['No parent phone'],
                                      }
                                    })
                                    return {
                                      ...prev,
                                      rows: updatedRows,
                                      validCount: updatedRows.filter((r) => r.status === 'valid').length,
                                      warningCount: updatedRows.filter((r) => r.status === 'warning').length,
                                      errorCount: updatedRows.filter((r) => r.status === 'error').length,
                                    }
                                  })
                                }}
                                className="h-8 max-w-[210px] rounded-lg border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-800 focus:border-[#0D9488] focus:outline-none"
                              >
                                <option value="">
                                  {row.targetStopName && !row.matchedStopId
                                    ? `⚠️ "${row.targetStopName}" (Assign Stop…)`
                                    : '— No specific stop —'}
                                </option>
                                {routes.map((r) => (
                                  <optgroup key={r.id} label={r.name}>
                                    {(r.stops || []).map((st) => (
                                      <option key={st.id} value={st.id}>
                                        {st.name} {st.is_school ? '🏫' : ''}
                                      </option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                              {row.targetStopName && !row.matchedStopId && (
                                <span className="text-[10px] text-amber-700 font-mono">Area: "{row.targetStopName}"</span>
                              )}
                            </div>
                          </td>
                          <td className="p-2.5">
                            {row.status === 'valid' ? (
                              <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-black text-emerald-800">Ready</span>
                            ) : row.status === 'warning' ? (
                              <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">{row.issues[0]}</span>
                            ) : (
                              <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-black text-red-700">Error</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Action Buttons */}
                <div className="mt-2 flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => { setBulkFile(null); setParsedRoster(null) }}
                    className="text-xs font-bold text-slate-600 hover:text-slate-900"
                  >
                    ← Choose Different File
                  </button>
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={handleResetBulkModal}
                      className="rounded-2xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={importingBatch || parsedRoster.validCount + parsedRoster.warningCount === 0}
                      onClick={handleExecuteBulkImport}
                      className="btn-3d-amber rounded-2xl px-5 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                    >
                      {importingBatch
                        ? 'Importing Roster…'
                        : `Import ${parsedRoster.validCount + parsedRoster.warningCount} Students ⚡`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Success State */}
            {importResult && (
              <div className="mt-5 flex flex-col gap-4 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-3xl bg-emerald-100 text-3xl shadow-sm">
                  🎉
                </div>

                <div>
                  <h3 className="text-xl font-black text-slate-900">Import Successful!</h3>
                  <p className="mt-1 text-xs text-slate-600 font-medium">
                    Successfully enrolled <strong>{importResult.count} students</strong> into your school bus roster.
                  </p>
                </div>

                {importResult.invitations?.length > 0 && (
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-left flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-emerald-950">
                        ✉️ {importResult.invitations.length} Parent Invitation Links Generated
                      </span>
                      <span className="text-[11px] font-bold text-emerald-800">
                        Valid 72h
                      </span>
                    </div>
                    <p className="text-[11px] text-emerald-900 leading-relaxed font-medium">
                      You can download these links as a CSV spreadsheet to send via bulk SMS/WhatsApp broadcast, or copy them to your clipboard.
                    </p>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => downloadInvitesCsv(importResult.invitations, school?.name || 'School')}
                        className="btn-3d-amber flex-1 rounded-xl py-2 px-3 text-xs font-black text-slate-950 shadow-2xs"
                      >
                        📥 Download Links CSV
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyAllInvites}
                        className="btn-3d-subtle flex-1 rounded-xl py-2 px-3 text-xs font-black text-slate-900 shadow-2xs"
                      >
                        {copiedBatchInvites ? '✓ Copied All Links!' : '📋 Copy All Links'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleResetBulkModal}
                    className="btn-3d-amber w-full rounded-2xl py-3 text-sm font-black text-slate-950 shadow-sm"
                  >
                    Done &amp; View Roster →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/90">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-lg font-black text-slate-900">Add New Student</h3>
                <p className="text-xs text-slate-500 font-medium">Register a student to the transportation roster</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="mt-3 rounded-2xl bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAddStudent} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-extrabold text-slate-800">Student Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Yonas Bekele"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-field p-3 text-sm font-medium text-slate-900 focus:border-amber focus:outline-none"
                />
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-800">Grade Level</label>
                <select
                  value={newStudentGrade}
                  onChange={(e) => setNewStudentGrade(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-field bg-white p-3 text-sm font-medium text-slate-900 focus:border-amber focus:outline-none"
                >
                  {[...Array(13).keys()].map((g) => (
                    <option key={g} value={g}>
                      {g === 0 ? 'Kindergarten' : `Grade ${g}`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-extrabold text-slate-800">Parent Contact Phone Number</label>
                <input
                  type="tel"
                  placeholder="e.g. +251911223344 or 0911223344"
                  value={newParentPhone}
                  onChange={(e) => setNewParentPhone(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-field p-3 text-sm font-medium text-slate-900 focus:border-amber focus:outline-none"
                />
                <p className="mt-1 text-[11px] text-slate-500 font-medium">
                  Used to generate a secure invitation link so the parent can register their own account.
                </p>
              </div>

              {/* Optional Route & Stop */}
              {routes.length > 0 && (
                <div className="rounded-2xl bg-slate-50/80 border border-slate-200/80 p-3.5 flex flex-col gap-3">
                  <span className="text-xs font-extrabold text-slate-800">🚌 Assigned Bus Route &amp; Stop (Optional)</span>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <select
                      value={newRouteId}
                      onChange={(e) => {
                        setNewRouteId(e.target.value)
                        setNewStopId('')
                      }}
                      className="w-full rounded-xl border border-field bg-white p-2 text-xs font-medium text-slate-800"
                    >
                      <option value="">Select Route…</option>
                      {routes.map((r) => (
                        <option key={r.id} value={r.id}>{r.name}</option>
                      ))}
                    </select>

                    <select
                      value={newStopId}
                      onChange={(e) => setNewStopId(e.target.value)}
                      disabled={!newRouteId}
                      className="w-full rounded-xl border border-field bg-white p-2 text-xs font-medium text-slate-800 disabled:opacity-50"
                    >
                      <option value="">Select Stop…</option>
                      {(routes.find((r) => r.id === newRouteId)?.stops || []).map((st) => (
                        <option key={st.id} value={st.id}>{st.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="rounded-2xl bg-amber-50/80 border border-amber-200/80 p-3 text-[11px] font-semibold text-amber-950">
                💡 <strong>No passwords needed:</strong> School managers no longer need to invent parent accounts or passwords. After adding, you can share a 1-click invitation link directly via WhatsApp or SMS.
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={adding}
                  className="btn-3d-amber rounded-2xl px-5 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                >
                  {adding ? 'Saving Student…' : 'Add Student & Continue →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Parent Invitation Link Modal */}
      {inviteModalStudent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/90">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-lg shadow-2xs">
                  ✉️
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">Parent Invitation Link</h3>
                  <p className="text-xs text-slate-500 font-semibold">{inviteModalStudent.fullName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setInviteModalStudent(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            {inviteError && (
              <div className="mt-3.5 rounded-2xl bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
                ✕ {inviteError}
              </div>
            )}

            {!inviteLinkData ? (
              <div className="mt-4 flex flex-col gap-4">
                <p className="text-xs text-slate-600 font-medium leading-relaxed">
                  Generate a single-use, cryptographically secure invitation link. The parent creates their own password and is automatically connected to <strong>{inviteModalStudent.fullName}</strong>.
                </p>

                <div>
                  <label className="text-xs font-extrabold text-slate-800">Parent Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. +251911223344"
                    value={invitePhoneNumber}
                    onChange={(e) => setInvitePhoneNumber(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-field p-3 text-sm font-medium text-slate-900 focus:border-amber focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    The parent must register using this verified phone number.
                  </p>
                </div>

                <div className="mt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setInviteModalStudent(null)}
                    className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={generatingInvite || !invitePhoneNumber.trim()}
                    onClick={() => handleGenerateInvite(inviteModalStudent, invitePhoneNumber)}
                    className="btn-3d-amber rounded-2xl px-5 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                  >
                    {generatingInvite ? 'Generating Link…' : 'Generate Invitation Link ⚡'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-col gap-4">
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5 flex flex-col gap-1.5">
                  <span className="text-xs font-black text-emerald-950 flex items-center gap-1.5">
                    <span>✓</span>
                    <span>Invitation Ready! (Single-use, 72h validity)</span>
                  </span>
                  <p className="text-[11px] text-emerald-900 font-medium">
                    Associated Phone: <strong className="font-mono">{inviteLinkData.phoneNumber}</strong>
                  </p>
                </div>

                <div>
                  <label className="text-xs font-extrabold text-slate-800">Secure Invitation URL</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={inviteLinkData.url}
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-xs font-mono text-slate-700 select-all"
                    />
                    <button
                      type="button"
                      onClick={copyInviteLink}
                      className="shrink-0 rounded-2xl btn-3d-subtle px-3.5 py-2.5 text-xs font-black text-slate-900"
                    >
                      {copiedLink ? '✓ Copied!' : '📋 Copy'}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-2 pt-1">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-400">
                    Share directly with parent:
                  </span>
                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      onClick={shareWhatsApp}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-xs font-black text-white hover:bg-emerald-700 active:scale-95 transition-all shadow-xs"
                    >
                      <span>💬</span>
                      <span>WhatsApp</span>
                    </button>
                    <button
                      type="button"
                      onClick={shareSMS}
                      className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white hover:bg-blue-700 active:scale-95 transition-all shadow-xs"
                    >
                      <span>📱</span>
                      <span>Send SMS</span>
                    </button>
                  </div>
                </div>

                <div className="mt-2 border-t border-slate-100 pt-3 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={revokingInvite}
                    onClick={handleRevokeInvite}
                    className="text-xs font-bold text-red-600 hover:text-red-700 disabled:opacity-50"
                  >
                    {revokingInvite ? 'Revoking…' : '🚫 Revoke this invitation'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInviteModalStudent(null)}
                    className="btn-3d-subtle rounded-xl px-4 py-2 text-xs font-black text-slate-800"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Assign Stop Modal */}
      {studentToAssignStop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/90">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-lg shadow-2xs">
                  🚌
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">Assign Bus Route &amp; Stop</h3>
                  <p className="text-xs text-slate-500 font-semibold">{studentToAssignStop.fullName}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStudentToAssignStop(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            {stopError && (
              <div className="mt-3.5 rounded-2xl bg-red-50 border border-red-200 p-3 text-xs font-bold text-red-700">
                ✕ {stopError}
              </div>
            )}

            {stopSuccess && (
              <div className="mt-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
                {stopSuccess}
              </div>
            )}

            <form onSubmit={handleSaveStop} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-extrabold text-slate-800">Bus Route</label>
                <select
                  value={assignRouteId}
                  onChange={(e) => {
                    setAssignRouteId(e.target.value)
                    setAssignStopId('')
                  }}
                  className="mt-1 w-full rounded-2xl border border-field bg-white p-3 text-sm font-medium text-slate-900 focus:border-amber focus:outline-none"
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
                <label className="text-xs font-extrabold text-slate-800">Assigned Bus Stop</label>
                <select
                  value={assignStopId}
                  onChange={(e) => setAssignStopId(e.target.value)}
                  className="mt-1 w-full rounded-2xl border border-field bg-white p-3 text-sm font-medium text-slate-900 focus:border-amber focus:outline-none"
                >
                  <option value="">Choose pickup/drop-off stop…</option>
                  {(routes.find((r) => r.id === assignRouteId)?.stops || []).map((st) => (
                    <option key={st.id} value={st.id}>
                      {st.name} {st.is_school ? '(School Campus)' : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-[11px] text-slate-500 font-medium">
                  Used for morning pickup and afternoon drop-off location tracking.
                </p>
              </div>

              <div className="mt-3 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setStudentToAssignStop(null)}
                  className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStop || !assignStopId}
                  className="btn-3d-amber rounded-2xl px-5 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                >
                  {savingStop ? 'Saving…' : 'Save Stop Assignment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Student Confirmation Modal */}
      {studentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-md rounded-3xl p-6 shadow-2xl border border-red-200">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Delete Student</h3>
              <button
                type="button"
                onClick={() => { setStudentToDelete(null); setActionError('') }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            <p className="mt-3.5 text-xs text-slate-700 leading-relaxed font-medium">
              Are you sure you want to permanently delete <strong className="text-slate-900 font-bold">{studentToDelete.fullName}</strong> from your school roster?
            </p>

            <div className="mt-3 rounded-2xl border border-red-200 bg-red-50/80 p-3 text-xs font-bold text-red-800">
              ⚠️ This will remove the student, assigned bus stops, attendance records, and any parent invitation or connection.
            </div>

            {actionError && (
              <div className="mt-3 rounded-2xl bg-red-50 p-2.5 text-xs font-bold text-red-700">
                ✕ {actionError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setStudentToDelete(null); setActionError('') }}
                disabled={deletingStudent}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteStudent}
                disabled={deletingStudent}
                className="rounded-2xl bg-red-600 px-5 py-2.5 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50 active:scale-95 transition-all shadow-xs"
              >
                {deletingStudent ? 'Deleting…' : 'Yes, Delete Student'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unlink Parent Confirmation Modal */}
      {parentToUnlink && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-md">
          <div className="card-3d w-full max-w-md rounded-3xl p-6 shadow-2xl border border-white/90">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-black text-slate-900">Unlink Parent</h3>
              <button
                type="button"
                onClick={() => { setParentToUnlink(null); setActionError('') }}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-all"
              >
                ✕
              </button>
            </div>

            <p className="mt-3.5 text-xs text-slate-700 leading-relaxed font-medium">
              Disconnect parent <strong className="text-slate-900 font-bold">{parentToUnlink.parentName}</strong> from student <strong className="text-slate-900 font-bold">{parentToUnlink.fullName}</strong>?
            </p>

            <p className="mt-2 text-[11px] text-slate-500 font-medium">
              The parent user account will remain active, but they will no longer see this student on their dashboard or receive trip tracking updates.
            </p>

            {actionError && (
              <div className="mt-3 rounded-2xl bg-red-50 p-2.5 text-xs font-bold text-red-700">
                ✕ {actionError}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setParentToUnlink(null); setActionError('') }}
                disabled={unlinkingParent}
                className="rounded-2xl border border-slate-200 px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUnlinkParent}
                disabled={unlinkingParent}
                className="btn-3d-amber rounded-2xl px-5 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
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
