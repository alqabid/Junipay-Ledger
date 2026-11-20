import { useEffect, useState } from "react";
import { RotateCcw, Search, X } from "lucide-react";
import { api, formatMoney } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";

type TxItem = Awaited<ReturnType<typeof api.getTransactions>>[number];

export function TransactionsPage({
  refreshKey,
  onDataChanged,
}: {
  refreshKey: number;
  onDataChanged: () => void;
}) {
  const [items, setItems] = useState<TxItem[]>([]);
  const [search, setSearch] = useState("");
  const [eventType, setEventType] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selected, setSelected] = useState<TxItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .getTransactions({
        search: search || undefined,
        event_type: eventType || undefined,
        status: statusFilter || undefined,
      })
      .then((res) => {
        setItems(res);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [refreshKey, eventType, statusFilter]);

  const handleReverse = async (id: string) => {
    const reason = window.prompt("Enter reversal reason:");
    if (!reason || reason.trim().length < 3) return;
    try {
      await api.reverseEntry(id, reason.trim());
      setSelected(null);
      load();
      onDataChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to reverse transaction");
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[220px] rounded-xl border border-slate-300 px-3 py-1.5">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search reference, entry #, correlation ID, channel..."
            className="flex-1 text-sm focus:outline-none"
          />
        </div>
        <select
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
        >
          <option value="">All Types</option>
          <option value="COLLECTION">COLLECTION</option>
          <option value="SETTLEMENT">SETTLEMENT</option>
          <option value="DISBURSEMENT">DISBURSEMENT</option>
          <option value="LIQUIDATION">LIQUIDATION</option>
          <option value="REFUND">REFUND</option>
          <option value="REVERSAL">REVERSAL</option>
          <option value="ADJUSTMENT">ADJUSTMENT</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium"
        >
          <option value="">All Statuses</option>
          <option value="POSTED">POSTED</option>
          <option value="REVERSED">REVERSED</option>
        </select>
        <button
          onClick={load}
          className="rounded-xl bg-juni-blue hover:bg-juni-navy px-4 py-2 text-xs font-medium text-white"
        >
          Apply
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-juni-blue">Transaction Monitoring</h2>
            <p className="text-xs text-slate-500">Click any transaction to inspect full lifecycle & ledger legs</p>
          </div>
          <span className="text-xs text-slate-400">{items.length} record(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Reference / Entry #</th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3">Ledger Status</th>
                <th className="px-4 py-3">Reconciliation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((tx) => (
                <tr
                  key={tx.id}
                  onClick={() => setSelected(tx)}
                  className="hover:bg-slate-50 cursor-pointer"
                >
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {new Date(tx.occurred_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs font-semibold text-juni-navy">
                      {tx.external_reference ?? tx.entry_number}
                    </div>
                    <div className="font-mono text-[11px] text-slate-400">{tx.entry_number}</div>
                  </td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-700">{tx.channel}</td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-800">{tx.event_type}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(tx.total_amount, tx.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={tx.status} />
                  </td>
                  <td className="px-4 py-3">
                    {tx.reconciliation_status !== "N/A" ? (
                      <StatusBadge status={tx.reconciliation_status} />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Transaction Lifecycle Modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div
            className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-juni-blue text-white">
              <div>
                <div className="text-xs font-mono text-slate-300">
                  {selected.entry_number} • {selected.channel}
                </div>
                <h3 className="text-sm font-semibold">{selected.description}</h3>
              </div>
              <button onClick={() => setSelected(null)} className="text-slate-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400">External Ref</span>
                  <div className="font-mono font-medium">{selected.external_reference ?? "—"}</div>
                </div>
                <div>
                  <span className="text-slate-400">Correlation ID</span>
                  <div className="font-mono font-medium">{selected.correlation_id ?? "—"}</div>
                </div>
                <div>
                  <span className="text-slate-400">Status</span>
                  <div className="mt-0.5"><StatusBadge status={selected.status} /></div>
                </div>
                <div>
                  <span className="text-slate-400">Created By</span>
                  <div className="font-medium">{selected.created_by}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2">Account</th>
                      <th className="px-3 py-2">Memo</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selected.lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2 font-medium text-slate-800">
                          <span className="font-mono text-slate-400 mr-1.5">{l.account_code}</span>
                          {l.account_name}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{l.line_memo ?? "—"}</td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.direction === "DEBIT" ? formatMoney(l.amount, selected.currency) : "—"}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">
                          {l.direction === "CREDIT" ? formatMoney(l.amount, selected.currency) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-2">
                {selected.status === "POSTED" && !selected.reverses_entry_id && (
                  <button
                    onClick={() => handleReverse(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-juni-red/30 bg-white hover:bg-juni-red/10 px-3.5 py-2 text-xs font-medium text-juni-red"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reverse Transaction
                  </button>
                )}
                <button
                  onClick={() => setSelected(null)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
