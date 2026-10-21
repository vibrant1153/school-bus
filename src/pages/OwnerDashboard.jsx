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

      setShowAddModal(false)
      setSchoolName('')
      setSchoolCode('')
      setSchoolPhone('')
      await loadDashboardData()
    } catch (err) {
      console.error('Error creating school:', err)
      setModalError(err.message || 'Failed to create school')
    } finally {
      setSavingSchool(false)
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
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber font-bold text-ink">
            SC
          </div>
          <div>
            <h1 className="text-base font-bold text-ink">Platform Administration</h1>
            <p className="text-xs text-muted">SchoolBus Connect Network Overview</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-xs font-medium text-muted">
            {profile?.full_name || user?.email} (Owner)
          </span>
          <button
            onClick={signOut}
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-muted hover:border-gray-300 hover:text-ink"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-6">
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
                    <th className="px-6 py-3.5">Timezone</th>
                    <th className="px-6 py-3.5">Phone</th>
                    <th className="px-6 py-3.5">Fleet Size</th>
                    <th className="px-6 py-3.5">Students</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {schools.map((school) => {
                    const m = metrics.find((item) => item.school_id === school.id)
                    return (
                      <tr key={school.id} className="hover:bg-gray-50/75">
                        <td className="px-6 py-4 font-semibold text-ink">{school.name}</td>
                        <td className="px-6 py-4">
                          <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-mono font-medium text-gray-700">
                            {school.code}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-muted">{school.timezone}</td>
                        <td className="px-6 py-4 text-xs text-muted">{school.contact_phone || '—'}</td>
                        <td className="px-6 py-4 font-semibold text-ink">{m?.total_buses ?? '—'}</td>
                        <td className="px-6 py-4 font-semibold text-ink">{m?.total_students ?? '—'}</td>
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
    </div>
  )
}
