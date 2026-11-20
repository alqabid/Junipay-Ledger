import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeftRight, Plus, X } from "lucide-react";
import { api, formatMoney } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { JournalLine, MerchantSummary } from "../types/ledger";

export function MerchantsPage({
  refreshKey,
  onDataChanged,
}: {
  refreshKey: number;
  onDataChanged: () => void;
}) {
  const [merchants, setMerchants] = useState<MerchantSummary[]>([]);
  const [selectedMerchant, setSelectedMerchant] = useState<MerchantSummary | null>(null);
  const [lines, setLines] = useState<JournalLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Transaction modal
  const [showTxModal, setShowTxModal] = useState(false);
  const [evType, setEvType] = useState<"COLLECTION" | "DISBURSEMENT" | "REFUND">("COLLECTION");
  const [evMerchant, setEvMerchant] = useState("");
  const [evAmount, setEvAmount] = useState("");
  const [evFee, setEvFee] = useState("0");
  const [evRef, setEvRef] = useState("");

  // Merchant onboarding modal
  const [showAddMerchant, setShowAddMerchant] = useState(false);
  const [newExtId, setNewExtId] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<"MERCHANT" | "SUB_MERCHANT">("MERCHANT");
  const [newParentId, setNewParentId] = useState("");

  const load = () => {
    api
      .getMerchants()
      .then((m) => {
        setMerchants(m);
        if (m.length > 0 && !evMerchant) setEvMerchant(m[0].external_merchant_id);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  const inspectMerchant = async (m: MerchantSummary) => {
    setSelectedMerchant(m);
    try {
      const l = await api.getMerchantLedger(m.id);
      setLines(l);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load merchant ledger");
    }
  };

  const handlePostEvent = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.ingestTransactionEvent({
        idempotency_key: `ui-${evType.toLowerCase()}-${Date.now()}`,
        event_type: evType,
        external_reference: evRef || `TXN-${Date.now()}`,
        external_merchant_id: evMerchant,
        gross_amount: evAmount,
        fee_amount: evFee || "0",
        currency: "GHS",
      });
      setShowTxModal(false);
      setEvAmount("");
      setEvRef("");
      load();
      onDataChanged();
      if (selectedMerchant) inspectMerchant(selectedMerchant);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post event");
    }
  };

  const handleCreateMerchant = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createMerchant({
        external_merchant_id: newExtId.trim(),
        name: newName.trim(),
        merchant_type: newType,
        parent_merchant_id: newType === "SUB_MERCHANT" ? newParentId || null : null,
        default_currency: "GHS",
      });
      setShowAddMerchant(false);
      setNewExtId("");
      setNewName("");
      setNewParentId("");
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register merchant");
    }
  };

  const parentMerchants = merchants.filter((m) => m.merchant_type === "MERCHANT");

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-juni-blue">Merchants & Sub-Merchants</h3>
            <p className="text-xs text-slate-500">Segregated Available &amp; Pending settlement balances per merchant</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTxModal(true)}
              disabled={merchants.length === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-juni-red hover:bg-juni-red-hover disabled:opacity-50 px-3.5 py-2 text-xs font-medium text-white transition-colors"
            >
              <ArrowLeftRight className="h-3.5 w-3.5" />
              Post Transaction
            </button>
            <button
              onClick={() => setShowAddMerchant(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-juni-blue hover:bg-juni-navy px-3.5 py-2 text-xs font-medium text-white transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              Register Merchant
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Merchant</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3 text-right">Available</th>
                <th className="px-4 py-3 text-right">Pending</th>
                <th className="px-4 py-3 text-right">Collections</th>
                <th className="px-4 py-3 text-right">Disbursements</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {merchants.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                    No merchants registered yet. Click "Register Merchant" or load sample test data.
                  </td>
                </tr>
              ) : (
                merchants.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div
                        className={`font-medium text-slate-800 ${
                          m.merchant_type === "SUB_MERCHANT" ? "pl-4 border-l-2 border-juni-red/40" : ""
                        }`}
                      >
                        {m.name}
                      </div>
                      <div className="font-mono text-xs text-slate-400">{m.external_merchant_id}</div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">{m.merchant_type}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-juni-blue">
                      {formatMoney(m.available_balance, m.default_currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-700">
                      {formatMoney(m.pending_balance, m.default_currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(m.total_collections, m.default_currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatMoney(m.total_disbursements, m.default_currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={m.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => inspectMerchant(m)}
                        className="text-xs font-medium text-juni-navy hover:text-juni-red transition-colors"
                      >
                        View Sub-Ledger
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedMerchant && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-juni-blue">
              Sub-Ledger Lines: {selectedMerchant.name}
            </h3>
            <button
              onClick={() => setSelectedMerchant(null)}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Close
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5">Account</th>
                  <th className="px-4 py-2.5">Direction</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5">Memo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="px-4 py-2.5 font-mono text-slate-700">{l.account_code}</td>
                    <td className="px-4 py-2.5 font-medium">{l.direction}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatMoney(l.amount, l.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{l.line_memo ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Post Transaction Event Modal */}
      {showTxModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-juni-blue text-white">
              <div>
                <h3 className="text-sm font-semibold">Post Transaction Event</h3>
                <p className="text-[11px] text-slate-300 font-mono">POST /api/v1/integrations/events</p>
              </div>
              <button onClick={() => setShowTxModal(false)} className="text-slate-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handlePostEvent} className="p-5 space-y-3">
              <select
                value={evType}
                onChange={(e) => setEvType(e.target.value as "COLLECTION" | "DISBURSEMENT" | "REFUND")}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="COLLECTION">COLLECTION</option>
                <option value="DISBURSEMENT">DISBURSEMENT</option>
                <option value="REFUND">REFUND</option>
              </select>
              <select
                required
                value={evMerchant}
                onChange={(e) => setEvMerchant(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">Select Merchant...</option>
                {merchants.map((m) => (
                  <option key={m.id} value={m.external_merchant_id}>
                    {m.name} ({m.external_merchant_id})
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-3">
                <input
                  required
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="Gross Amount"
                  value={evAmount}
                  onChange={(e) => setEvAmount(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Fee Amount"
                  value={evFee}
                  onChange={(e) => setEvFee(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <input
                placeholder="External Ref (optional)"
                value={evRef}
                onChange={(e) => setEvRef(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowTxModal(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-4 py-2 text-xs font-medium text-white"
                >
                  Post Event
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Register Merchant Modal */}
      {showAddMerchant && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-juni-blue text-white">
              <h3 className="text-sm font-semibold">Register Merchant / Sub-Merchant</h3>
              <button onClick={() => setShowAddMerchant(false)} className="text-slate-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateMerchant} className="p-5 space-y-3">
              <input
                required
                placeholder="External Merchant ID (e.g. MRC-002)"
                value={newExtId}
                onChange={(e) => setNewExtId(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                required
                placeholder="Business / Branch Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as "MERCHANT" | "SUB_MERCHANT")}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="MERCHANT">MERCHANT (Parent)</option>
                <option value="SUB_MERCHANT">SUB_MERCHANT (Child)</option>
              </select>
              {newType === "SUB_MERCHANT" && (
                <select
                  required
                  value={newParentId}
                  onChange={(e) => setNewParentId(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select Parent Merchant...</option>
                  {parentMerchants.map((pm) => (
                    <option key={pm.id} value={pm.id}>
                      {pm.name} ({pm.external_merchant_id})
                    </option>
                  ))}
                </select>
              )}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddMerchant(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-4 py-2 text-xs font-medium text-white"
                >
                  Create Sub-Ledger Accounts
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
