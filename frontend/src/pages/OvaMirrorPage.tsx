import { useEffect, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRightLeft, Download, Plus, RefreshCw, X } from "lucide-react";
import { api, formatMoney } from "../api/client";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import type {
  OvaAccount,
  OvaExceptionsFeed,
  OvaLiquidation,
  OvaOverview,
  OvaStatementEntry,
  OvaTransaction,
} from "../types/ledger";

type OvaSubTab = "overview" | "ussd" | "transactions" | "liquidations" | "statements" | "exceptions";
type UssdItem = Awaited<ReturnType<typeof api.getUssdVerifications>>[number];

export function OvaMirrorPage({ refreshKey }: { refreshKey: number }) {
  const [subTab, setSubTab] = useState<OvaSubTab>("overview");
  const [overview, setOverview] = useState<OvaOverview | null>(null);
  const [accounts, setAccounts] = useState<OvaAccount[]>([]);
  const [transactions, setTransactions] = useState<OvaTransaction[]>([]);
  const [liquidations, setLiquidations] = useState<OvaLiquidation[]>([]);
  const [statements, setStatements] = useState<OvaStatementEntry[]>([]);
  const [exceptions, setExceptions] = useState<OvaExceptionsFeed | null>(null);
  const [ussdList, setUssdList] = useState<UssdItem[]>([]);
  const [balanceMovement, setBalanceMovement] = useState<Awaited<ReturnType<typeof api.getOvaBalanceMovement>> | null>(null);
  const [eventFilter, setEventFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [selectedOvaFilter, setSelectedOvaFilter] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // Statement ingest form
  const [stmtOvaCode, setStmtOvaCode] = useState("OVA_MAIN");
  const [txRef, setTxRef] = useState("");
  const [direction, setDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");

  // Register OVA modal
  const [showAddOva, setShowAddOva] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newProvCode, setNewProvCode] = useState("");
  const [newProvName, setNewProvName] = useState("");
  const [newAccType, setNewAccType] = useState<"COLLECTION_OVA" | "PAYOUT_OVA" | "SETTLEMENT_ACCOUNT">("COLLECTION_OVA");
  const [newMasked, setNewMasked] = useState("");

  // Liquidation form
  const [liqSrc, setLiqSrc] = useState("OVA_MAIN");
  const [liqDst, setLiqDst] = useState("OVA_BANK_SETTLE");
  const [liqGross, setLiqGross] = useState("");
  const [liqFee, setLiqFee] = useState("0");
  const [liqRef, setLiqRef] = useState("");

  const load = () => {
    Promise.all([
      api.getOvaOverview(),
      api.getOvaAccounts(),
      api.getOvaTransactions(selectedOvaFilter || undefined),
      api.getOvaLiquidations(),
      api.getOvaStatements(),
      api.getOvaExceptions(),
      api.getOvaBalanceMovement(selectedOvaFilter || undefined),
      api.getUssdVerifications(),
    ])
      .then(([ov, accs, txs, liqs, stmts, exc, bm, ussds]) => {
        setOverview(ov);
        setAccounts(accs);
        setTransactions(txs);
        setLiquidations(liqs);
        setStatements(stmts);
        setExceptions(exc);
        setBalanceMovement(bm);
        setUssdList(ussds);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [refreshKey, selectedOvaFilter]);

  const handleSync = async (ovaCode: string) => {
    const val = window.prompt(`Enter provider-reported balance for ${ovaCode} (does NOT edit internal ledger):`);
    if (val === null || val.trim() === "") return;
    try {
      await api.syncOvaBalance(ovaCode, val.trim());
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to sync provider balance");
    }
  };

  const handleCreateOva = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createOvaAccount({
        code: newCode.trim().toUpperCase(),
        provider_code: newProvCode.trim().toUpperCase(),
        provider_name: newProvName.trim(),
        account_type: newAccType,
        account_number_masked: newMasked.trim(),
        currency: "GHS",
      });
      setShowAddOva(false);
      setNewCode("");
      setNewProvCode("");
      setNewProvName("");
      setNewMasked("");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to register provider account");
    }
  };

  const handleIngestStmt = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.ingestOvaStatement({
        ova_code: stmtOvaCode,
        external_tx_ref: txRef,
        direction,
        amount,
        currency: "GHS",
        narration: narration || `Statement ${txRef}`,
      });
      setTxRef("");
      setAmount("");
      setNarration("");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to ingest OVA statement");
    }
  };

  const handleCreateLiquidation = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createOvaLiquidation({
        source_ova_code: liqSrc,
        destination_ova_code: liqDst,
        gross_amount: liqGross,
        provider_fee_amount: liqFee || "0",
        external_transfer_ref: liqRef || undefined,
      });
      setLiqGross("");
      setLiqRef("");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to initiate liquidation");
    }
  };

  const handleCompleteLiquidation = async (id: string) => {
    try {
      await api.completeOvaLiquidation(id);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to complete liquidation");
    }
  };

  const filteredTransactions = transactions.filter((t) => {
    const dt = t.occurred_at.slice(0, 10);
    if (startDate && dt < startDate) return false;
    if (endDate && dt > endDate) return false;
    if (eventFilter && t.event_type !== eventFilter) return false;
    return true;
  });

  const jumpToTransactions = (ovaCode = "", evType = "") => {
    setSelectedOvaFilter(ovaCode);
    setEventFilter(evType);
    setSubTab("transactions");
  };

  const exportTransactionsCsv = () => {
    const header = "Date,OVA Code,Provider,Entry #,External Ref,Type,Direction,Amount,Running Balance,Status,Description\n";
    const rows = filteredTransactions
      .map((t) =>
        [
          t.occurred_at,
          t.ova_code,
          `"${t.provider_name.replace(/"/g, '""')}"`,
          t.entry_number,
          t.external_reference ?? "",
          t.event_type,
          t.direction,
          t.amount,
          t.running_balance,
          t.status,
          `"${t.description.replace(/"/g, '""')}"`,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `junipay-ova-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleConfirmUssd = async (u: UssdItem) => {
    const ref = window.prompt(`Enter external OVA dashboard reference for ${u.ussd_session_ref}:`);
    if (!ref || !ref.trim()) return;
    const amt = window.prompt(`Verified amount on OVA dashboard (${u.currency}):`, u.expected_amount);
    if (!amt || !amt.trim()) return;
    const notes = amt.trim() !== u.expected_amount ? window.prompt("Amount differs—enter verification notes:") ?? "" : "Verified on external OVA dashboard";
    try {
      await api.confirmUssdVerification(u.id, {
        ova_dashboard_ref: ref.trim(),
        verified_amount: amt.trim(),
        verification_notes: notes,
      });
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to confirm USSD payment");
    }
  };

  const handleRejectUssd = async (u: UssdItem, decision: "REJECTED_MISMATCH" | "FLAGGED_SUSPICIOUS") => {
    const notes = window.prompt(`Enter reason for ${decision}:`);
    if (!notes || notes.trim().length < 3) return;
    try {
      await api.rejectUssdVerification(u.id, { decision, verification_notes: notes.trim() });
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to update USSD verification");
    }
  };

  const subTabs: { id: OvaSubTab; label: string }[] = [
    { id: "overview", label: "Overview & Float Accounts" },
    { id: "ussd", label: `USSD Collection Verification (${ussdList.filter((u) => u.status === "AWAITING_OVA_VERIFICATION").length})` },
    { id: "transactions", label: "Transaction History" },
    { id: "liquidations", label: "Treasury Sweep & Liquidation" },
    { id: "statements", label: "Provider Statements" },
    { id: "exceptions", label: `Exceptions & Alerts (${(exceptions?.discrepancies.filter((d) => d.resolution_status !== "RESOLVED").length ?? 0) + (exceptions?.sync_alerts.length ?? 0)})` },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      {/* Sub-navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {subTabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`rounded-xl px-3.5 py-2 text-xs font-medium transition-colors ${
                subTab === t.id
                  ? "bg-juni-blue text-white"
                  : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowAddOva(true)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-juni-red hover:bg-juni-red-hover px-3.5 py-2 text-xs font-medium text-white"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Provider Account
        </button>
      </div>

      {/* 1. OVERVIEW & PROVIDER ACCOUNTS */}
      {subTab === "overview" && (
        <div className="space-y-6">
          {overview && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard
                title="Internal Ledger Float"
                value={formatMoney(overview.total_mirrored_balance, overview.currency)}
                subtitle={`Across ${overview.account_count} provider float account(s)`}
                tone="default"
              />
              <StatCard
                title="Provider-Reported Float"
                value={formatMoney(overview.total_provider_reported_balance, overview.currency)}
                subtitle={`Statement Variance: ${formatMoney(overview.total_variance, overview.currency)}`}
                tone={parseFloat(overview.total_variance) === 0 ? "emerald" : "amber"}
              />
              <StatCard
                title="Total Float Inflows"
                value={formatMoney(overview.total_collections, overview.currency)}
                subtitle={`Payouts: ${formatMoney(overview.total_withdrawals, overview.currency)} • Provider Fees: ${formatMoney(overview.total_provider_fees, overview.currency)}`}
                tone="indigo"
              />
              <StatCard
                title="Unreconciled Statements"
                value={formatMoney(overview.unreconciled_amount, overview.currency)}
                subtitle={`${overview.unreconciled_count} unmatched entry(s) • ${overview.open_exceptions} open exception(s)`}
                tone={overview.open_exceptions > 0 ? "rose" : "default"}
              />
            </div>
          )}

          {/* Interactive Money Movement & Balance Movement Chart */}
          {balanceMovement && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="text-sm font-semibold text-juni-blue">Treasury &amp; Float Flow (Click stage to inspect)</h3>
                  <p className="text-xs text-slate-500">Customer collections → Provider Float (OVAs) → Settlement Bank → Merchant Payouts</p>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <button
                    onClick={() => jumpToTransactions("", "COLLECTION")}
                    className="rounded-xl border border-slate-200 border-t-4 border-t-juni-navy bg-white p-3 text-left hover:border-juni-navy transition-colors shadow-sm"
                  >
                    <div className="text-[10px] font-bold uppercase text-juni-navy">Collections</div>
                    <div className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                      {formatMoney(balanceMovement.collections, balanceMovement.currency)}
                    </div>
                  </button>
                  <button
                    onClick={() => jumpToTransactions("OVA_MAIN", "")}
                    className="rounded-xl border border-slate-200 border-t-4 border-t-juni-blue bg-white p-3 text-left hover:border-juni-blue transition-colors shadow-sm"
                  >
                    <div className="text-[10px] font-bold uppercase text-juni-blue">Provider Float</div>
                    <div className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                      {formatMoney(overview?.total_mirrored_balance ?? "0", balanceMovement.currency)}
                    </div>
                  </button>
                  <button
                    onClick={() => jumpToTransactions("OVA_BANK_SETTLE", "")}
                    className="rounded-xl border border-slate-200 border-t-4 border-t-blue-600 bg-white p-3 text-left hover:border-blue-600 transition-colors shadow-sm"
                  >
                    <div className="text-[10px] font-bold uppercase text-blue-700">Settlement Bank</div>
                    <div className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                      {formatMoney(
                        accounts.find((a) => a.code === "OVA_BANK_SETTLE")?.ledger_balance ?? "0",
                        balanceMovement.currency
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => jumpToTransactions("", "DISBURSEMENT")}
                    className="rounded-xl border border-slate-200 border-t-4 border-t-juni-red bg-white p-3 text-left hover:border-juni-red transition-colors shadow-sm"
                  >
                    <div className="text-[10px] font-bold uppercase text-juni-red">Merchant Payouts</div>
                    <div className="mt-1 text-sm font-bold tabular-nums text-slate-900">
                      {formatMoney(balanceMovement.withdrawals, balanceMovement.currency)}
                    </div>
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
                <div>
                  <h3 className="text-sm font-semibold text-juni-blue">Float Balance Bridge (Click bar to filter)</h3>
                  <p className="text-xs text-slate-500">Opening → +Collections → −Payouts → −Fees → ±Reversals → Closing</p>
                </div>
                {(() => {
                  const bars = [
                    { label: "Opening", val: parseFloat(balanceMovement.opening_balance) || 0, color: "bg-slate-400", ev: "" },
                    { label: "+Collections", val: parseFloat(balanceMovement.collections) || 0, color: "bg-juni-navy", ev: "COLLECTION" },
                    { label: "−Withdrawals", val: parseFloat(balanceMovement.withdrawals) || 0, color: "bg-juni-red", ev: "DISBURSEMENT" },
                    { label: "−Fees", val: parseFloat(balanceMovement.provider_fees) || 0, color: "bg-slate-900", ev: "" },
                    { label: "±Reversals", val: Math.abs(parseFloat(balanceMovement.reversals_refunds) || 0), color: "bg-blue-500", ev: "REFUND" },
                    { label: "Closing", val: parseFloat(balanceMovement.closing_balance) || 0, color: "bg-juni-blue", ev: "" },
                  ];
                  const maxVal = Math.max(...bars.map((b) => Math.abs(b.val)), 1);
                  return (
                    <div className="grid grid-cols-6 gap-2 items-end h-28 pt-4">
                      {bars.map((b) => {
                        const pct = Math.max(8, Math.round((Math.abs(b.val) / maxVal) * 100));
                        return (
                          <button
                            key={b.label}
                            onClick={() => jumpToTransactions("", b.ev)}
                            className="flex flex-col items-center gap-1 group h-full justify-end"
                            title={`${b.label}: ${formatMoney(b.val, balanceMovement.currency)}`}
                          >
                            <span className="text-[10px] font-semibold tabular-nums text-slate-600 group-hover:text-juni-red">
                              {b.val.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                            </span>
                            <div className={`w-full rounded-t-lg ${b.color} opacity-90 group-hover:opacity-100 transition-all`} style={{ height: `${pct}%` }} />
                            <span className="text-[10px] text-slate-500 truncate w-full text-center">{b.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-juni-blue">Provider Accounts (Transaction-Driven Mirror)</h3>
              <p className="text-xs text-slate-500">
                Internal mirrored balances are derived strictly from immutable journal postings; provider balances are synced separately.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Account / Provider</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Internal Mirrored</th>
                    <th className="px-4 py-3 text-right">Provider-Reported</th>
                    <th className="px-4 py-3 text-right">Variance</th>
                    <th className="px-4 py-3">Sync & Health</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {accounts.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td
                        onClick={() => jumpToTransactions(a.code, "")}
                        className="px-4 py-3 cursor-pointer group"
                      >
                        <div className="font-medium text-slate-800 group-hover:text-juni-red">{a.provider_name}</div>
                        <div className="font-mono text-xs text-slate-400">
                          {a.code} • {a.account_number_masked}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600">{a.account_type}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-juni-blue">
                        {formatMoney(a.ledger_balance, a.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                        {formatMoney(a.external_reported_balance, a.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {formatMoney(a.variance, a.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={a.sync_status} />
                        {a.last_synced_at && (
                          <div className="text-[10px] text-slate-400 mt-0.5">
                            {new Date(a.last_synced_at).toLocaleString()}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => handleSync(a.code)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-juni-navy hover:text-juni-red"
                        >
                          <RefreshCw className="h-3 w-3" />
                          Sync Balance
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 1b. USSD PAYMENT & MANUAL OVA VERIFICATION */}
      {subTab === "ussd" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-sm font-semibold text-juni-blue">USSD Payment & Manual OVA Dashboard Verification</h3>
            <p className="text-xs text-slate-500">
              Staff verify customer USSD payments on the external MTN/Telecel/AT OVA dashboard before confirming into the ledger.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Session Ref</th>
                  <th className="px-4 py-3">Provider / OVA</th>
                  <th className="px-4 py-3">Customer / Merchant</th>
                  <th className="px-4 py-3 text-right">Expected</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Verification Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ussdList.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-juni-navy">{u.ussd_session_ref}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="font-medium text-slate-800">{u.provider_code}</div>
                      <div className="font-mono text-slate-400">{u.ova_code}</div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-slate-700">{u.customer_msisdn_masked}</div>
                      <div className="font-mono text-slate-400">{u.external_merchant_id}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">
                      {formatMoney(u.expected_amount, u.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.status} />
                      {u.ova_dashboard_ref && (
                        <div className="font-mono text-[10px] text-slate-400 mt-0.5">Ref: {u.ova_dashboard_ref}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {u.status === "AWAITING_OVA_VERIFICATION" ? (
                        <div className="inline-flex gap-1.5">
                          <button
                            onClick={() => handleConfirmUssd(u)}
                            className="rounded-lg bg-juni-blue hover:bg-juni-navy px-2.5 py-1 text-xs font-medium text-white"
                          >
                            Confirm & Post
                          </button>
                          <button
                            onClick={() => handleRejectUssd(u, "REJECTED_MISMATCH")}
                            className="rounded-lg border border-juni-red/30 bg-white hover:bg-juni-red/10 px-2 py-1 text-xs font-medium text-juni-red"
                          >
                            Mismatch
                          </button>
                          <button
                            onClick={() => handleRejectUssd(u, "FLAGGED_SUSPICIOUS")}
                            className="rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 px-2 py-1 text-xs font-medium text-slate-800"
                          >
                            Flag
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">{u.verified_by ?? "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. TRANSACTION HISTORY */}
      {subTab === "transactions" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-juni-blue">OVA Mirror Transaction History</h3>
              <p className="text-xs text-slate-500">Immutable inflows, outflows & running balance per OVA</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={selectedOvaFilter}
                onChange={(e) => setSelectedOvaFilter(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs"
              >
                <option value="">All OVA Accounts</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} ({a.provider_name})
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-xl border border-slate-300 px-2.5 py-1.5 text-xs"
              />
              <button
                onClick={exportTransactionsCsv}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">OVA</th>
                  <th className="px-4 py-3">Entry / Ref</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3">Direction</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-right">Running Balance</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredTransactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                      {new Date(t.occurred_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-medium text-juni-blue">{t.ova_code}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-600">
                      {t.entry_number}
                      {t.external_reference && <div className="text-[11px] text-slate-400">{t.external_reference}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-slate-700 max-w-xs truncate">{t.description}</td>
                    <td className="px-4 py-2.5 font-semibold">
                      <span className={t.direction === "DEBIT" ? "text-juni-blue" : "text-juni-red"}>
                        {t.direction === "DEBIT" ? "CREDIT (Inflow)" : "DEBIT (Outflow)"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium">
                      {formatMoney(t.amount, t.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                      {formatMoney(t.running_balance, t.currency)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusBadge status={t.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. LIQUIDATION MANAGEMENT */}
      {subTab === "liquidations" && (
        <div className="space-y-6">
          <form onSubmit={handleCreateLiquidation} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-juni-blue flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 text-juni-red" />
              Initiate OVA Liquidation (Provider OVA → Settlement Account)
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <select
                value={liqSrc}
                onChange={(e) => setLiqSrc(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    From: {a.code}
                  </option>
                ))}
              </select>
              <select
                value={liqDst}
                onChange={(e) => setLiqDst(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    To: {a.code}
                  </option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Gross Amount"
                value={liqGross}
                onChange={(e) => setLiqGross(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Provider Fee"
                value={liqFee}
                onChange={(e) => setLiqFee(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Transfer Ref (optional)"
                value={liqRef}
                onChange={(e) => setLiqRef(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-4 py-2 text-xs font-medium text-white"
            >
              Initiate Liquidation
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-juni-blue">Liquidation Batches</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3">Route</th>
                    <th className="px-4 py-3 text-right">Gross</th>
                    <th className="px-4 py-3 text-right">Fee</th>
                    <th className="px-4 py-3 text-right">Net</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {liquidations.map((l) => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-juni-navy">{l.liquidation_ref}</td>
                      <td className="px-4 py-3 text-xs font-medium text-slate-700">
                        {l.source_ova_code} → {l.destination_ova_code}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatMoney(l.gross_amount, l.currency)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                        {formatMoney(l.provider_fee_amount, l.currency)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(l.net_amount, l.currency)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={l.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {l.status === "INITIATED" && (
                          <button
                            onClick={() => handleCompleteLiquidation(l.id)}
                            className="rounded-lg bg-juni-blue hover:bg-juni-navy px-3 py-1 text-xs font-medium text-white"
                          >
                            Complete & Post GL
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
      )}

      {/* 4. STATEMENTS */}
      {subTab === "statements" && (
        <div className="space-y-6">
          <form onSubmit={handleIngestStmt} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
            <h3 className="text-sm font-semibold text-juni-blue">Ingest External Provider Statement Entry</h3>
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3">
              <select
                value={stmtOvaCode}
                onChange={(e) => setStmtOvaCode(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code}
                  </option>
                ))}
              </select>
              <input
                required
                placeholder="External Tx Ref"
                value={txRef}
                onChange={(e) => setTxRef(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as "CREDIT" | "DEBIT")}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="CREDIT">CREDIT (Inflow)</option>
                <option value="DEBIT">DEBIT (Outflow)</option>
              </select>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                placeholder="Narration"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-4 py-2 text-xs font-medium text-white"
            >
              Record Statement Line
            </button>
          </form>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-juni-blue">Ingested Provider Statements</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">External Ref</th>
                    <th className="px-4 py-3">Direction</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Narration</th>
                    <th className="px-4 py-3">Match Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {statements.map((st) => (
                    <tr key={st.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-700">{st.external_tx_ref}</td>
                      <td className="px-4 py-3 font-medium">{st.direction}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium">
                        {formatMoney(st.amount, st.currency)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{st.narration ?? "—"}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={st.reconciliation_status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* 5. EXCEPTIONS & ALERTS */}
      {subTab === "exceptions" && exceptions && (
        <div className="space-y-6">
          {exceptions.sync_alerts.length > 0 && (
            <div className="rounded-xl border border-slate-300 bg-slate-50 p-4 space-y-2">
              <h3 className="text-xs font-semibold uppercase text-juni-blue flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-juni-red" />
                Provider Sync Alerts
              </h3>
              <div className="space-y-1.5 text-xs text-slate-800">
                {exceptions.sync_alerts.map((s) => (
                  <div key={s.ova_code} className="flex items-center justify-between">
                    <span>
                      <span className="font-mono font-semibold">{s.ova_code}</span> ({s.provider_name})
                    </span>
                    <StatusBadge status={s.sync_status} />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-juni-blue">Transaction Exceptions & Discrepancies</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Ref</th>
                    <th className="px-4 py-3 text-right">Diff</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {exceptions.discrepancies.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{d.discrepancy_type}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{d.external_tx_ref ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-juni-red">
                        {formatMoney(d.difference_amount, "GHS")}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={d.resolution_status} />
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">{d.resolution_notes ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Register Provider OVA Account Modal */}
      {showAddOva && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-juni-blue text-white">
              <h3 className="text-sm font-semibold">Register Provider OVA / Settlement Account</h3>
              <button onClick={() => setShowAddOva(false)} className="text-slate-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateOva} className="p-5 space-y-3">
              <input
                required
                placeholder="OVA Code (e.g. OVA_MTN_PAYOUT)"
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                required
                placeholder="Provider Code (e.g. MTN_MOMO)"
                value={newProvCode}
                onChange={(e) => setNewProvCode(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                required
                placeholder="Provider Name (e.g. MTN Mobile Money)"
                value={newProvName}
                onChange={(e) => setNewProvName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={newAccType}
                onChange={(e) =>
                  setNewAccType(e.target.value as "COLLECTION_OVA" | "PAYOUT_OVA" | "SETTLEMENT_ACCOUNT")
                }
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="COLLECTION_OVA">COLLECTION_OVA</option>
                <option value="PAYOUT_OVA">PAYOUT_OVA</option>
                <option value="SETTLEMENT_ACCOUNT">SETTLEMENT_ACCOUNT</option>
              </select>
              <input
                required
                placeholder="Masked Account # (e.g. ****-9920)"
                value={newMasked}
                onChange={(e) => setNewMasked(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddOva(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-4 py-2 text-xs font-medium text-white"
                >
                  Create OVA Mirror
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
