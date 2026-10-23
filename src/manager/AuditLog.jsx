import { useManagerData } from '../lib/useManagerData.js'

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
        <h1 className="text-[28px] font-bold text-ink">School Audit Log</h1>
        <p className="text-sm text-muted">
          Immutable audit record of administrative actions, settings changes, and location history purges.
        </p>
      </header>

      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xs">
        {auditLogs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted">
            No audit log entries recorded for this school yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-semibold text-muted uppercase tracking-wider">
                <tr className="border-b border-gray-200">
                  <th className="px-5 py-3.5">Timestamp</th>
                  <th className="px-5 py-3.5">Action</th>
                  <th className="px-5 py-3.5">Details</th>
                  <th className="px-5 py-3.5">Performed By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogs.map((log) => {
                  const dateStr = log.created_at
                    ? new Date(log.created_at).toLocaleString('en-GB', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : '—'

                  return (
                    <tr key={log.id} className="hover:bg-gray-50/75">
                      <td className="px-5 py-4 font-mono text-xs text-muted whitespace-nowrap">
                        {dateStr}
                      </td>
                      <td className="px-5 py-4 font-bold text-ink">
                        <span className="rounded-md bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-muted">
                        {log.details_json ? JSON.stringify(log.details_json) : '—'}
                      </td>
                      <td className="px-5 py-4 text-xs font-mono text-muted">
                        {log.performed_by ? `${log.performed_by.slice(0, 8)}…` : 'System'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
