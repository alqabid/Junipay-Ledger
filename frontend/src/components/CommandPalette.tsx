import { useEffect, useState } from "react";
import {
  ArrowLeftRight,
  BookOpen,
  Building2,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Landmark,
  LayoutDashboard,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import type { NavTab } from "./Layout";

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (tab: NavTab) => void;
  onSeedSample: () => void;
  hasSampleData: boolean;
}

interface CommandItem {
  id: string;
  label: string;
  hint: string;
  group: "Navigate" | "Actions";
  icon: JSX.Element;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  onNavigate,
  onSeedSample,
  hasSampleData,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  if (!open) return null;

  const items: CommandItem[] = [
    {
      id: "nav-dashboard",
      label: "Dashboard",
      hint: "Custody float, merchant payables & operational alerts",
      group: "Navigate",
      icon: <LayoutDashboard className="h-4 w-4" />,
      run: () => onNavigate("dashboard"),
    },
    {
      id: "nav-ledger",
      label: "General Ledger & Journal Builder",
      hint: "Chart of accounts, double-entry postings & reversals",
      group: "Navigate",
      icon: <BookOpen className="h-4 w-4" />,
      run: () => onNavigate("ledger"),
    },
    {
      id: "nav-ova",
      label: "Provider Accounts",
      hint: "MTN, Telecel, AT Money, bank custody & USSD verification",
      group: "Navigate",
      icon: <Landmark className="h-4 w-4" />,
      run: () => onNavigate("ova"),
    },
    {
      id: "nav-merchants",
      label: "Merchant Accounts",
      hint: "Merchants, sub-merchants & available/pending balances",
      group: "Navigate",
      icon: <Building2 className="h-4 w-4" />,
      run: () => onNavigate("merchants"),
    },
    {
      id: "nav-settlements",
      label: "Settlements",
      hint: "Pending batches & settlement execution",
      group: "Navigate",
      icon: <ArrowLeftRight className="h-4 w-4" />,
      run: () => onNavigate("settlements"),
    },
    {
      id: "nav-transactions",
      label: "Transaction Monitoring",
      hint: "Searchable transactions, payment channels & lifecycle",
      group: "Navigate",
      icon: <Search className="h-4 w-4" />,
      run: () => onNavigate("transactions"),
    },
    {
      id: "nav-recon",
      label: "Reconciliation & Exceptions",
      hint: "Match provider statements & resolve discrepancies",
      group: "Navigate",
      icon: <CheckCircle2 className="h-4 w-4" />,
      run: () => onNavigate("reconciliation"),
    },
    {
      id: "nav-reports",
      label: "Reports & Controls",
      hint: "Trial balance, daily close, operating expenses & approvals",
      group: "Navigate",
      icon: <FileSpreadsheet className="h-4 w-4" />,
      run: () => onNavigate("reports"),
    },
    {
      id: "nav-audit",
      label: "Audit Trail",
      hint: "Immutable activity log",
      group: "Navigate",
      icon: <ShieldCheck className="h-4 w-4" />,
      run: () => onNavigate("audit"),
    },
  ];

  if (!hasSampleData) {
    items.push({
      id: "act-seed",
      label: "Load Sample Test Data",
      hint: "Populate sample merchants, collections & provider float entries",
      group: "Actions",
      icon: <Database className="h-4 w-4" />,
      run: () => onSeedSample(),
    });
  }

  const filtered = items.filter((item) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return item.label.toLowerCase().includes(q) || item.hint.toLowerCase().includes(q);
  });

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-start justify-center pt-20 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200">
          <Search className="h-4 w-4 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to module or action..."
            className="flex-1 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none"
          />
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">No matching commands.</div>
          ) : (
            filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => {
                  item.run();
                  onClose();
                }}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <span className="text-juni-navy group-hover:text-juni-red transition-colors">
                    {item.icon}
                  </span>
                  <div>
                    <div className="text-sm font-medium text-slate-800">{item.label}</div>
                    <div className="text-xs text-slate-400">{item.hint}</div>
                  </div>
                </div>
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                  {item.group}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
