interface StatusBadgeProps {
  status: string;
}

const styles: Record<string, string> = {
  // Tier 1: Verified / Completed (solid navy)
  POSTED: "bg-juni-navy text-white border-juni-navy",
  SETTLED: "bg-juni-navy text-white border-juni-navy",
  MATCHED: "bg-juni-navy text-white border-juni-navy",
  COMPLETED: "bg-juni-navy text-white border-juni-navy",
  RESOLVED: "bg-juni-navy text-white border-juni-navy",
  ACTIVE: "bg-juni-navy text-white border-juni-navy",
  CONFIRMED: "bg-juni-navy text-white border-juni-navy",
  SYNCED: "bg-juni-navy text-white border-juni-navy",
  APPROVED: "bg-juni-navy text-white border-juni-navy",
  // Tier 2: In-Progress / Investigating (royal blue tint)
  PROCESSING: "bg-blue-50 text-blue-700 border-blue-200",
  INVESTIGATING: "bg-blue-50 text-blue-700 border-blue-200",
  IN_TRANSIT: "bg-blue-50 text-blue-700 border-blue-200",
  INITIATED: "bg-blue-50 text-blue-700 border-blue-200",
  // Tier 3: Awaiting Action / Pending (dark slate outline)
  PENDING: "bg-slate-100 text-slate-900 border-slate-400",
  AWAITING_OVA_VERIFICATION: "bg-slate-100 text-slate-900 border-slate-400",
  PENDING_APPROVAL: "bg-slate-100 text-slate-900 border-slate-400",
  STALE: "bg-slate-100 text-slate-900 border-slate-400",
  UNMATCHED: "bg-slate-100 text-slate-900 border-slate-400",
  // Tier 4a: Critical / Alert (solid red)
  DISCREPANCY: "bg-juni-red text-white border-juni-red",
  DISCREPANCY_FOUND: "bg-juni-red text-white border-juni-red",
  OPEN: "bg-juni-red text-white border-juni-red",
  FAILED: "bg-juni-red text-white border-juni-red",
  ERROR: "bg-juni-red text-white border-juni-red",
  FLAGGED_SUSPICIOUS: "bg-juni-red text-white border-juni-red",
  // Tier 4b: Reversed / Rejected / Cancelled (red tint)
  REVERSED: "bg-juni-red/10 text-juni-red border-juni-red/30",
  REJECTED: "bg-juni-red/10 text-juni-red border-juni-red/30",
  REJECTED_MISMATCH: "bg-juni-red/10 text-juni-red border-juni-red/30",
  CANCELLED: "bg-juni-red/10 text-juni-red border-juni-red/30",
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const cls = styles[status] ?? "bg-slate-100 text-slate-900 border-slate-400";
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${cls}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}
