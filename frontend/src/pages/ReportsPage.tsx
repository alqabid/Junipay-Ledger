import { useEffect, useState, type FormEvent } from "react";
import { Check, Download, Lock, Printer, X } from "lucide-react";
import { api, formatMoney } from "../api/client";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import type { AccountBalance, FinancialReport, OvaAccount } from "../types/ledger";

type DailyClosingItem = Awaited<ReturnType<typeof api.getDailyClosings>>[number];
type AdjustmentItem = Awaited<ReturnType<typeof api.getAdjustments>>[number];
type ExpenseItem = Awaited<ReturnType<typeof api.getExpenses>>[number];

export function ReportsPage({
  refreshKey,
  onDataChanged,
}: {
  refreshKey: number;
  onDataChanged: () => void;
}) {
  const [report, setReport] = useState<FinancialReport | null>(null);
  const [closings, setClosings] = useState<DailyClosingItem[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentItem[]>([]);
  const [expenses, setExpenses] = useState<ExpenseItem[]>([]);
  const [ovaAccounts, setOvaAccounts] = useState<OvaAccount[]>([]);
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [period, setPeriod] = useState<"daily" | "weekly" | "monthly">("daily");
  const [subTab, setSubTab] = useState<"reports" | "closing" | "approvals">("reports");
  const [error, setError] = useState<string | null>(null);

  // Expense form
  const [expCat, setExpCat] = useState("INFRASTRUCTURE");
  const [expPurpose, setExpPurpose] = useState("");
  const [expDest, setExpDest] = useState("");
  const [expSource, setExpSource] = useState("OVA_MAIN");
  const [expAmount, setExpAmount] = useState("");

  // Adjustment request form
  const [adjDesc, setAdjDesc] = useState("");
  const [adjDebit, setAdjDebit] = useState("");
  const [adjCredit, setAdjCredit] = useState("");
  const [adjAmount, setAdjAmount] = useState("");

  const load = () => {
    Promise.all([
      api.getFinancialReports(period),
      api.getDailyClosings(),
      api.getAdjustments(),
      api.getAccounts(),
      api.getExpenses(),
      api.getOvaAccounts(),
    ])
      .then(([r, c, a, accs, exps, ovas]) => {
        setReport(r);
        setClosings(c);
        setAdjustments(a);
        setAccounts(accs);
        setExpenses(exps);
        setOvaAccounts(ovas);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [refreshKey, period]);

  const handleDailyClose = async () => {
    const notes = window.prompt("Optional EOD closing notes:") ?? undefined;
    try {
      await api.executeDailyClose(notes);
      load();
      onDataChanged();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to record daily closing");
    }
  };

  const handleRequestAdj = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.requestAdjustment({
        description: adjDesc,
        debit_account_id: adjDebit,
        credit_account_id: adjCredit,
        amount: adjAmount,
        currency: "GHS",
      });
      setAdjDesc("");
      setAdjAmount("");
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit adjustment request");
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await api.approveAdjustment(id, "Approved via Reports & Controls");
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to approve adjustment");
    }
  };

  const handleReject = async (id: string) => {
    const notes = window.prompt("Rejection reason:") ?? "Rejected";
    try {
      await api.rejectAdjustment(id, notes);
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reject adjustment");
    }
  };

  const handleCreateExpense = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.createExpense({
        category: expCat,
        purpose: expPurpose,
        destination: expDest,
        source_ova_code: expSource,
        amount: expAmount,
        currency: "GHS",
      });
      setExpPurpose("");
      setExpDest("");
      setExpAmount("");
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to initiate expense");
    }
  };

  const handleApproveExpense = async (id: string) => {
    try {
      await api.approveExpense(id, "Approved by reviewer");
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to approve expense");
    }
  };

  const handleRejectExpense = async (id: string) => {
    const notes = window.prompt("Rejection reason:") ?? "Rejected";
    try {
      await api.rejectExpense(id, notes);
      load();
      onDataChanged();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to reject expense");
    }
  };

  if (error && !report) {
    return <div className="rounded-xl border border-juni-red/30 bg-juni-red/5 p-4 text-sm text-juni-red">{error}</div>;
  }
  if (!report) {
    return <div className="text-sm text-slate-500">Generating financial reports...</div>;
  }

  const ccy = report.currency;

  const exportTrialBalanceCsv = () => {
    const header = "Account Code,Account Name,Type,Debit Total,Credit Total,Net Balance,Currency\n";
    const rows = report.trial_balance.rows
      .map((r) =>
        [r.code, `"${r.name.replace(/"/g, '""')}"`, r.account_type, r.debit_total, r.credit_total, r.net_balance, r.currency].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `junipay-trial-balance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      {/* Period Filter & Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 mr-2">
            <button
              onClick={() => setSubTab("reports")}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${subTab === "reports" ? "bg-juni-blue text-white" : "text-slate-600 hover:text-juni-blue"
                }`}
            >
              Trial Balance
            </button>
            <button
              onClick={() => setSubTab("closing")}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${subTab === "closing" ? "bg-juni-blue text-white" : "text-slate-600 hover:text-juni-blue"
                }`}
            >
              Daily Closing ({closings.length})
            </button>
            <button
              onClick={() => setSubTab("approvals")}
              className={`rounded-lg px-3 py-1 text-xs font-semibold ${subTab === "approvals" ? "bg-juni-blue text-white" : "text-slate-600 hover:text-juni-blue"
                }`}
            >
              Expenses & Approvals ({expenses.filter((e) => e.status === "PENDING_APPROVAL").length + adjustments.filter((a) => a.status === "PENDING_APPROVAL").length})
            </button>
          </div>
          {(["daily", "weekly", "monthly"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize ${period === p ? "bg-juni-red text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
          >
            <Printer className="h-3.5 w-3.5" />
            Print / PDF
          </button>
          <button
            onClick={exportTrialBalanceCsv}
            className="inline-flex items-center gap-1.5 rounded-xl bg-juni-blue hover:bg-juni-navy px-3 py-1.5 text-xs font-medium text-white"
          >
            <Download className="h-3.5 w-3.5" />
            Excel / CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Gross Fee Revenue"
          value={formatMoney(report.psp_income_statement.fee_revenue, ccy)}
          subtitle={`Partner Processing Fees: ${formatMoney(report.psp_income_statement.partner_processing_costs, ccy)} • Operating Expenses: ${formatMoney(report.psp_income_statement.operational_expenses ?? "0", ccy)}`}
        />
        <StatCard
          title="Net Platform Revenue"
          value={formatMoney(report.psp_income_statement.net_psp_margin, ccy)}
          subtitle="Earned platform fees minus partner & operating costs"
        />
        <StatCard
          title="Custody Coverage"
          value={formatMoney(report.custody_position.coverage_surplus, ccy)}
          subtitle={`Custody Float ${formatMoney(report.custody_position.ova_mirror_balance, ccy)} vs Merchant Payables ${formatMoney(
            report.custody_position.total_merchant_obligations,
            ccy
          )}`}
          tone={parseFloat(report.custody_position.coverage_surplus) >= 0 ? "default" : "rose"}
        />
      </div>

      {/* Daily Closing Control */}
      {subTab === "closing" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-juni-blue">Daily Closing & EOD Sign-Off</h2>
              <p className="text-xs text-slate-500">Record immutable end-of-day trial balance & custody snapshot (Finance role)</p>
            </div>
            <button
              onClick={handleDailyClose}
              className="inline-flex items-center gap-1.5 rounded-xl bg-juni-blue hover:bg-juni-navy px-3.5 py-2 text-xs font-medium text-white"
            >
              <Lock className="h-3.5 w-3.5" />
              Execute Daily Close
            </button>
          </div>
          {closings.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-2.5">Closing Date</th>
                    <th className="px-4 py-2.5 text-right">TB Debits / Credits</th>
                    <th className="px-4 py-2.5 text-right">Provider Custody</th>
                    <th className="px-4 py-2.5 text-right">Merchant Obligations</th>
                    <th className="px-4 py-2.5">Closed By</th>
                    <th className="px-4 py-2.5">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {closings.map((c) => (
                    <tr key={c.id}>
                      <td className="px-4 py-2.5 font-mono font-semibold text-juni-blue">{c.closing_date}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(c.trial_balance_debits, c.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(c.provider_balance_total, c.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(c.merchant_obligations_total, c.currency)}</td>
                      <td className="px-4 py-2.5 text-slate-600">{c.closed_by}</td>
                      <td className="px-4 py-2.5">
                        <StatusBadge status={c.is_balanced ? "COMPLETED" : "DISCREPANCY"} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Sensitive Adjustment Approval Workflow */}
      {subTab === "approvals" && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-juni-blue">Adjustment Approval Workflow</h2>
              <p className="text-xs text-slate-500">Sensitive manual adjustments require Finance or Management approval before posting to GL</p>
            </div>
            <form onSubmit={handleRequestAdj} className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-5 gap-2">
              <input
                required
                placeholder="Adjustment reason"
                value={adjDesc}
                onChange={(e) => setAdjDesc(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
              <select
                required
                value={adjDebit}
                onChange={(e) => setAdjDebit(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Debit Account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
              <select
                required
                value={adjCredit}
                onChange={(e) => setAdjCredit(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="">Credit Account...</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Amount"
                value={adjAmount}
                onChange={(e) => setAdjAmount(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
              <button
                type="submit"
                className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-3 py-1.5 text-xs font-medium text-white"
              >
                Submit for Approval
              </button>
            </form>
            {adjustments.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">Ref</th>
                      <th className="px-4 py-2.5">Description</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5">Requested By</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Review</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {adjustments.map((adj) => (
                      <tr key={adj.id}>
                        <td className="px-4 py-2.5 font-mono text-juni-navy">{adj.request_ref}</td>
                        <td className="px-4 py-2.5 text-slate-700">{adj.description}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatMoney(adj.amount, adj.currency)}</td>
                        <td className="px-4 py-2.5 text-slate-500">{adj.requested_by}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={adj.status} /></td>
                        <td className="px-4 py-2.5 text-right">
                          {adj.status === "PENDING_APPROVAL" ? (
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => handleApprove(adj.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-juni-blue hover:bg-juni-navy px-2.5 py-1 text-[11px] font-medium text-white"
                              >
                                <Check className="h-3 w-3" /> Approve
                              </button>
                              <button
                                onClick={() => handleReject(adj.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-white border border-juni-red/30 hover:bg-juni-red/10 px-2.5 py-1 text-[11px] font-medium text-juni-red"
                              >
                                <X className="h-3 w-3" /> Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">{adj.reviewed_by ?? "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Operational Expenses & Authorised Outflows (Maker-Checker) */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-juni-blue">Operational Expenses & Authorised Outflows</h2>
              <p className="text-xs text-slate-500">Maker-checker control: initiator cannot approve their own expense</p>
            </div>
            <form onSubmit={handleCreateExpense} className="p-4 bg-slate-50 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-6 gap-2">
              <select
                value={expCat}
                onChange={(e) => setExpCat(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                <option value="INFRASTRUCTURE">INFRASTRUCTURE</option>
                <option value="TELECOM_SMS">TELECOM_SMS</option>
                <option value="BANK_CHARGES">BANK_CHARGES</option>
                <option value="OPERATIONS">OPERATIONS</option>
              </select>
              <input
                required
                placeholder="Purpose"
                value={expPurpose}
                onChange={(e) => setExpPurpose(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
              <input
                required
                placeholder="Destination / Vendor"
                value={expDest}
                onChange={(e) => setExpDest(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
              <select
                value={expSource}
                onChange={(e) => setExpSource(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
              >
                {ovaAccounts.map((o) => (
                  <option key={o.id} value={o.code}>{o.code}</option>
                ))}
              </select>
              <input
                required
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Amount"
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs"
              />
              <button
                type="submit"
                className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-3 py-1.5 text-xs font-medium text-white"
              >
                Initiate Expense
              </button>
            </form>
            {expenses.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-2.5">Ref</th>
                      <th className="px-4 py-2.5">Category / Purpose</th>
                      <th className="px-4 py-2.5">Destination</th>
                      <th className="px-4 py-2.5 text-right">Amount</th>
                      <th className="px-4 py-2.5">Initiated By</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5 text-right">Approval</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {expenses.map((ex) => (
                      <tr key={ex.id}>
                        <td className="px-4 py-2.5 font-mono text-juni-navy">{ex.expense_ref}</td>
                        <td className="px-4 py-2.5">
                          <span className="font-semibold text-slate-800">{ex.category}</span> — {ex.purpose}
                        </td>
                        <td className="px-4 py-2.5 text-slate-600">{ex.destination} ({ex.source_ova_code})</td>
                        <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatMoney(ex.amount, ex.currency)}</td>
                        <td className="px-4 py-2.5 text-slate-500">{ex.initiated_by}</td>
                        <td className="px-4 py-2.5"><StatusBadge status={ex.status} /></td>
                        <td className="px-4 py-2.5 text-right">
                          {ex.status === "PENDING_APPROVAL" ? (
                            <div className="inline-flex gap-1.5">
                              <button
                                onClick={() => handleApproveExpense(ex.id)}
                                className="rounded-lg bg-juni-blue hover:bg-juni-navy px-2.5 py-1 text-[11px] font-medium text-white"
                              >
                                Approve
                              </button>
                              <button
                                onClick={() => handleRejectExpense(ex.id)}
                                className="rounded-lg bg-white border border-juni-red/30 hover:bg-juni-red/10 px-2.5 py-1 text-[11px] font-medium text-juni-red"
                              >
                                Reject
                              </button>
                            </div>
                          ) : (
                            <span className="text-slate-400">{ex.approved_by ?? "—"}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Trial Balance Report */}
      {subTab === "reports" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-juni-blue">Trial Balance Report</h2>
              <p className="text-xs text-slate-500">
                Total Debits {formatMoney(report.trial_balance.total_debits, ccy)} = Total Credits{" "}
                {formatMoney(report.trial_balance.total_credits, ccy)} (
                {report.trial_balance.is_balanced ? "BALANCED" : "OUT OF BALANCE"})
              </p>
            </div>
            <button
              onClick={exportTrialBalanceCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Debits</th>
                  <th className="px-4 py-3 text-right">Credits</th>
                  <th className="px-4 py-3 text-right">Net Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.trial_balance.rows.map((r) => (
                  <tr key={r.code} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{r.code}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{r.account_type}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(r.debit_total, r.currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(r.credit_total, r.currency)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                      {formatMoney(r.net_balance, r.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Merchant Fund Obligations Summary */}
      {subTab === "reports" && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h2 className="text-sm font-semibold text-juni-blue">Merchant Fund Obligations Summary</h2>
            <p className="text-xs text-slate-500">Liabilities owed by JuniPay to merchants &amp; sub-merchants</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3">Merchant</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3 text-right">Pending</th>
                  <th className="px-4 py-3 text-right">Total Obligation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {report.merchant_obligations.map((m) => (
                  <tr key={m.external_merchant_id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {m.name} <span className="font-mono text-xs text-slate-400 ml-1">({m.external_merchant_id})</span>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-slate-500">{m.merchant_type}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-juni-blue">
                      {formatMoney(m.available_balance, m.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                      {formatMoney(m.pending_balance, m.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                      {formatMoney(m.total_obligation, m.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
