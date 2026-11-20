import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { api, formatMoney } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { OvaAccount, ReconciliationRun } from "../types/ledger";

export function ReconciliationPage({
  refreshKey,
  onDataChanged,
}: {
  refreshKey: number;
  onDataChanged: () => void;
}) {
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [ovaAccounts, setOvaAccounts] = useState<OvaAccount[]>([]);
  const [selectedOva, setSelectedOva] = useState("OVA_MAIN");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    Promise.all([api.getReconciliationRuns(), api.getOvaAccounts()])
      .then(([r, ovas]) => {
        setRuns(r);
        setOvaAccounts(ovas);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const handleRun = async () => {
    setRunning(true);
    try {
      await api.runReconciliation(selectedOva);
      load();
      onDataChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to run reconciliation");
    } finally {
      setRunning(false);
    }
  };

  const handleUpdateDiscrepancy = async (discId: string, status: "INVESTIGATING" | "RESOLVED") => {
    const promptText = status === "INVESTIGATING" ? "Enter investigation notes:" : "Enter resolution notes:";
    const notes = window.prompt(promptText);
    if (!notes || notes.trim().length < 3) return;
    try {
      await api.resolveDiscrepancy(discId, status, notes.trim());
      load();
      onDataChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update discrepancy");
    }
  };

  const latest = runs[0];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">Provider &amp; Bank Reconciliation</h2>
          <p className="text-xs text-slate-500">
            Compares internal ledger records against ingested provider and bank statement entries.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedOva}
            onChange={(e) => setSelectedOva(e.target.value)}
            className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700"
          >
            {ovaAccounts.length === 0 ? (
              <option value="OVA_MAIN">OVA_MAIN</option>
            ) : (
              ovaAccounts.map((o) => (
                <option key={o.id} value={o.code}>
                  {o.code} — {o.provider_name}
                </option>
              ))
            )}
          </select>
          <button
            onClick={handleRun}
            disabled={running}
            className="inline-flex items-center gap-2 rounded-xl bg-juni-red hover:bg-juni-red-hover disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            {running ? "Running..." : "Run Reconciliation Now"}
          </button>
        </div>
      </div>

      {latest && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-mono text-xs font-semibold text-juni-navy mr-2">{latest.run_reference}</span>
              <StatusBadge status={latest.status} />
            </div>
            <div className="text-xs text-slate-600 space-x-4">
              <span>Internal Ledger: {formatMoney(latest.ledger_ova_balance, latest.currency)}</span>
              <span>Provider Statement: {formatMoney(latest.external_ova_balance, latest.currency)}</span>
              <span className="font-semibold">
                Variance: {formatMoney(latest.variance_amount, latest.currency)}
              </span>
              <span>Matched: {latest.matched_count}</span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">External Ref</th>
                  <th className="px-4 py-3 text-right">Provider Statement</th>
                  <th className="px-4 py-3 text-right">Internal Ledger</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {latest.discrepancies.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-juni-blue text-sm">
                      No discrepancies detected in latest run.
                    </td>
                  </tr>
                ) : (
                  latest.discrepancies.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{d.discrepancy_type}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{d.external_tx_ref ?? "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(d.expected_amount, latest.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {formatMoney(d.actual_amount, latest.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-juni-red">
                        {formatMoney(d.difference_amount, latest.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={d.resolution_status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {d.resolution_status !== "RESOLVED" ? (
                          <div className="inline-flex items-center gap-2">
                            {d.resolution_status === "OPEN" && (
                              <button
                                onClick={() => handleUpdateDiscrepancy(d.id, "INVESTIGATING")}
                                className="text-xs font-medium text-slate-700 hover:text-juni-blue transition-colors"
                              >
                                Investigate
                              </button>
                            )}
                            <button
                              onClick={() => handleUpdateDiscrepancy(d.id, "RESOLVED")}
                              className="text-xs font-medium text-juni-navy hover:text-juni-red transition-colors"
                            >
                              Mark Resolved
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">{d.resolution_notes}</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
