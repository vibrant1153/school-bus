import { useManagerData } from '../lib/useManagerData.js'

// Maps raw action codes to human-readable labels and icons
function describeAction(log) {
  const d = log.details_json || {}
  const action = log.action || ''

  switch (action) {
    case 'PROVISION_USER': {
      const role = d.target_role || 'user'
      const name = d.target_name || d.target_email || 'a new account'
      if (role === 'parent') return { icon: '👨‍👩‍👧', label: 'Parent account created', detail: `Added parent "${name}"` }
      if (role === 'driver') return { icon: '🚌', label: 'Driver account created', detail: `Added driver "${name}"` }
      if (role === 'manager') return { icon: '🏫', label: 'Manager account created', detail: `Added manager "${name}"` }
      return { icon: '👤', label: 'User account created', detail: `Added ${role} "${name}"` }
    }
    case 'PURGE_LOCATION_HISTORY':
    case 'PURGE_LOCATIONS': {
      const count = d.deleted_points ?? d.rows_deleted ?? '?'
      return { icon: '🧹', label: 'Location history purged', detail: `Deleted ${count} GPS data point${count === 1 ? '' : 's'} from past trips` }
    }
    case 'UPDATE_SCHOOL_SETTINGS':
    case 'UPDATE_SETTINGS': {
      return { icon: '⚙️', label: 'School settings updated', detail: 'School name, contact phone, or timezone was changed' }
    }
    case 'RESET_MANAGER_PASSWORD': {
      return { icon: '🔑', label: 'Manager password reset', detail: 'Platform owner reset the manager login password' }
    }
    case 'DELETE_SCHOOL': {
      return { icon: '🗑️', label: 'School deleted', detail: `School "${d.school_name || d.school_id}" was permanently deleted` }
    }
    case 'END_TRIP':
    case 'FORCE_END_TRIP': {
      return { icon: '🛑', label: 'Trip ended by manager', detail: `Trip for bus "${d.bus_name || d.bus_id}" was manually completed` }
    }
    case 'UNLINK_PARENT': {
      return { icon: '🔗', label: 'Parent unlinked from student', detail: d.detail || 'A parent was removed from a student record' }
    }
    case 'DELETE_STUDENT': {
      return { icon: '📋', label: 'Student removed', detail: d.detail || 'A student was removed from the roster' }
    }
    default: {
      // Fallback: format the action code into a readable title
      const title = action.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
      return { icon: '📝', label: title, detail: d.detail || d.description || null }
    }
  }
}

function getPerformedBy(log) {
  // Try to get name from joined profile data or details_json
  if (log.profiles?.full_name) return log.profiles.full_name
  if (log.details_json?.actor_name) return log.details_json.actor_name
  if (log.actor_name) return log.actor_name
  if (log.performed_by === null || log.performed_by === undefined) return 'System'
  return 'Manager' // We know it's a manager, just not the name
}

const ACTION_TONE = {
  PROVISION_USER: 'blue',
  PURGE_LOCATION_HISTORY: 'amber',
  PURGE_LOCATIONS: 'amber',
  UPDATE_SCHOOL_SETTINGS: 'gray',
  UPDATE_SETTINGS: 'gray',
  RESET_MANAGER_PASSWORD: 'indigo',
  DELETE_SCHOOL: 'red',
  END_TRIP: 'orange',
  FORCE_END_TRIP: 'orange',
  DELETE_STUDENT: 'red',
  UNLINK_PARENT: 'orange',
}

const TONE_CLASSES = {
  blue: 'bg-blue-50 text-blue-800 border-blue-200',
  amber: 'bg-amber-50 text-amber-900 border-amber-200',
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  red: 'bg-red-50 text-red-800 border-red-200',
  orange: 'bg-orange-50 text-orange-800 border-orange-200',
}

export default function AuditLog() {
  const { auditLogs, loading } = useManagerData()

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-amber border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[28px] font-bold text-ink">Audit Log</h1>
        <p className="text-sm text-muted">
          A permanent record of every administrative change made in your school portal.
        </p>
      </header>

      {auditLogs.length === 0 ? (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center shadow-xs">
          <p className="text-sm font-medium text-muted">No changes recorded yet. Actions you take as manager will appear here.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {auditLogs.map((log) => {
            const { icon, label, detail } = describeAction(log)
            const dateStr = log.created_at
              ? new Date(log.created_at).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })
              : '—'
            const toneKey = ACTION_TONE[log.action] || 'gray'
            const toneClass = TONE_CLASSES[toneKey]
            const performedBy = getPerformedBy(log)

            return (
              <div
                key={log.id}
                className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-xs"
              >
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-lg">
                  {icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-ink">{label}</span>
                    <span className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>
                      {log.action}
                    </span>
                  </div>
                  {detail && (
                    <p className="mt-0.5 text-xs text-muted">{detail}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-muted">
                    <span>🕐 {dateStr}</span>
                    <span>👤 {performedBy}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <p className="rounded-xl border border-gray-100 bg-gray-50 p-3 text-xs text-muted">
        🔒 This log is immutable. Entries cannot be edited or deleted. All changes are recorded automatically.
      </p>
    </div>
  )
}
