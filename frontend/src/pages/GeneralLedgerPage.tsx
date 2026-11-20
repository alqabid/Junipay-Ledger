import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Download, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { api, formatMoney } from "../api/client";
import { StatusBadge } from "../components/StatusBadge";
import type { AccountBalance, JournalEntry } from "../types/ledger";

type LedgerSummary = Awaited<ReturnType<typeof api.getLedgerSummary>>;

interface DraftLine {
  account_id: string;
  direction: "DEBIT" | "CREDIT";
  amount: string;
  line_memo: string;
}

type DrillDownData = Awaited<ReturnType<typeof api.getAccountTransactions>>;

const CATEGORY_ORDER: AccountBalance["account_type"][] = [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
];

const CATEGORY_LABELS: Record<AccountBalance["account_type"], string> = {
  ASSET: "Assets (Provider Float & Bank Custody)",
  LIABILITY: "Liabilities (Merchant Payables & Clearing)",
  EQUITY: "Equity (Shareholder & Capital)",
  REVENUE: "Revenue (Transaction & Platform Fees)",
  EXPENSE: "Expenses (Partner Fees & Operating Costs)",
};

const CATEGORY_ACCENTS: Record<AccountBalance["account_type"], string> = {
  ASSET: "border-l-4 border-l-juni-blue",
  LIABILITY: "border-l-4 border-l-slate-900",
  EQUITY: "border-l-4 border-l-slate-500",
  REVENUE: "border-l-4 border-l-juni-navy",
  EXPENSE: "border-l-4 border-l-juni-red",
};

