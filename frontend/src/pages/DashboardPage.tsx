import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Landmark,
} from "lucide-react";
import { api, formatMoney } from "../api/client";
import type { NavTab } from "../components/Layout";
import { StatCard } from "../components/StatCard";
import { StatusBadge } from "../components/StatusBadge";
import type { DashboardSummary, JournalEntry } from "../types/ledger";

export function DashboardPage({
  refreshKey,
  onNavigate,
}: {
  refreshKey: number;
  onNavigate: (tab: NavTab) => void;
}) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [recentEntries, setRecentEntries] = useState<JournalEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getDashboardSummary(), api.getJournalEntries()])
      .then(([s, entries]) => {
        setSummary(s);
        setRecentEntries(entries.slice(0, 5));
        setError(null);
      })
      .catch((err) => setError(err.message));
  }, [refreshKey]);

  if (error) {
    return <div className="rounded-xl border border-juni-red/30 bg-juni-red/5 p-4 text-sm text-juni-red">{error}</div>;
  }
  if (!summary) {
    return <div className="text-sm text-slate-500">Loading financial dashboard...</div>;
  }

  const ccy = summary.currency;
  const varianceNum = summary.ova_variance ? parseFloat(summary.ova_variance) : 0;

  const collectionsNum = parseFloat(summary.total_collections) || 0;
  const disbursementsNum = parseFloat(summary.total_disbursements) || 0;
  const refundsNum = parseFloat(summary.total_refunds) || 0;
  const availNum = parseFloat(summary.total_available_balance) || 0;
  const pendNum = parseFloat(summary.total_pending_settlement) || 0;
  const feeNum = parseFloat(summary.total_fee_revenue) || 0;

  const totalLiabilityPool = Math.max(availNum + pendNum + feeNum, 1);
  const availPct = Math.round((availNum / totalLiabilityPool) * 100);
  const pendPct = Math.round((pendNum / totalLiabilityPool) * 100);
  const feePct = Math.max(0, 100 - availPct - pendPct);

  return (
    <div className="space-y-6">
      {/* Unified 4-Stage Settlement & Custody Grid */}
      <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs font-bold uppercase tracking-wider text-juni-blue">
            Settlement &amp; Custody Lifecycle
          </h2>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-slate-500">Ledger Integrity:</span>
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                summary.is_balanced ? "bg-juni-navy text-white" : "bg-juni-red text-white"
              }`}
            >
              {summary.is_balanced ? "Debits Equal Credits" : "Imbalance Detected"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <button
            onClick={() => onNavigate("merchants")}
            className="border-t-2 border-t-juni-navy p-4 text-left hover:bg-slate-50/80 transition-colors"
          >
            <div className="font-mono text-[10px] font-semibold text-juni-navy">01 / COLLECTIONS</div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5">Customer Collections</div>
            <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
              {formatMoney(collectionsNum, ccy)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Gross customer pay-ins</div>
          </button>

          <button
            onClick={() => onNavigate("ova")}
            className="border-t-2 border-t-juni-blue p-4 text-left hover:bg-slate-50/80 transition-colors"
          >
            <div className="font-mono text-[10px] font-semibold text-juni-blue">02 / PROVIDER FLOAT</div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5">Provider Custody Float</div>
            <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
              {formatMoney(summary.ova_ledger_balance, ccy)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">Internal ledger float</div>
          </button>

          <button
            onClick={() => onNavigate("settlements")}
            className="border-t-2 border-t-blue-600 p-4 text-left hover:bg-slate-50/80 transition-colors"
          >
            <div className="font-mono text-[10px] font-semibold text-blue-700">03 / SETTLEMENT POOL</div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5">Available for Payout</div>
            <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
              {formatMoney(availNum, ccy)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              In clearing / pending: {formatMoney(pendNum, ccy)}
            </div>
          </button>

          <button
            onClick={() => onNavigate("settlements")}
            className="border-t-2 border-t-juni-red p-4 text-left hover:bg-slate-50/80 transition-colors"
          >
            <div className="font-mono text-[10px] font-semibold text-juni-red">04 / PAYOUTS</div>
            <div className="text-xs font-semibold text-slate-700 mt-0.5">Payouts &amp; Refunds</div>
            <div className="mt-1.5 text-lg font-bold text-slate-900 tabular-nums">
              {formatMoney(disbursementsNum, ccy)}
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Refunds issued: {formatMoney(refundsNum, ccy)}
            </div>
          </button>
        </div>
      </div>

      {/* Primary Fintech & Finance KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Provider & Bank Custody"
          value={formatMoney(parseFloat(summary.total_provider_ova_balances) + parseFloat(summary.total_bank_balances), ccy)}
          subtitle={`Mobile Money OVAs ${formatMoney(summary.total_provider_ova_balances, ccy)} • Banks ${formatMoney(summary.total_bank_balances, ccy)}`}
          icon={<Landmark className="h-4 w-4" />}
          tone="default"
        />
        <StatCard
          title="Merchant Payables"
          value={formatMoney(summary.total_merchant_obligations, ccy)}
          subtitle="Owed to merchants (Available + Pending)"
          icon={<ArrowUpRight className="h-4 w-4" />}
          tone="indigo"
        />
        <StatCard
          title="Net Platform Revenue"
          value={formatMoney(summary.net_psp_revenue, ccy)}
          subtitle={`Fee Revenue ${formatMoney(feeNum, ccy)} • Operating Costs ${formatMoney(summary.total_operational_expenses, ccy)}`}
          icon={<ArrowDownLeft className="h-4 w-4" />}
          tone="emerald"
        />
        <StatCard
          title="Reconciliation Variance"
          value={formatMoney(summary.ova_variance, ccy)}
          subtitle={`Net Custody Surplus: ${formatMoney(summary.ova_coverage_surplus, ccy)}`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={varianceNum === 0 && summary.open_discrepancies === 0 ? "default" : "rose"}
        />
      </div>

      {/* Liability Allocation Bar */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Custody Pool Allocation (Payables &amp; Fee Revenue)
          </h3>
          <span className="text-xs font-semibold text-juni-blue tabular-nums">
            Total Pool: {formatMoney(availNum + pendNum + feeNum, ccy)}
          </span>
        </div>
        <div className="h-2.5 w-full rounded bg-slate-100 overflow-hidden flex">
          <div className="bg-juni-blue border-r-2 border-white h-full transition-all" style={{ width: `${availPct}%` }} />
          <div className="bg-blue-500 border-r-2 border-white h-full transition-all" style={{ width: `${pendPct}%` }} />
          <div className="bg-juni-red h-full transition-all" style={{ width: `${feePct}%` }} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="border-l-4 border-l-juni-blue pl-3">
            <div className="text-[11px] font-medium text-slate-500">Available for Payout ({availPct}%)</div>
            <div className="text-sm font-bold text-slate-900 tabular-nums">{formatMoney(availNum, ccy)}</div>
          </div>
          <div className="border-l-4 border-l-blue-500 pl-3">
            <div className="text-[11px] font-medium text-slate-500">Pending Clearing ({pendPct}%)</div>
            <div className="text-sm font-bold text-slate-900 tabular-nums">{formatMoney(pendNum, ccy)}</div>
          </div>
          <div className="border-l-4 border-l-juni-red pl-3">
            <div className="text-[11px] font-medium text-slate-500">Fee Revenue ({feePct}%)</div>
            <div className="text-sm font-bold text-slate-900 tabular-nums">{formatMoney(feeNum, ccy)}</div>
          </div>
        </div>
      </div>

      {/* Attention Required + Compact Ledger Pulse */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold text-juni-blue">Attention Required</h3>
          <div className="space-y-2.5">
            {summary.open_discrepancies > 0 && (
              <button
                onClick={() => onNavigate("reconciliation")}
                className="w-full flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-juni-red bg-juni-red/5 p-3 text-left hover:bg-juni-red/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-4 w-4 text-juni-red" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      {summary.open_discrepancies} Unresolved Reconciliation Exception(s)
                    </div>
                    <div className="text-[11px] text-slate-500">Click to review & resolve</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-juni-red" />
              </button>
            )}

            {summary.pending_settlement_batches > 0 && (
              <button
                onClick={() => onNavigate("settlements")}
                className="w-full flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-blue-600 bg-blue-50/40 p-3 text-left hover:bg-blue-50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-4 w-4 text-blue-700" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      {summary.pending_settlement_batches} Settlement Batch(es) Awaiting Payout
                    </div>
                    <div className="text-[11px] text-slate-500">Ready for settlement execution</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-blue-600" />
              </button>
            )}

            {summary.pending_ussd_verifications > 0 && (
              <button
                onClick={() => onNavigate("ova")}
                className="w-full flex items-center justify-between rounded-xl border border-slate-200 border-l-4 border-l-juni-navy bg-slate-50 p-3 text-left hover:border-juni-navy transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Landmark className="h-4 w-4 text-juni-navy" />
                  <div>
                    <div className="text-xs font-semibold text-slate-900">
                      {summary.pending_ussd_verifications} USSD Collection(s) Pending Provider Confirmation
                    </div>
                    <div className="text-[11px] text-slate-500">Confirm receipt on provider portal &amp; mark verified</div>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-juni-navy" />
              </button>
            )}

            {summary.open_discrepancies === 0 && summary.pending_settlement_batches === 0 && summary.pending_ussd_verifications === 0 && (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800 text-xs">
                <CheckCircle2 className="h-4 w-4 text-juni-blue shrink-0" />
                <span>All provider accounts are reconciled and no settlement batches are pending.</span>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-juni-blue">Recent Journal Postings</h3>
            <button
              onClick={() => onNavigate("ledger")}
              className="text-xs font-medium text-juni-navy hover:text-juni-red transition-colors"
            >
              Open General Ledger →
            </button>
          </div>
          {recentEntries.length === 0 ? (
            <p className="text-xs text-slate-500 py-4">
              No journal entries posted yet. Press <kbd className="px-1.5 py-0.5 bg-slate-100 rounded">Ctrl+K</kbd> to
              load sample data or navigate.
            </p>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentEntries.map((entry) => (
                <div key={entry.id} className="py-2.5 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-juni-navy">
                        {entry.entry_number}
                      </span>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="text-xs text-slate-500 truncate">{entry.description}</p>
                  </div>
                  <div className="text-xs font-semibold tabular-nums text-slate-900 shrink-0">
                    {formatMoney(entry.total_amount, entry.currency)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
