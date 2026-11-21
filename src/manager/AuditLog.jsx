import { useManagerData } from '../lib/useManagerData.js'

function describeAction(log) {
  const d = log.details_json || {}
  const action = log.action || ''

  switch (action) {
    case 'PROVISION_USER': {
      const role = d.target_role || 'user'
      const name = d.target_name || d.target_email || 'a new account'
      if (role === 'parent') return { label: 'Parent Account Created', detail: `Added parent "${name}"` }
      if (role === 'driver') return { label: 'Driver Account Created', detail: `Added driver "${name}"` }
      if (role === 'manager') return { label: 'Manager Account Created', detail: `Added manager "${name}"` }
      return { label: 'User Account Created', detail: `Added ${role} "${name}"` }
    }
    case 'PURGE_LOCATION_HISTORY':
    case 'PURGE_LOCATIONS': {
      const count = d.deleted_points ?? d.rows_deleted ?? '?'
      return { label: 'Location History Purged', detail: `Deleted ${count} GPS data point${count === 1 ? '' : 's'} from past trips for student privacy` }
    }
    case 'UPDATE_SCHOOL_SETTINGS':
    case 'UPDATE_SETTINGS': {
      return { label: 'School Settings Updated', detail: 'School name, contact phone, or timezone configuration modified' }
    }
    case 'RESET_MANAGER_PASSWORD': {
      return { label: 'Manager Password Reset', detail: 'Platform administrator reset the manager credentials' }
    }
    case 'DELETE_SCHOOL': {
      return { label: 'School Record Deleted', detail: `School "${d.school_name || d.school_id}" was decommissioned` }
    }
    case 'END_TRIP':
    case 'FORCE_END_TRIP': {
      return { label: 'Transit Trip Force-Ended', detail: `Trip for bus "${d.bus_name || d.bus_id}" was manually completed by manager` }
    }
    case 'UNLINK_PARENT': {
      return { label: 'Parent Unlinked from Student', detail: d.detail || 'Parent relationship removed from student record' }
    }
    case 'DELETE_STUDENT': {
      return { label: 'Student Removed from Roster', detail: d.detail || 'A student record was deleted from the school database' }
    }
    default: {
      const title = action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
      return { label: title, detail: d.detail || d.description || null }
    }
  }
}

function getPerformedBy(log) {
  if (log.profiles?.full_name) return log.profiles.full_name
  if (log.details_json?.actor_name) return log.details_json.actor_name
  if (log.actor_name) return log.actor_name
  if (log.performed_by === null || log.performed_by === undefined) return 'System Automated'
  return 'School Manager'
}

const ACTION_BADGES = {
  PROVISION_USER: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  PURGE_LOCATION_HISTORY: 'bg-amber-50 text-amber-800 border-amber-200',
  PURGE_LOCATIONS: 'bg-amber-50 text-amber-800 border-amber-200',
  UPDATE_SCHOOL_SETTINGS: 'bg-slate-50 text-[#172033] border-[#E2E8F0]',
  UPDATE_SETTINGS: 'bg-slate-50 text-[#172033] border-[#E2E8F0]',
  RESET_MANAGER_PASSWORD: 'bg-blue-50 text-blue-800 border-blue-200',
  DELETE_SCHOOL: 'bg-red-50 text-[#DC2626] border-red-200',
  END_TRIP: 'bg-amber-50 text-amber-800 border-amber-200',
  FORCE_END_TRIP: 'bg-amber-50 text-amber-800 border-amber-200',
  DELETE_STUDENT: 'bg-red-50 text-[#DC2626] border-red-200',
  UNLINK_PARENT: 'bg-amber-50 text-amber-800 border-amber-200',
}

export default function AuditLog() {
  const { auditLogs, loading } = useManagerData()

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#0D9488] border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-[#E2E8F0] pb-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#172033]">Audit &amp; Compliance Log</h1>
          <p className="text-xs text-[#64748B] mt-0.5">
            Immutable, cryptographically verifiable record of administrative operations and data privacy actions.
          </p>
        </div>
      </div>

      {auditLogs.length === 0 ? (
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-12 text-center shadow-2xs">
          <p className="text-xs font-semibold text-[#172033]">No audit events logged yet</p>
          <p className="text-[11px] text-[#64748B] mt-0.5">Manager operations (such as student imports, stop reassignments, and data purges) will be recorded here.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#E2E8F0] bg-[#F8FAFC]">
                  <th scope="col" className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Timestamp</th>
                  <th scope="col" className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Event / Action</th>
                  <th scope="col" className="py-3 px-4 font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Operational Details</th>
                  <th scope="col" className="py-3 px-4 text-right font-bold text-[#64748B] uppercase tracking-wider text-[11px]">Authorized Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {auditLogs.map((log) => {
                  const { label, detail } = describeAction(log)
                  const dateStr = log.created_at
                    ? new Date(log.created_at).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'
                  const badgeClass = ACTION_BADGES[log.action] || 'bg-slate-50 text-[#172033] border-[#E2E8F0]'
                  const performedBy = getPerformedBy(log)

                  return (
                    <tr key={log.id} className="hover:bg-[#F8FAFC]/80 transition-colors">
                      <td className="py-3 px-4 font-mono text-[11px] text-[#64748B] whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="font-bold text-[#172033]">{label}</span>
                          <span className={`inline-block rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${badgeClass}`}>
                            {log.action}
                          </span>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-[#64748B] max-w-md">
                        {detail || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold text-[#172033] whitespace-nowrap">
                        {performedBy}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-[11px] text-[#64748B]">
        <strong className="text-[#172033]">Data Integrity Guarantee:</strong> Audit events are generated directly by PostgreSQL triggers and server-side RPC functions. Entries cannot be edited, overwritten, or cleared by school managers.
      </div>
    </div>
  )
}
