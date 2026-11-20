import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeftRight,
  ArrowUp,
  BookOpen,
  Building2,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Search,
  ShieldCheck,
} from "lucide-react";
import { formatMoney } from "../api/client";
import type { DashboardSummary, InternalRole } from "../types/ledger";
import { CommandPalette } from "./CommandPalette";

export type NavTab =
  | "dashboard"
  | "ledger"
  | "ova"
  | "merchants"
  | "settlements"
  | "transactions"
  | "reconciliation"
  | "reports"
  | "audit";

interface LayoutProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  role: InternalRole;
  onRoleChange: (role: InternalRole) => void;
  onSeedSample: () => void;
  seeding: boolean;
  hasSampleData: boolean;
  summary: DashboardSummary | null;
  children: ReactNode;
}

const navGroups: { title: string; items: { id: NavTab; label: string; icon: ReactNode }[] }[] = [
  {
    title: "Overview",
    items: [{ id: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="h-4 w-4" /> }],
  },
  {
    title: "Accounting & Custody",
    items: [
      { id: "ledger", label: "General Ledger", icon: <BookOpen className="h-4 w-4" /> },
      { id: "ova", label: "Provider Accounts", icon: <Landmark className="h-4 w-4" /> },
      { id: "merchants", label: "Merchant Accounts", icon: <Building2 className="h-4 w-4" /> },
    ],
  },
  {
    title: "Operations & Controls",
    items: [
      { id: "settlements", label: "Settlements", icon: <ArrowLeftRight className="h-4 w-4" /> },
      { id: "transactions", label: "Transaction Monitoring", icon: <Search className="h-4 w-4" /> },
      { id: "reconciliation", label: "Reconciliation & Exceptions", icon: <CheckCircle2 className="h-4 w-4" /> },
      { id: "reports", label: "Reports & Controls", icon: <FileSpreadsheet className="h-4 w-4" /> },
      { id: "audit", label: "Audit Trail", icon: <ShieldCheck className="h-4 w-4" /> },
    ],
  },
];

const navItems = navGroups.flatMap((g) => g.items);

