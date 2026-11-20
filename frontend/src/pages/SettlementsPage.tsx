import { useEffect, useState, type FormEvent } from "react";
import { api, formatMoney } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { MerchantSummary, SettlementBatch } from "../types/ledger";

export function SettlementsPage({
  refreshKey,
  onDataChanged,
}: {
  refreshKey: number;
  onDataChanged: () => void;
}) {
  const [batches, setBatches] = useState<SettlementBatch[]>([]);
  const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
  const [selectedMerchant, setSelectedMerchant] = useState("");
  const [feeAmount, setFeeAmount] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => {
    Promise.all([api.getSettlements(), api.getMerchants()])
      .then(([b, m]) => {
        setBatches(b);
        setMerchants(m);
        if (m.length > 0 && !selectedMerchant) setSelectedMerchant(m[0].external_merchant_id);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createSettlement({
        external_merchant_id: selectedMerchant,
        currency: "GHS",
        fee_amount: feeAmount || "0",
      });
      setFeeAmount("0");
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create settlement batch");
    }
  };

  const handleSettle = async (batchId: string) => {
    setBusyId(batchId);
    try {
      await api.settleBatch(batchId);
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to settle batch");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      <form onSubmit={handleCreate} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-slate-800">Create Settlement Batch (From Pending Balance)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <select
            required
            value={selectedMerchant}
            onChange={(e) => setSelectedMerchant(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Select Merchant...</option>
            {merchants.map((m) => (
              <option key={m.id} value={m.external_merchant_id}>
                {m.name} (Pending: {formatMoney(m.pending_balance, m.default_currency)})
              </option>
            ))}
          </select>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Settlement Fee (optional)"
            value={feeAmount}
            onChange={(e) => setFeeAmount(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={!selectedMerchant}
            className="rounded-xl bg-juni-red hover:bg-juni-red-hover disabled:opacity-50 px-4 py-2 text-xs font-medium text-white transition-colors"
          >
            Create Batch
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">Settlement Batches</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Batch Ref</th>
                <th className="px-4 py-3">Merchant</th>
                <th className="px-4 py-3 text-right">Gross</th>
                <th className="px-4 py-3 text-right">Fee</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {batches.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-700">{b.batch_reference}</td>
                  <td className="px-4 py-3 font-medium text-slate-800">{b.merchant_name ?? b.merchant_id}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(b.gross_amount, b.currency)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                    {formatMoney(b.fee_amount, b.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(b.net_amount, b.currency)}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {b.status === "PENDING" && (
                      <button
                        onClick={() => handleSettle(b.id)}
                        disabled={busyId === b.id}
                        className="rounded-lg bg-juni-blue hover:bg-juni-navy disabled:opacity-50 px-3 py-1 text-xs font-medium text-white"
                      >
                        {busyId === b.id ? "Settling..." : "Execute Settlement"}
                      </button>
                    )}
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
