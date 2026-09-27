"use client";
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus, AlertTriangle, Info, ChevronRight } from "lucide-react";
import { formatMoney, formatPercent } from "@/lib/finance/money";
import type { Comparison } from "@/lib/finance/analysis";
import type { Step, Completeness } from "@/lib/finance/pnl";
import { Sheet } from "./sheet";
import { cn } from "./primitives";

/** ↑ +12.4% vs last week — colour is never the only signal (arrow + sign + words). */
export function Trend({ c, vs, higherIsBetter = true, className }: { c: Comparison | null; vs: string; higherIsBetter?: boolean; className?: string }) {
  if (!c || c.kind === "none") return <span className={cn("text-caption text-ink-3", className)}>No activity {vs} either</span>;
  if (c.kind === "new") return <span className={cn("text-caption text-ink-2", className)}>Nothing {vs} to compare</span>;
  if (c.kind === "same") return <span className={cn("text-caption text-ink-2 inline-flex items-center gap-1", className)}><Minus size={14} />Same as {vs}</span>;
  if (c.kind === "turned_profit") return <span className={cn("text-caption text-positive inline-flex items-center gap-1 font-medium", className)}><ArrowUpRight size={14} />Back to profit vs a loss {vs}</span>;
  if (c.kind === "turned_loss") return <span className={cn("text-caption text-negative inline-flex items-center gap-1 font-medium", className)}><ArrowDownRight size={14} />A loss, vs a profit {vs}</span>;
  const up = c.ratio > 0;
  const good = up === higherIsBetter;
  return (
    <span className={cn("text-caption inline-flex flex-wrap items-center gap-x-1 font-medium num", good ? "text-positive" : "text-negative", className)}>
      {up ? <ArrowUpRight size={14} aria-hidden /> : <ArrowDownRight size={14} aria-hidden />}
      {formatPercent(c.ratio, 1, true)}
      <span className="text-ink-2 font-normal whitespace-nowrap">vs {vs}</span>
    </span>
  );
}

export function StatusNote({ status, note, href }: { status: Completeness; note?: string; href?: string }) {
  if (status === "complete" || !note) return null;
  return (
    <div className={cn("flex gap-2 rounded-[10px] px-3 py-2.5 text-caption", status === "missing_data" ? "bg-warning-soft text-warning" : "bg-fill text-ink-2")}>
      <AlertTriangle size={15} className="shrink-0 mt-px" aria-hidden />
      <div className="flex-1">
        <span className="text-ink">{note}</span>
        {href && <Link href={href} className="ml-1 font-medium text-accent whitespace-nowrap underline underline-offset-2">Fix missing costs</Link>}
      </div>
    </div>
  );
}

export interface MetricCardProps {
  label: string;
  value: number | null;
  sub?: ReactNode;
  comparison?: Comparison | null;
  vs?: string;
  higherIsBetter?: boolean;
  status?: Completeness;
  explain?: string;
  steps?: Step[];
  note?: string;
  href?: string;
  size?: "hero" | "secondary";
  tone?: "default" | "profit";
}

export function MetricCard({ label, value, sub, comparison, vs = "last period", higherIsBetter = true, status = "complete", explain, steps, note, href, size = "hero", tone = "default" }: MetricCardProps) {
  const [open, setOpen] = useState(false);
  const negative = tone === "profit" && value !== null && value < 0;
  const interactive = !!steps?.length;
  return (
    <>
      <button
        type="button"
        onClick={() => interactive && setOpen(true)}
        className={cn(
          "group text-left bg-surface rounded-[16px] border border-hairline shadow-[var(--shadow-card)] w-full",
          size === "hero" ? "p-5 min-h-[148px]" : "p-4",
          interactive ? "cursor-pointer hover:border-hairline-strong transition-colors" : "cursor-default",
        )}
        aria-label={interactive ? `${label}: ${formatMoney(value)}. Show how this was calculated` : undefined}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption font-medium text-ink-2">{label}</span>
          {status !== "complete" ? (
            <span className={cn("shrink-0", status === "missing_data" ? "text-warning" : "text-ink-3")} title={note}>
              <AlertTriangle size={14} aria-hidden />
              <span className="sr-only">{status === "missing_data" ? "Incomplete: some costs are missing" : "Uses estimated costs"}</span>
            </span>
          ) : interactive ? (
            <Info size={14} className="text-ink-3 opacity-0 group-hover:opacity-100 transition-opacity" aria-hidden />
          ) : null}
        </div>
        <div
          className={cn("num font-semibold tracking-tight mt-2", size === "hero" ? "text-display-sm lg:text-[2.25rem] lg:leading-[2.5rem]" : "text-title", negative && "text-negative")}
          title={value !== null ? formatMoney(value, { exact: true }) : undefined}
        >
          {formatMoney(value, { compact: true })}
        </div>
        {sub && <div className="text-caption text-ink-2 mt-1 num">{sub}</div>}
        {comparison !== undefined && <div className="mt-2"><Trend c={comparison} vs={vs} higherIsBetter={higherIsBetter} /></div>}
      </button>

      {interactive && (
        <Sheet open={open} onClose={() => setOpen(false)} title={label} subtitle={explain}>
          <div className="flex flex-col">
            {steps!.map((s, i) => (
              <div key={i} className={cn("flex items-baseline justify-between py-3 gap-4", s.op === "=" ? "border-t border-hairline-strong font-semibold" : i > 0 && "border-t border-hairline")}>
                <span className={cn("text-body", s.op === "=" ? "text-ink" : "text-ink-2")}>{s.label}</span>
                <span className="num text-body">{s.op === "−" ? "−" : s.op === "+" ? "+" : ""}{formatMoney(s.op === "=" ? s.amount : Math.abs(s.amount), { exact: true })}</span>
              </div>
            ))}
          </div>
          {note && <div className="mt-3"><StatusNote status={status} note={note} /></div>}
          {href && (
            <Link href={href} className="mt-4 flex items-center justify-between rounded-[12px] bg-fill px-4 h-12 text-body font-medium hover:bg-fill-hover">
              View transactions <ChevronRight size={16} className="text-ink-3" />
            </Link>
          )}
        </Sheet>
      )}
    </>
  );
}
