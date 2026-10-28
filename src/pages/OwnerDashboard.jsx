import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../lib/useAuth.js'

export default function OwnerDashboard() {
  const { user, profile, signOut } = useAuth()
  const [metrics, setMetrics] = useState([])
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Add School Modal state
  const [showAddModal, setShowAddModal] = useState(false)
  const [schoolName, setSchoolName] = useState('')
  const [schoolCode, setSchoolCode] = useState('')
  const [schoolTz, setSchoolTz] = useState('Africa/Addis_Ababa')
  const [schoolPhone, setSchoolPhone] = useState('')
  const [savingSchool, setSavingSchool] = useState(false)
  const [modalError, setModalError] = useState('')

  // Manager state
  const [managers, setManagers] = useState([])

  // Provision in Add School Modal
  const [addManagerWithSchool, setAddManagerWithSchool] = useState(true)
  const [newManagerName, setNewManagerName] = useState('')
  const [newManagerEmail, setNewManagerEmail] = useState('')
  const [newManagerPhone, setNewManagerPhone] = useState('')
  const [newManagerPassword, setNewManagerPassword] = useState('')

  // Standalone Provision Manager Modal state
  const [provisionSchool, setProvisionSchool] = useState(null)
  const [managerFullName, setManagerFullName] = useState('')
  const [managerEmail, setManagerEmail] = useState('')
  const [managerPhone, setManagerPhone] = useState('')
  const [managerPassword, setManagerPassword] = useState('')
  const [provisioning, setProvisioning] = useState(false)
  const [provisionError, setProvisionError] = useState('')

  // Credentials Success Modal
  const [createdCredentials, setCreatedCredentials] = useState(null)
  const [copied, setCopied] = useState(false)

  // Purge Modal state
  const [purgeSchool, setPurgeSchool] = useState(null)
  const [purging, setPurging] = useState(false)
  const [purgeToast, setPurgeToast] = useState(null)
  const [purgeError, setPurgeError] = useState('')

  // Delete School Modal state
  const [deleteSchoolTarget, setDeleteSchoolTarget] = useState(null)
  const [deletingSchool, setDeletingSchool] = useState(false)
  const [deleteToast, setDeleteToast] = useState(null)
  const [deleteError, setDeleteError] = useState('')
  const [confirmCode, setConfirmCode] = useState('')

  async function handlePurgeLocations() {
    if (!purgeSchool) return
    setPurging(true)
    setPurgeError('')
    try {
      const { data, error } = await supabase.rpc('purge_school_location_history', {
        p_school_id: purgeSchool.id,
        p_hours: 0,
      })
      if (error) throw error
      const count = data?.deleted_points ?? 0
      setPurgeToast(`Purged ${count} location point${count === 1 ? '' : 's'} for ${purgeSchool.name}.`)
      setPurgeSchool(null)
      setTimeout(() => setPurgeToast(null), 5000)
    } catch (err) {
      console.error('Failed to purge school location data:', err)
      setPurgeError(err.message || 'Failed to purge location data')
    } finally {
      setPurging(false)
    }
  }

  async function handleDeleteSchool(e) {
    if (e) e.preventDefault()
    if (!deleteSchoolTarget) return

    if (confirmCode.trim().toUpperCase() !== deleteSchoolTarget.code.toUpperCase()) {
      setDeleteError(`Please type "${deleteSchoolTarget.code}" exactly to confirm deletion.`)
      return
    }

    setDeletingSchool(true)
    setDeleteError('')

    try {
      // 1. Attempt via Supabase RPC delete_school
      let rpcSucceeded = false
      try {
        const { error: rpcErr } = await supabase.rpc('delete_school', {
          p_school_id: deleteSchoolTarget.id,
        })
        if (!rpcErr) {
          rpcSucceeded = true
        } else if (rpcErr.code !== 'PGRST202' && !rpcErr.message?.includes('schema cache')) {
          throw rpcErr
        }
      } catch (err) {
        if (!err.message?.includes('schema cache') && err.code !== 'PGRST202') {
          throw err
        }
      }

      // 2. If RPC not yet installed in remote schema cache, fallback to Vercel Serverless Function
      if (!rpcSucceeded) {
        const session = (await supabase.auth.getSession())?.data?.session
        const res = await fetch('/api/delete-school', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify({ school_id: deleteSchoolTarget.id }),
        })

        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data.error || 'Failed to delete school.')
        }
      }

      setDeleteToast(`School "${deleteSchoolTarget.name}" (${deleteSchoolTarget.code}) was permanently deleted.`)
      setDeleteSchoolTarget(null)
      setConfirmCode('')
      await loadDashboardData()
      setTimeout(() => setDeleteToast(null), 6000)
    } catch (err) {
      console.error('Failed to delete school:', err)
      setDeleteError(err.message || 'Failed to delete school.')
    } finally {
      setDeletingSchool(false)
    }
  }

  useEffect(() => {
    loadDashboardData()
  }, [])

  async function loadDashboardData() {
    setLoading(true)
    setError(null)
    try {
      // 1. Fetch schools
      const { data: schoolData, error: schoolErr } = await supabase
        .from('schools')
        .select('*')
        .order('name')

      if (schoolErr) throw schoolErr
      setSchools(schoolData || [])

      // 2. Fetch health metrics via RPC
      const { data: metricsData, error: metricsErr } = await supabase
        .rpc('get_school_health_metrics')

      if (metricsErr) {
        console.warn('Could not fetch health metrics RPC:', metricsErr.message)
      } else {
        setMetrics(metricsData || [])
      }

      // 3. Fetch managers for schools
      const { data: managersData, error: mgrErr } = await supabase
        .from('profiles')
        .select('id, school_id, full_name, phone')
        .eq('role', 'manager')

      if (!mgrErr && managersData) {
        setManagers(managersData)
      }
    } catch (err) {
      console.error('Error loading owner dashboard data:', err)
      setError(err.message || 'Failed to load owner data')
    } finally {
      setLoading(false)
    }
  }

  async function handleAddSchool(e) {
    e.preventDefault()
    setModalError('')
    setSavingSchool(true)

    try {
      const { data: newSchoolId, error: rpcErr } = await supabase
        .rpc('create_school', {
          name: schoolName.trim(),
          code: schoolCode.trim().toUpperCase(),
          timezone: schoolTz.trim(),
          phone: schoolPhone.trim() || null,
        })

      if (rpcErr) throw rpcErr

      let provSuccess = null
      if (addManagerWithSchool && newManagerEmail.trim() && newSchoolId) {
        const payload = {
          school_id: newSchoolId,
          role: 'manager',
          full_name: newManagerName.trim() || `${schoolName.trim()} Manager`,
          email: newManagerEmail.trim().toLowerCase(),
          phone: newManagerPhone.trim() || schoolPhone.trim() || null,
          temp_password: newManagerPassword.trim() || undefined,
        }

        try {
          const { data, error: fnErr } = await supabase.functions.invoke('provision-user', {
            body: payload,
          })
          if (!fnErr && data?.success) {
            provSuccess = data
          } else {
            const session = (await supabase.auth.getSession())?.data?.session
            const res = await fetch('/api/provision-user', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${session?.access_token || ''}`,
              },
              body: JSON.stringify(payload),
            })
            const resData = await res.json().catch(() => ({}))
            if (res.ok && resData.success) {
              provSuccess = resData
            }
          }
        } catch (provErr) {
          console.warn('School created, but manager provisioning failed:', provErr)
        }
      }

      setShowAddModal(false)
      const createdName = schoolName
      const createdCode = schoolCode
      setSchoolName('')
      setSchoolCode('')
      setSchoolPhone('')
      setNewManagerName('')
      setNewManagerEmail('')
      setNewManagerPhone('')
      setNewManagerPassword('')
      await loadDashboardData()

      if (provSuccess) {
        setCreatedCredentials({
          schoolName: createdName,
          schoolCode: createdCode,
          fullName: provSuccess.full_name || 'School Manager',
          email: provSuccess.email,
          password: provSuccess.temp_password,
        })
      }
    } catch (err) {
      console.error('Error creating school:', err)
      setModalError(err.message || 'Failed to create school')
    } finally {
      setSavingSchool(false)
    }
  }

  async function handleProvisionManager(e) {
    if (e) e.preventDefault()
    if (!provisionSchool) return

    setProvisioning(true)
    setProvisionError('')

    const payload = {
      school_id: provisionSchool.id,
      role: 'manager',
      full_name: managerFullName.trim() || `${provisionSchool.name} Manager`,
      email: managerEmail.trim().toLowerCase(),
      phone: managerPhone.trim() || null,
      temp_password: managerPassword.trim() || undefined,
    }

    try {
      let provSuccess = null
      // 1. Try Supabase Edge Function provision-user
      const { data, error: fnErr } = await supabase.functions.invoke('provision-user', {
        body: payload,
      })

      if (!fnErr && data?.success) {
        provSuccess = data
      } else {
        // 2. Fallback to /api/provision-user
        const session = (await supabase.auth.getSession())?.data?.session
        const res = await fetch('/api/provision-user', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token || ''}`,
          },
          body: JSON.stringify(payload),
        })

        const resData = await res.json().catch(() => ({}))
        if (!res.ok || !resData.success) {
          throw new Error(resData.error || fnErr?.message || 'Failed to provision manager.')
        }
        provSuccess = resData
      }

      const sch = provisionSchool
      setProvisionSchool(null)
      setManagerFullName('')
      setManagerEmail('')
      setManagerPhone('')
      setManagerPassword('')
      await loadDashboardData()

      setCreatedCredentials({
        schoolName: sch.name,
        schoolCode: sch.code,
        fullName: payload.full_name,
        email: provSuccess.email,
        password: provSuccess.temp_password,
      })
    } catch (err) {
      console.error('Failed to provision manager:', err)
      setProvisionError(err.message || 'Failed to provision manager.')
    } finally {
      setProvisioning(false)
    }
  }

  // Calculate platform-wide totals from metrics
  const totalBuses = metrics.reduce((acc, m) => acc + (Number(m.total_buses) || 0), 0)
  const totalRoutes = metrics.reduce((acc, m) => acc + (Number(m.total_routes) || 0), 0)
  const totalStudents = metrics.reduce((acc, m) => acc + (Number(m.total_students) || 0), 0)
  const activeTripsToday = metrics.reduce((acc, m) => acc + (Number(m.active_trips_today) || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50 text-ink">
      {/* Top Navbar */}
      <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white/95 backdrop-blur-md px-4 sm:px-6 py-2.5 sm:py-0">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber font-extrabold text-ink shadow-sm">
            SC
          </div>
          <div>
            <h1 className="text-sm sm:text-base font-bold text-ink leading-tight">Platform Administration</h1>
            <p className="text-[11px] sm:text-xs text-muted">SchoolBus Connect Network Overview</p>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <span className="hidden sm:inline rounded-full bg-purple-100 px-2.5 py-1 text-xs font-bold text-purple-900">
            👑 {profile?.full_name || user?.email} (Owner)
          </span>
          <button
            type="button"
            onClick={signOut}
            aria-label="Sign out"
            className="flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-1.5 text-xs sm:text-sm font-bold text-red-600 shadow-xs hover:bg-red-100 hover:text-red-700 active:scale-95 transition-all"
          >
            <span aria-hidden="true">🚪</span>
            <span>Log Out</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
        {purgeToast && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-green-200 bg-green-50 p-3 text-xs font-semibold text-green-800">
            <span>✓ {purgeToast}</span>
            <button onClick={() => setPurgeToast(null)} className="text-green-800 hover:opacity-75">✕</button>
          </div>
        )}

        {deleteToast && (
          <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-800">
            <span>🗑️ {deleteToast}</span>
            <button onClick={() => setDeleteToast(null)} className="text-red-800 hover:opacity-75">✕</button>
          </div>
        )}

        {/* Page Title & Actions */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">System Overview</h2>
            <p className="text-sm text-muted">
              Monitoring multi-tenant schools, fleet counts, and operational health.
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-xl bg-amber px-4 py-2.5 text-sm font-bold text-ink hover:opacity-95"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add New School
          </button>
        </div>

        {error && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Global Metric Cards */}
        <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Schools Enrolled</span>
            <div className="mt-2 text-3xl font-extrabold text-ink">{schools.length}</div>
            <p className="mt-1 text-xs text-muted">Active independent tenants</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Total Buses</span>
            <div className="mt-2 text-3xl font-extrabold text-ink">{totalBuses}</div>
            <p className="mt-1 text-xs text-muted">Across {totalRoutes} routes</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Total Students</span>
            <div className="mt-2 text-3xl font-extrabold text-ink">{totalStudents}</div>
            <p className="mt-1 text-xs text-muted">Protected under single-school isolation</p>
          </div>
          <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-xs">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">Active Trips Today</span>
            <div className="mt-2 text-3xl font-extrabold text-ink">{activeTripsToday}</div>
            <p className="mt-1 text-xs text-emerald-600 font-medium">Realtime operations in progress</p>
          </div>
        </div>

        {/* Schools Table / Grid */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
          <div className="border-b border-gray-200 px-6 py-4">
            <h3 className="text-base font-bold text-ink">Registered Schools</h3>
          </div>

          {loading ? (
            <div className="flex h-48 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber border-t-transparent" />
            </div>
          ) : schools.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted">
              No schools registered yet. Click &quot;Add New School&quot; to provision the first school.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs font-semibold text-muted uppercase tracking-wider">
                  <tr>
                    <th className="px-6 py-3.5">School Name</th>
                    <th className="px-6 py-3.5">Code</th>
                    <th className="px-6 py-3.5">Manager Account</th>
                    <th className="px-6 py-3.5">Timezone</th>
                    <th className="px-6 py-3.5">Phone</th>
                    <th className="px-6 py-3.5">Fleet Size</th>
                    <th className="px-6 py-3.5">Students</th>
                    <th className="px-6 py-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {schools.map((school) => {
                    const m = metrics.find((item) => item.school_id === school.id)
                    const mgr = managers.find((item) => item.school_id === school.id)
                    return (
                      <tr key={school.id} className="hover:bg-gray-50/75">
                        <td className="px-6 py-4 font-semibold text-ink">{school.name}</td>
                        <td className="px-6 py-4">
                          <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-mono font-medium text-gray-700">
                            {school.code}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          {mgr ? (
                            <div className="flex items-center gap-2">
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-100 text-xs font-bold text-purple-900 shrink-0">
                                👤
                              </span>
                              <div>
                                <div className="font-semibold text-ink text-xs">{mgr.full_name}</div>
                                <div className="text-[11px] text-muted font-mono">{mgr.phone || 'Manager Assigned'}</div>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setProvisionSchool(school)
                                setManagerFullName('')
                                setManagerEmail('')
                                setManagerPhone(school.contact_phone || '')
                                setManagerPassword('')
                                setProvisionError('')
                              }}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-900 hover:bg-amber-100 hover:border-amber-400 transition-colors shadow-2xs"
                              title="Assign manager credentials for this school"
                            >
                              <span>+ Add Manager</span>
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-muted">{school.timezone}</td>
                        <td className="px-6 py-4 text-xs text-muted">{school.contact_phone || '—'}</td>
                        <td className="px-6 py-4 font-semibold text-ink">{m?.total_buses ?? '—'}</td>
                        <td className="px-6 py-4 font-semibold text-ink">{m?.total_students ?? '—'}</td>
                        <td className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setProvisionSchool(school)
                                setManagerFullName(mgr?.full_name || '')
                                setManagerEmail('')
                                setManagerPhone(mgr?.phone || school.contact_phone || '')
                                setManagerPassword('')
                                setProvisionError('')
                              }}
                              className="rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 transition-colors"
                              title="Provision or add manager credentials for this school"
                            >
                              👤 {mgr ? 'New Manager' : 'Add Manager'}
                            </button>
                            <button
                              type="button"
                              onClick={() => { setPurgeSchool(school); setPurgeError('') }}
                              className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 transition-colors"
                              title="Delete location tracking data for this school"
                            >
                              🧹 Purge Locations
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setDeleteSchoolTarget(school)
                                setDeleteError('')
                                setConfirmCode('')
                              }}
                              className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-bold text-red-600 hover:bg-red-100 hover:text-red-700 transition-colors shadow-xs"
                              title="Permanently delete this school and its entire fleet roster"
                            >
                              🗑️ Delete School
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>

      {/* Add School Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Add New School</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {modalError && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                {modalError}
              </div>
            )}

            <form onSubmit={handleAddSchool} className="mt-4 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-ink">School Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Hilltop International Academy"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">School Code (Unique Identifier)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. HTA-01"
                  value={schoolCode}
                  onChange={(e) => setSchoolCode(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm uppercase"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Timezone</label>
                <select
                  value={schoolTz}
                  onChange={(e) => setSchoolTz(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm bg-white"
                >
                  <option value="Africa/Addis_Ababa">Africa/Addis_Ababa (UTC+3)</option>
                  <option value="UTC">UTC</option>
                  <option value="Africa/Nairobi">Africa/Nairobi (UTC+3)</option>
                  <option value="Africa/Cairo">Africa/Cairo (UTC+2)</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Contact Phone (Optional)</label>
                <input
                  type="tel"
                  placeholder="e.g. +251911000000"
                  value={schoolPhone}
                  onChange={(e) => setSchoolPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm"
                />
              </div>

              {/* Manager Account Section */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-ink">School Manager Login Account</span>
                    <p className="text-[11px] text-muted">Create admin credentials for this school</p>
                  </div>
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input
                      type="checkbox"
                      checked={addManagerWithSchool}
                      onChange={(e) => setAddManagerWithSchool(e.target.checked)}
                      className="peer sr-only"
                    />
                    <div className="peer h-5 w-9 rounded-full bg-gray-200 after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-indigo-600 peer-checked:after:translate-x-full peer-focus:outline-none" />
                  </label>
                </div>

                {addManagerWithSchool && (
                  <div className="mt-3 flex flex-col gap-2.5">
                    <div>
                      <label className="text-[11px] font-semibold text-ink">Manager Full Name *</label>
                      <input
                        type="text"
                        required={addManagerWithSchool}
                        placeholder="e.g. Abebe Kebede"
                        value={newManagerName}
                        onChange={(e) => setNewManagerName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-field p-2 text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-ink">Manager Login Email *</label>
                      <input
                        type="email"
                        required={addManagerWithSchool}
                        placeholder="e.g. manager@school.et"
                        value={newManagerEmail}
                        onChange={(e) => setNewManagerEmail(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-field p-2 text-xs bg-white"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold text-ink">Temporary Password</label>
                      <input
                        type="text"
                        placeholder="Leave blank to auto-generate password"
                        value={newManagerPassword}
                        onChange={(e) => setNewManagerPassword(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-field p-2 text-xs bg-white font-mono"
                      />
                    </div>
                  </div>
                )}
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
                  disabled={savingSchool}
                  className="rounded-xl bg-amber px-5 py-2.5 text-sm font-bold text-ink hover:opacity-95 disabled:opacity-50"
                >
                  {savingSchool ? 'Creating...' : 'Create School'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Purge School Location Data Modal */}
      {purgeSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-ink">Purge School Location Data</h3>
              <button
                type="button"
                onClick={() => setPurgeSchool(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <p className="mt-3 text-sm text-gray-600">
              Are you sure you want to delete all GPS breadcrumbs and raw location tracking points for <strong className="text-ink">{purgeSchool.name}</strong>?
            </p>

            <div className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-800">
              ⚠️ <strong>Immediate Deletion:</strong> This wipes all raw coordinates for this school from <code className="font-mono text-xs">bus_location_history</code> and resets active bus markers. This action cannot be undone.
            </div>

            {purgeError && (
              <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-semibold text-red-700">
                {purgeError}
              </div>
            )}

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setPurgeSchool(null)}
                disabled={purging}
                className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handlePurgeLocations}
                disabled={purging}
                className="rounded-xl bg-danger px-4 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-red-700 disabled:opacity-50"
              >
                {purging ? 'Purging…' : 'Yes, Delete Location Data'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete School Confirmation Modal */}
      {deleteSchoolTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-red-200">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100 text-lg">
                  🗑️
                </span>
                <div>
                  <h3 className="text-lg font-bold text-ink">Delete School</h3>
                  <p className="text-xs text-muted font-mono">{deleteSchoolTarget.name} ({deleteSchoolTarget.code})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { setDeleteSchoolTarget(null); setDeleteError(''); setConfirmCode('') }}
                className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                ✕
              </button>
            </div>

            <div className="mt-4 rounded-xl border border-red-200 bg-red-50/80 p-4 text-xs text-red-900">
              <p className="font-bold text-red-950 flex items-center gap-1.5 mb-2">
                <span>⚠️</span> <span>Irreversible Action: Permanent Platform Cascade</span>
              </p>
              <p className="text-red-800 leading-relaxed">
                Deleting this school permanently removes it from the database and cascades across all connected data:
              </p>
              <ul className="mt-2 list-disc list-inside space-y-1 text-red-800/90 font-medium">
                <li>All registered buses, license plates, and driver assignments</li>
                <li>All transportation routes, stops, and schedules</li>
                <li>All student records, parent links, and absence reports</li>
                <li>All live trips, GPS breadcrumbs, and alert logs</li>
                <li>Manager and staff accounts associated with this school</li>
              </ul>
            </div>

            {deleteError && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-100 p-3 text-xs font-bold text-red-900">
                ⚠️ {deleteError}
              </div>
            )}

            <form onSubmit={handleDeleteSchool} className="mt-5 flex flex-col gap-3">
              <div>
                <label className="text-xs font-bold text-ink block mb-1">
                  Type <span className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs font-extrabold text-red-700">{deleteSchoolTarget.code}</span> to confirm deletion:
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  placeholder={`Type "${deleteSchoolTarget.code}"`}
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  className="w-full rounded-xl border border-red-300 p-2.5 text-sm font-mono uppercase focus:border-red-600 focus:outline-none focus:ring-2 focus:ring-red-200"
                />
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => { setDeleteSchoolTarget(null); setDeleteError(''); setConfirmCode('') }}
                  disabled={deletingSchool}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={deletingSchool || confirmCode.trim().toUpperCase() !== deleteSchoolTarget.code.toUpperCase()}
                  className="rounded-xl bg-danger px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {deletingSchool ? 'Deleting School…' : 'Yes, Permanently Delete School'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Standalone Provision Manager Modal */}
      {provisionSchool && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-ink">Provision School Manager</h3>
                <p className="text-xs text-muted font-mono">{provisionSchool.name} ({provisionSchool.code})</p>
              </div>
              <button
                type="button"
                onClick={() => setProvisionSchool(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            {provisionError && (
              <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs font-semibold text-red-700">
                {provisionError}
              </div>
            )}

            <form onSubmit={handleProvisionManager} className="mt-4 flex flex-col gap-3.5">
              <div>
                <label className="text-xs font-semibold text-ink">Manager Full Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Abebe Kebede"
                  value={managerFullName}
                  onChange={(e) => setManagerFullName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Manager Login Email *</label>
                <input
                  type="email"
                  required
                  placeholder="e.g. manager@radical.et"
                  value={managerEmail}
                  onChange={(e) => setManagerEmail(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
                <p className="mt-1 text-[11px] text-muted">
                  The school manager uses this email to log in at the Staff &amp; Driver portal.
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Contact Phone (Optional)</label>
                <input
                  type="tel"
                  placeholder="e.g. +251911223344"
                  value={managerPhone}
                  onChange={(e) => setManagerPhone(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm text-ink"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-ink">Temporary Password</label>
                <input
                  type="text"
                  placeholder="Leave blank to auto-generate password"
                  value={managerPassword}
                  onChange={(e) => setManagerPassword(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-field p-2.5 text-sm font-mono text-ink"
                />
                <p className="mt-1 text-[11px] text-muted">
                  The manager will be prompted to set their own permanent password upon first sign in.
                </p>
              </div>

              <div className="mt-2 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setProvisionSchool(null)}
                  disabled={provisioning}
                  className="rounded-xl border border-gray-200 px-4 py-2.5 text-xs font-semibold text-muted hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={provisioning}
                  className="rounded-xl bg-amber px-5 py-2.5 text-xs font-bold text-ink shadow-sm hover:opacity-95 disabled:opacity-50"
                >
                  {provisioning ? 'Provisioning…' : 'Create Manager Account'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Credentials Created Success Modal */}
      {createdCredentials && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-emerald-200">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-xl">
                🎉
              </span>
              <div>
                <h3 className="text-lg font-bold text-ink">Manager Account Ready!</h3>
                <p className="text-xs text-muted">{createdCredentials.schoolName} ({createdCredentials.schoolCode})</p>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 p-4 text-xs text-emerald-900 space-y-2.5">
              <div>
                <span className="font-semibold text-muted block text-[11px] uppercase tracking-wider">Manager Name</span>
                <span className="font-bold text-ink text-sm">{createdCredentials.fullName}</span>
              </div>
              <div>
                <span className="font-semibold text-muted block text-[11px] uppercase tracking-wider">Login Email</span>
                <span className="font-mono font-bold text-ink text-sm select-all">{createdCredentials.email}</span>
              </div>
              <div>
                <span className="font-semibold text-muted block text-[11px] uppercase tracking-wider">Temporary Password</span>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="rounded-md bg-white border border-emerald-200 px-2.5 py-1 font-mono font-bold text-emerald-950 text-sm select-all">
                    {createdCredentials.password}
                  </span>
                </div>
              </div>
              <div>
                <span className="font-semibold text-muted block text-[11px] uppercase tracking-wider">Portal URL</span>
                <span className="font-mono text-xs text-ink select-all">
                  https://school-bus-iota.vercel.app/login
                </span>
                <p className="text-[10px] text-muted mt-0.5">(Sign in on the &quot;🚌 Staff &amp; Driver&quot; tab)</p>
              </div>
            </div>

            <p className="mt-3 text-xs text-gray-600 leading-relaxed">
              💡 <strong>Next Step:</strong> Share these credentials with the school manager (via WhatsApp, SMS, or email). When they log in, they will be prompted to set their own permanent password.
            </p>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  const text = `SchoolBus Connect - Manager Access Credentials\nSchool: ${createdCredentials.schoolName} (${createdCredentials.schoolCode})\nPortal: https://school-bus-iota.vercel.app/login (Staff & Driver tab)\nEmail: ${createdCredentials.email}\nTemporary Password: ${createdCredentials.password}`
                  navigator.clipboard?.writeText(text)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 3000)
                }}
                className="rounded-xl border border-emerald-300 bg-white px-4 py-2.5 text-xs font-bold text-emerald-800 hover:bg-emerald-50 transition-colors"
              >
                {copied ? '✓ Copied to Clipboard!' : '📋 Copy Credentials'}
              </button>
              <button
                type="button"
                onClick={() => setCreatedCredentials(null)}
                className="rounded-xl bg-amber px-5 py-2.5 text-xs font-bold text-ink shadow-sm hover:opacity-95"
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