export function Layout({
  activeTab,
  onTabChange,
  role,
  onRoleChange,
  onSeedSample,
  seeding,
  hasSampleData,
  summary,
  children,
}: LayoutProps) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const mainRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
    setScrollProgress(0);
    setShowBackToTop(false);
  }, [activeTab]);

  const handleMainScroll = () => {
    const el = mainRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    const pct = maxScroll > 0 ? Math.min(100, Math.round((el.scrollTop / maxScroll) * 100)) : 0;
    setScrollProgress(pct);
    setShowBackToTop(el.scrollTop > 280);
  };

  const scrollToTop = () => {
    mainRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const liveCounts: Partial<Record<NavTab, number>> = {
    ova: summary?.pending_ussd_verifications ?? 0,
    settlements: summary?.pending_settlement_batches ?? 0,
    reconciliation: summary?.open_discrepancies ?? 0,
  };

  const totalCustody = summary
    ? (parseFloat(summary.total_provider_ova_balances) || 0) + (parseFloat(summary.total_bank_balances) || 0)
    : 0;
  const totalPayable = summary ? parseFloat(summary.total_merchant_obligations) || 0 : 0;
  const coverageDenom = Math.max(totalCustody, totalPayable, 1);
  const payableSharePct = Math.min(100, Math.max(0, Math.round((totalPayable / coverageDenom) * 100)));
  const surplusSharePct = Math.max(0, 100 - payableSharePct);

  return (
    <div className="h-screen overflow-hidden flex bg-slate-50 font-sans">
      <aside className="w-64 h-screen shrink-0 border-r border-juni-blue bg-juni-blue text-white flex flex-col">
        <div className="h-14 px-5 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
          <img
            src="/junipay-logo.png"
            alt="Junipay"
            className="h-7 w-auto object-contain"
          />
          <span className="border-l border-slate-200 pl-2.5 text-[10px] font-bold uppercase tracking-widest text-juni-blue">
            Ledger
          </span>
        </div>

        {summary && (
          <div className="border-b border-white/10 bg-juni-navy/40 px-4 py-3 shrink-0">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-300">Total Custody Float</div>
                <div className="mt-0.5 font-mono text-xs font-bold text-white tabular-nums">
                  {formatMoney(totalCustody, summary.currency)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-300">Merchant Payables</div>
                <div className="mt-0.5 font-mono text-xs font-bold text-white tabular-nums">
                  {formatMoney(summary.total_merchant_obligations, summary.currency)}
                </div>
              </div>
            </div>
            <div className="mt-2.5 h-1 w-full bg-white/15 overflow-hidden flex">
              <div className="bg-white h-full transition-all" style={{ width: `${payableSharePct}%` }} />
              <div className="bg-juni-red h-full transition-all" style={{ width: `${surplusSharePct}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px] text-slate-300">
              <span>Net Fee Revenue</span>
              <span className="font-mono font-semibold text-white tabular-nums">
                {formatMoney(summary.net_psp_revenue, summary.currency)}
              </span>
            </div>
            {!summary.is_balanced && (
              <div className="mt-2 bg-juni-red px-2 py-1 text-[10px] font-semibold text-white text-center">
                Trial Balance Imbalance
              </div>
            )}
          </div>
        )}

        <nav className="flex-1 p-3 space-y-3 overflow-y-auto sidebar-scroll">
          {navGroups.map((group) => (
            <div key={group.title} className="space-y-1">
              <div className="px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.title}
              </div>
              {group.items.map((item) => {
                const active = item.id === activeTab;
                const count = liveCounts[item.id] ?? 0;
                return (
                  <button
                    key={item.id}
                    onClick={() => onTabChange(item.id)}
                    className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active
                        ? "bg-juni-red text-white shadow-sm"
                        : "text-slate-200 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    <span className="flex items-center gap-3 min-w-0">
                      {item.icon}
                      <span className="truncate">{item.label}</span>
                    </span>
                    {count > 0 && (
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-mono font-bold tabular-nums ${
                          active ? "bg-white/20 text-white" : "bg-juni-red text-white"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3.5 border-t border-white/10 space-y-2.5 shrink-0">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-slate-300 mb-1">
              Internal Staff Role
            </label>
            <select
              value={role}
              onChange={(e) => onRoleChange(e.target.value as InternalRole)}
              className="w-full rounded-xl bg-white/10 border border-white/15 px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none"
            >
              <option value="OPERATIONS" className="text-slate-900">Operations Officer</option>
              <option value="FINANCE" className="text-slate-900">Finance Accountant</option>
              <option value="FINANCE_MANAGER" className="text-slate-900">Finance Manager (Approver)</option>
              <option value="MANAGEMENT" className="text-slate-900">Executive Management (View Only)</option>
              <option value="ADMIN" className="text-slate-900">System Administrator</option>
            </select>
          </div>
          <button
            onClick={onSeedSample}
            disabled={seeding || hasSampleData}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/10 hover:bg-white/20 disabled:opacity-50 px-3 py-2 text-xs font-medium text-white transition-colors"
          >
            <Database className="h-3.5 w-3.5" />
            {hasSampleData ? "Sample Data Loaded" : seeding ? "Seeding..." : "Load Sample Test Data"}
          </button>
          <p className="text-[11px] text-slate-300 leading-relaxed">
            Double-entry financial ledger. Sample dataset is for testing only.
          </p>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
        <header className="h-14 shrink-0 border-b border-slate-200 bg-white px-6 flex items-center justify-between gap-4 relative">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-medium text-slate-400">Finance &amp; Operations</span>
            <span className="text-slate-300">/</span>
            <h1 className="text-sm font-semibold text-juni-blue truncate">
              {navItems.find((n) => n.id === activeTab)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 text-slate-500 transition-colors"
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Quick jump...</span>
              <kbd className="rounded bg-white border border-slate-200 px-1.5 py-0.5 text-[10px] font-mono text-slate-500">
                Ctrl+K
              </kbd>
            </button>

            {hasSampleData && (
              <span className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                Sample Dataset
              </span>
            )}
          </div>

          <div
            className="absolute bottom-0 left-0 h-[2px] bg-juni-red transition-[width] duration-150"
            style={{ width: `${scrollProgress}%` }}
          />
        </header>

        <main ref={mainRef} onScroll={handleMainScroll} className="flex-1 p-6 overflow-y-auto">
          {children}
        </main>

        {showBackToTop && (
          <button
            onClick={scrollToTop}
            aria-label="Back to top"
            className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-1.5 rounded-full bg-juni-blue hover:bg-juni-red text-white px-3.5 py-2 text-xs font-medium shadow-lg transition-colors"
          >
            <ArrowUp className="h-3.5 w-3.5" />
            Top
          </button>
        )}
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onNavigate={onTabChange}
        onSeedSample={onSeedSample}
        hasSampleData={hasSampleData}
      />
    </div>
  );
}
