import type { ReactNode } from "react";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: ReactNode;
  tone?: "default" | "emerald" | "amber" | "rose" | "indigo";
}

const topRule: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-juni-blue",
  indigo: "bg-slate-900",
  emerald: "bg-juni-navy",
  amber: "bg-blue-600",
  rose: "bg-juni-red",
};

export function StatCard({ title, value, subtitle, icon, tone = "default" }: StatCardProps) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col justify-between">
      <div className={`h-1 w-full ${topRule[tone]}`} />
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{title}</span>
            {icon && <span className="text-slate-400">{icon}</span>}
          </div>
          <div className="mt-1.5 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</div>
        </div>
        {subtitle && (
          <div className="mt-3 pt-2 border-t border-slate-100 text-[11px] font-medium text-slate-600">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
