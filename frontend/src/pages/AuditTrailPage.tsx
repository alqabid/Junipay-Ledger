import { useEffect, useState } from "react";
import { api } from "../api/client";
import type { AuditLog } from "../types/ledger";

export function AuditTrailPage({ refreshKey }: { refreshKey: number }) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getAuditLogs()
      .then((l) => {
        setLogs(l);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [refreshKey]);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Immutable Audit Trail</h2>
          <p className="text-xs text-slate-500">Append-only log of all ledger postings, reversals, settlements & resolutions</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Timestamp</th>
                <th className="px-4 py-3">Actor</th>
                <th className="px-4 py-3">Action</th>
                <th className="px-4 py-3">Resource</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-700">
                    {log.actor_id} <span className="text-slate-400">({log.actor_type})</span>
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-juni-navy">{log.action}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {log.resource_type}: <span className="font-mono">{log.resource_id.slice(0, 8)}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-slate-500 max-w-md truncate">
                    {JSON.stringify(log.new_state ?? log.previous_state ?? {})}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