export function GeneralLedgerPage({ refreshKey }: { refreshKey: number }) {
  const [accounts, setAccounts] = useState<AccountBalance[]>([]);
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [filterType, setFilterType] = useState<string>("");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Account Drill-Down state
  const [drillDown, setDrillDown] = useState<DrillDownData | null>(null);
  const [ledgerView, setLedgerView] = useState<"coa" | "journals">("coa");
  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});

  // New Account modal state
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [accCode, setAccCode] = useState("");
  const [accName, setAccName] = useState("");
  const [accType, setAccType] = useState<AccountBalance["account_type"]>("EXPENSE");
  const [accCategory, setAccCategory] = useState("GENERAL");

  // Double-entry modal state
  const [showBuilder, setShowBuilder] = useState(false);
  const [eventType, setEventType] = useState("ADJUSTMENT");
  const [description, setDescription] = useState("");
  const [extRef, setExtRef] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([
    { account_id: "", direction: "DEBIT", amount: "", line_memo: "" },
    { account_id: "", direction: "CREDIT", amount: "", line_memo: "" },
  ]);
  const [submitting, setSubmitting] = useState(false);

  const load = () => {
    Promise.all([api.getAccounts(), api.getJournalEntries(filterType || undefined), api.getLedgerSummary()])
      .then(([accs, ents, sum]) => {
        setAccounts(accs);
        setEntries(ents);
        setLedgerSummary(sum);
        setError(null);
      })
      .catch((e) => setError(e.message));
  };

  useEffect(() => {
    load();
  }, [refreshKey, filterType]);

  const openDrillDown = async (accountId: string) => {
    try {
      const data = await api.getAccountTransactions(accountId);
      setDrillDown(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load account drill-down");
    }
  };

  const handleReverse = async (entryId: string) => {
    const reason = window.prompt("Enter reversal reason (immutable counter-entry will be posted):");
    if (!reason || reason.trim().length < 3) return;
    setBusyId(entryId);
    try {
      await api.reverseEntry(entryId, reason.trim());
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to reverse entry");
    } finally {
      setBusyId(null);
    }
  };

  const debitTotal = lines
    .filter((l) => l.direction === "DEBIT")
    .reduce((acc, l) => acc + (parseFloat(l.amount) || 0), 0);
  const creditTotal = lines
    .filter((l) => l.direction === "CREDIT")
    .reduce((acc, l) => acc + (parseFloat(l.amount) || 0), 0);
  const diff = Math.abs(debitTotal - creditTotal);
  const isBalanced = debitTotal > 0 && diff < 0.0001;

  const handleCreateEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (!isBalanced) return;
    setSubmitting(true);
    try {
      await api.createJournalEntry({
        idempotency_key: `ui-jrn-${Date.now()}`,
        external_reference: extRef || undefined,
        event_type: eventType,
        description,
        currency: "GHS",
        created_by: "FINANCE_ADMIN_UI",
        lines: lines.map((l) => ({
          account_id: l.account_id,
          direction: l.direction,
          amount: l.amount,
          line_memo: l.line_memo || undefined,
        })),
      });
      setShowBuilder(false);
      setDescription("");
      setExtRef("");
      setLines([
        { account_id: "", direction: "DEBIT", amount: "", line_memo: "" },
        { account_id: "", direction: "CREDIT", amount: "", line_memo: "" },
      ]);
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to post journal entry");
    } finally {
      setSubmitting(false);
    }
  };

  const filteredEntries = entries.filter((e) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      e.entry_number.toLowerCase().includes(q) ||
      (e.external_reference ?? "").toLowerCase().includes(q) ||
      e.description.toLowerCase().includes(q)
    );
  });

  const exportCsv = () => {
    const header = "Entry Number,Event Type,External Ref,Description,Currency,Amount,Status,Posted At\n";
    const rows = filteredEntries
      .map((e) =>
        [
          e.entry_number,
          e.event_type,
          e.external_reference ?? "",
          `"${e.description.replace(/"/g, '""')}"`,
          e.currency,
          e.total_amount,
          e.status,
          e.posted_at,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `junipay-journal-entries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCreateAccount = async (e: FormEvent) => {
    e.preventDefault();
    const normal = accType === "ASSET" || accType === "EXPENSE" ? "DEBIT" : "CREDIT";
    try {
      await api.createAccount({
        code: accCode.trim(),
        name: accName.trim(),
        account_type: accType,
        normal_balance: normal,
        category: accCategory.trim().toUpperCase(),
        currency: "GHS",
      });
      setShowAddAccount(false);
      setAccCode("");
      setAccName("");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create GL account");
    }
  };

  const applyTemplate = (tpl: "PARTNER_FEE" | "SUSPENSE_CLEAR" | "OPEX") => {
    const findId = (code: string) => accounts.find((a) => a.code === code)?.id ?? "";
    if (tpl === "PARTNER_FEE") {
      setEventType("FEE_ADJUSTMENT");
      setDescription("Partner processing charge adjustment");
      setLines([
        { account_id: findId("5000"), direction: "DEBIT", amount: "", line_memo: "Partner fee" },
        { account_id: findId("1010"), direction: "CREDIT", amount: "", line_memo: "OVA deduction" },
      ]);
    } else if (tpl === "SUSPENSE_CLEAR") {
      setEventType("CLEARING");
      setDescription("Clear reconciliation suspense item");
      setLines([
        { account_id: findId("2900"), direction: "DEBIT", amount: "", line_memo: "Clear suspense" },
        { account_id: findId("1010"), direction: "CREDIT", amount: "", line_memo: "OVA offset" },
      ]);
    } else if (tpl === "OPEX") {
      setEventType("EXPENSE");
      setDescription("Operational expense posting");
      setLines([
        { account_id: findId("5100"), direction: "DEBIT", amount: "", line_memo: "Operational expense" },
        { account_id: findId("1010"), direction: "CREDIT", amount: "", line_memo: "Funding source" },
      ]);
    }
  };

  const exportAccountStatementCsv = () => {
    if (!drillDown) return;
    const header = "Date,Entry #,External Ref,Description,Direction,Amount,Running Balance,Currency\n";
    const rows = drillDown.transactions
      .map((t) =>
        [
          t.occurred_at,
          t.entry_number,
          t.external_reference ?? "",
          `"${t.description.replace(/"/g, '""')}"`,
          t.direction,
          t.amount,
          t.running_balance,
          t.currency,
        ].join(",")
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `junipay-account-${drillDown.account.code}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Rolled-up non-posting control totals (never double-counted)
  const ovaAssets = accounts.filter((a) => a.account_type === "ASSET" && a.category === "OVA_MIRROR");
  const ovaControlBalance = ovaAssets.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
  const merchantLiab = accounts.filter(
    (a) => a.category === "MERCHANT_AVAILABLE" || a.category === "MERCHANT_PENDING"
  );
  const merchantControlBalance = merchantLiab.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-xl border border-juni-red/30 bg-juni-red/5 p-3 text-sm text-juni-red">{error}</div>
      )}

      {/* Balance Sheet & Trial Balance Grid */}
      {ledgerSummary && ledgerSummary.currencies.map((c) => (
        <div
          key={c.currency}
          className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden grid grid-cols-2 lg:grid-cols-5 divide-y lg:divide-y-0 lg:divide-x divide-slate-200"
        >
          <div className="border-t-2 border-t-juni-blue p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total Assets ({c.currency})
            </div>
            <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
              {formatMoney(c.assets, c.currency)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Provider Float &amp; Bank Custody</div>
          </div>

          <div className="border-t-2 border-t-slate-900 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total Liabilities
            </div>
            <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
              {formatMoney(c.liabilities, c.currency)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Merchant Payables &amp; Clearing</div>
          </div>

          <div className="border-t-2 border-t-slate-400 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Equity
            </div>
            <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
              {formatMoney(c.equity, c.currency)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Capital Accounts</div>
          </div>

          <div className="border-t-2 border-t-juni-navy p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Net Income
            </div>
            <div className="mt-1 text-base font-bold text-slate-900 tabular-nums">
              {formatMoney(c.net_income, c.currency)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500">Fee Revenue Less Expenses</div>
          </div>

          <div
            className={`col-span-2 lg:col-span-1 border-t-2 ${
              c.is_trial_balanced ? "border-t-juni-blue" : "border-t-juni-red"
            } p-3.5 bg-slate-50/60`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Trial Balance
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                  c.is_trial_balanced ? "bg-juni-navy text-white" : "bg-juni-red text-white"
                }`}
              >
                {c.is_trial_balanced ? "BALANCED" : "UNBALANCED"}
              </span>
            </div>
            <div className="mt-1 font-mono text-xs font-bold text-slate-900 tabular-nums">
              Debits {formatMoney(c.total_debits, c.currency)}
            </div>
            <div className="mt-0.5 font-mono text-xs font-semibold text-slate-600 tabular-nums">
              Credits {formatMoney(c.total_credits, c.currency)}
            </div>
          </div>
        </div>
      ))}

      {/* View Switcher: Chart of Accounts vs Journal Entries */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <button
            onClick={() => setLedgerView("coa")}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
              ledgerView === "coa" ? "bg-juni-blue text-white" : "text-slate-600 hover:text-juni-blue"
            }`}
          >
            Chart of Accounts ({accounts.length})
          </button>
          <button
            onClick={() => setLedgerView("journals")}
            className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-colors ${
              ledgerView === "journals" ? "bg-juni-blue text-white" : "text-slate-600 hover:text-juni-blue"
            }`}
          >
            Journal Entries ({entries.length})
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddAccount(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-juni-blue bg-white text-juni-blue hover:bg-slate-50 px-3 py-2 text-xs font-medium transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Account
          </button>
          <button
            onClick={() => setShowBuilder(true)}
            className="inline-flex items-center gap-1.5 rounded-xl bg-juni-red hover:bg-juni-red-hover px-3.5 py-2 text-xs font-medium text-white transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            New Journal Entry
          </button>
        </div>
      </div>

      {/* Categorized Chart of Accounts (Aligned table-fixed columns & collapsible groups) */}
      {ledgerView === "coa" && (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-juni-blue">Chart of Accounts (Click any account to drill down)</h2>
            <p className="text-xs text-slate-500">
              Grouped by Assets, Liabilities, Equity, Revenue &amp; Expenses. Control accounts summarize child accounts and do not accept direct postings.
            </p>
          </div>
        </div>

        <div className="divide-y divide-slate-200">
          {CATEGORY_ORDER.map((cat) => {
            const catAccounts = accounts.filter((a) => a.account_type === cat);
            const catTotal = catAccounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
            if (catAccounts.length === 0) return null;
            const isCollapsed = !!collapsedCats[cat];

            return (
              <div key={cat}>
                <button
                  type="button"
                  onClick={() => setCollapsedCats((prev) => ({ ...prev, [cat]: !prev[cat] }))}
                  className={`w-full bg-slate-50 hover:bg-slate-100/80 px-5 py-2.5 flex items-center justify-between border-b border-slate-200 text-left transition-colors ${CATEGORY_ACCENTS[cat]}`}
                >
                  <span className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-juni-blue">
                    {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {CATEGORY_LABELS[cat]}
                    <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
                      {catAccounts.length}
                    </span>
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-slate-700">
                    Section Total: {formatMoney(catTotal, "GHS")}
                  </span>
                </button>
                {!isCollapsed && (
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-28" />
                    <col />
                    <col className="w-56" />
                    <col className="w-40" />
                    <col className="w-10" />
                  </colgroup>
                  <tbody className="divide-y divide-slate-100">
                    {cat === "ASSET" && ovaAssets.length > 0 && (
                      <tr className="bg-juni-blue/5 border-l-2 border-l-juni-blue">
                        <td className="px-4 py-2 font-mono text-xs font-semibold text-juni-blue">1000</td>
                        <td className="px-4 py-2 font-semibold text-juni-blue truncate">
                          Provider Float Control Account
                          <span className="ml-2 rounded bg-juni-blue/10 px-1.5 py-0.5 text-[10px] font-medium text-juni-blue">
                            CONTROL SUMMARY
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-400">Sum of {ovaAssets.length} float account(s)</td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums text-juni-blue">
                          {formatMoney(ovaControlBalance, "GHS")}
                        </td>
                        <td></td>
                      </tr>
                    )}
                    {cat === "LIABILITY" && merchantLiab.length > 0 && (
                      <tr className="bg-slate-100/80 border-l-2 border-l-slate-900">
                        <td className="px-4 py-2 font-mono text-xs font-semibold text-slate-900">2000</td>
                        <td className="px-4 py-2 font-semibold text-slate-900 truncate">
                          Merchant Payables Control Account
                          <span className="ml-2 rounded bg-slate-900/10 px-1.5 py-0.5 text-[10px] font-medium text-slate-900">
                            CONTROL SUMMARY
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-xs text-slate-400">Sum of {merchantLiab.length} merchant balances</td>
                        <td className="px-4 py-2 text-right font-bold tabular-nums text-slate-900">
                          {formatMoney(merchantControlBalance, "GHS")}
                        </td>
                        <td></td>
                      </tr>
                    )}
                    {catAccounts.map((acc) => (
                      <tr
                        key={acc.id}
                        onClick={() => openDrillDown(acc.id)}
                        className="hover:bg-slate-50 cursor-pointer transition-colors group"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-600 truncate">{acc.code}</td>
                        <td className="px-4 py-2.5 font-medium text-slate-800 group-hover:text-juni-red truncate">
                          {acc.name}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-xs text-slate-500">
                          Debits {formatMoney(acc.debit_total, acc.currency)} / Credits {formatMoney(acc.credit_total, acc.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                          {formatMoney(acc.balance, acc.currency)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-300 group-hover:text-juni-red">
                          <ChevronRight className="h-4 w-4" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Journal Entries */}
      {ledgerView === "journals" && (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-juni-blue">Journal Entries (Double-Entry)</h2>
            <p className="text-xs text-slate-500">Click an entry to inspect debit/credit legs</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              placeholder="Search entry # or ref..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-1.5 text-xs w-48 focus:outline-none focus:border-juni-blue"
            />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              <option value="">All Event Types</option>
              <option value="COLLECTION">COLLECTION</option>
              <option value="SETTLEMENT">SETTLEMENT</option>
              <option value="DISBURSEMENT">DISBURSEMENT</option>
              <option value="LIQUIDATION">LIQUIDATION</option>
              <option value="REFUND">REFUND</option>
              <option value="REVERSAL">REVERSAL</option>
              <option value="ADJUSTMENT">ADJUSTMENT</option>
            </select>
            <button
              onClick={exportCsv}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700"
            >
              <Download className="h-3.5 w-3.5" />
              Export CSV
            </button>
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filteredEntries.map((entry) => {
            const expanded = expandedId === entry.id;
            return (
              <div key={entry.id} className="p-4 hover:bg-slate-50/60">
                <div
                  className="flex flex-wrap items-center justify-between gap-3 cursor-pointer"
                  onClick={() => setExpandedId(expanded ? null : entry.id)}
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-juni-navy">
                        {entry.entry_number}
                      </span>
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {entry.event_type}
                      </span>
                      <StatusBadge status={entry.status} />
                    </div>
                    <p className="text-sm text-slate-700">{entry.description}</p>
                    <p className="text-xs text-slate-400">
                      Ref: {entry.external_reference ?? "—"} • Idempotency: {entry.idempotency_key}
                    </p>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold tabular-nums text-slate-900">
                      {formatMoney(entry.total_amount, entry.currency)}
                    </span>
                    {entry.status === "POSTED" && !entry.reverses_entry_id && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReverse(entry.id);
                        }}
                        disabled={busyId === entry.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-juni-red/30 bg-white px-2.5 py-1 text-xs font-medium text-juni-red hover:bg-juni-red hover:text-white disabled:opacity-50 transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                        Reverse
                      </button>
                    )}
                  </div>
                </div>

                {expanded && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                    <table className="w-full text-xs text-left">
                      <thead className="bg-slate-100 text-slate-500 uppercase">
                        <tr>
                          <th className="px-3 py-2">Account</th>
                          <th className="px-3 py-2">Memo</th>
                          <th className="px-3 py-2 text-right">Debit</th>
                          <th className="px-3 py-2 text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {entry.lines.map((line) => (
                          <tr key={line.id}>
                            <td className="px-3 py-2 font-medium text-slate-800">
                              <span className="font-mono text-slate-500 mr-2">{line.account_code}</span>
                              {line.account_name}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{line.line_memo ?? "—"}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                              {line.direction === "DEBIT" ? formatMoney(line.amount, line.currency) : "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-slate-800">
                              {line.direction === "CREDIT" ? formatMoney(line.amount, line.currency) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {/* Account Drill-Down Modal */}
      {drillDown && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setDrillDown(null)}>
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-juni-blue text-white">
              <div>
                <div className="text-xs font-mono text-slate-300">
                  {drillDown.account.code} • {drillDown.account.account_type} ({drillDown.account.normal_balance})
                </div>
                <h3 className="text-base font-semibold">{drillDown.account.name}</h3>
              </div>
              <button onClick={() => setDrillDown(null)} className="text-slate-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4 p-4 bg-slate-50 border-b border-slate-200 text-xs items-center">
              <div>
                <span className="text-slate-500">Total Debits</span>
                <div className="text-sm font-semibold tabular-nums">{formatMoney(drillDown.account.debit_total, drillDown.account.currency)}</div>
              </div>
              <div>
                <span className="text-slate-500">Total Credits</span>
                <div className="text-sm font-semibold tabular-nums">{formatMoney(drillDown.account.credit_total, drillDown.account.currency)}</div>
              </div>
              <div>
                <span className="text-slate-500">Current Balance</span>
                <div className="text-sm font-bold tabular-nums text-juni-blue">{formatMoney(drillDown.account.balance, drillDown.account.currency)}</div>
              </div>
              <div className="text-right">
                <button
                  onClick={exportAccountStatementCsv}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Statement
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase border-b border-slate-200 sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5">Date</th>
                    <th className="px-4 py-2.5">Entry / Ref</th>
                    <th className="px-4 py-2.5">Description</th>
                    <th className="px-4 py-2.5">Direction</th>
                    <th className="px-4 py-2.5 text-right">Amount</th>
                    <th className="px-4 py-2.5 text-right">Running Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {drillDown.transactions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                        No transactions posted to this account yet.
                      </td>
                    </tr>
                  ) : (
                    drillDown.transactions.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                          {new Date(t.occurred_at).toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-juni-navy">
                          {t.entry_number}
                          {t.external_reference && <div className="text-[10px] text-slate-400">{t.external_reference}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-slate-700">{t.description}</td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                              t.direction === "DEBIT"
                                ? "bg-juni-blue/10 text-juni-blue"
                                : "bg-juni-red/10 text-juni-red"
                            }`}
                          >
                            {t.direction}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(t.amount, t.currency)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                          {formatMoney(t.running_balance, t.currency)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Double-Entry Journal Builder Modal */}
      {showBuilder && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-3xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-juni-blue text-white">
              <div>
                <h3 className="text-sm font-semibold">Double-Entry Journal Builder</h3>
                <p className="text-xs text-slate-300">Debits must equal Credits before posting</p>
              </div>
              <button onClick={() => setShowBuilder(false)} className="text-slate-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateEntry} className="p-5 space-y-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">Quick Templates:</span>
                <button type="button" onClick={() => applyTemplate("PARTNER_FEE")} className="rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-slate-700">
                  Partner Charge
                </button>
                <button type="button" onClick={() => applyTemplate("SUSPENSE_CLEAR")} className="rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-slate-700">
                  Clear Suspense
                </button>
                <button type="button" onClick={() => applyTemplate("OPEX")} className="rounded-lg bg-slate-100 hover:bg-slate-200 px-2.5 py-1 text-slate-700">
                  Operational Expense
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <select
                  value={eventType}
                  onChange={(e) => setEventType(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="ADJUSTMENT">ADJUSTMENT</option>
                  <option value="FEE_ADJUSTMENT">FEE_ADJUSTMENT</option>
                  <option value="CLEARING">CLEARING</option>
                </select>
                <input
                  placeholder="External Reference (optional)"
                  value={extRef}
                  onChange={(e) => setExtRef(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  required
                  placeholder="Description / Narration"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                />
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      required
                      value={line.account_id}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].account_id = e.target.value;
                        setLines(next);
                      }}
                      className="col-span-5 rounded-xl border border-slate-300 px-2.5 py-2 text-xs"
                    >
                      <option value="">Select Account...</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.name}
                        </option>
                      ))}
                    </select>
                    <select
                      value={line.direction}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].direction = e.target.value as "DEBIT" | "CREDIT";
                        setLines(next);
                      }}
                      className="col-span-2 rounded-xl border border-slate-300 px-2 py-2 text-xs font-medium"
                    >
                      <option value="DEBIT">DEBIT</option>
                      <option value="CREDIT">CREDIT</option>
                    </select>
                    <input
                      required
                      type="number"
                      step="0.01"
                      min="0.01"
                      placeholder="Amount"
                      value={line.amount}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].amount = e.target.value;
                        setLines(next);
                      }}
                      className="col-span-2 rounded-xl border border-slate-300 px-2.5 py-2 text-xs tabular-nums"
                    />
                    <input
                      placeholder="Line memo"
                      value={line.line_memo}
                      onChange={(e) => {
                        const next = [...lines];
                        next[idx].line_memo = e.target.value;
                        setLines(next);
                      }}
                      className="col-span-2 rounded-xl border border-slate-300 px-2.5 py-2 text-xs"
                    />
                    <button
                      type="button"
                      disabled={lines.length <= 2}
                      onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                      className="col-span-1 flex justify-center text-slate-400 hover:text-juni-red disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() =>
                    setLines([...lines, { account_id: "", direction: "DEBIT", amount: "", line_memo: "" }])
                  }
                  className="text-xs font-medium text-juni-navy hover:text-juni-red"
                >
                  + Add Journal Line
                </button>
                <div className="flex items-center gap-4 text-xs">
                  <span>DR: {formatMoney(debitTotal, "GHS")}</span>
                  <span>CR: {formatMoney(creditTotal, "GHS")}</span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 font-semibold ${
                      isBalanced ? "bg-juni-blue text-white" : "bg-juni-red/10 text-juni-red"
                    }`}
                  >
                    {isBalanced ? "BALANCED" : `Diff: ${formatMoney(diff, "GHS")}`}
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBuilder(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!isBalanced || submitting}
                  className="rounded-xl bg-juni-red hover:bg-juni-red-hover disabled:opacity-40 px-4 py-2 text-xs font-medium text-white"
                >
                  {submitting ? "Posting..." : "Post Balanced Entry"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* New GL Account Modal */}
      {showAddAccount && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-juni-blue text-white">
              <h3 className="text-sm font-semibold">Create General Ledger Account</h3>
              <button onClick={() => setShowAddAccount(false)} className="text-slate-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={handleCreateAccount} className="p-5 space-y-3">
              <input
                required
                placeholder="Account Code (e.g. 5200)"
                value={accCode}
                onChange={(e) => setAccCode(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <input
                required
                placeholder="Account Name (e.g. Bank Transfer Charges)"
                value={accName}
                onChange={(e) => setAccName(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={accType}
                onChange={(e) => setAccType(e.target.value as AccountBalance["account_type"])}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="ASSET">ASSET (Debit Normal)</option>
                <option value="LIABILITY">LIABILITY (Credit Normal)</option>
                <option value="EQUITY">EQUITY (Credit Normal)</option>
                <option value="REVENUE">REVENUE (Credit Normal)</option>
                <option value="EXPENSE">EXPENSE (Debit Normal)</option>
              </select>
              <input
                required
                placeholder="Category (e.g. BANK_CHARGES)"
                value={accCategory}
                onChange={(e) => setAccCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddAccount(false)}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-juni-red hover:bg-juni-red-hover px-4 py-2 text-xs font-medium text-white"
                >
                  Create Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
