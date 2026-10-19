"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CalendarRange } from "lucide-react";
import { cn, Button, Input, Field } from "@/components/ui/primitives";
import { Sheet } from "@/components/ui/sheet";

const OPTIONS = [
  { key: "today", label: "Today", short: "Today" },
  { key: "this_week", label: "This week", short: "Week" },
  { key: "this_month", label: "This month", short: "Month" },
  { key: "last_month", label: "Last month", short: "Last month" },
];

/** Segmented control + custom range. The period lives in the URL (shareable, back-button friendly). */
export function PeriodSelector({ value, basePath, from, to, today }: { value: string; basePath: string; from?: string; to?: string; today?: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(from ?? "");
  const [t, setT] = useState(to ?? today ?? "");
  const router = useRouter();
  const sep = basePath.includes("?") ? "&" : "?";
  return (
    <div className="flex items-center gap-2 max-w-full">
      <div role="tablist" aria-label="Period" className="inline-flex p-1 rounded-[14px] bg-fill max-w-full overflow-x-auto">
        {OPTIONS.map((o) => (
          <Link key={o.key} role="tab" aria-selected={value === o.key} href={`${basePath}${sep}period=${o.key}`} scroll={false}
            className={cn("h-9 px-3 sm:px-3.5 grid place-items-center rounded-[10px] text-caption font-medium whitespace-nowrap transition-all",
              value === o.key ? "bg-surface text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2 hover:text-ink")}>
            <span className="sm:hidden">{o.short}</span><span className="hidden sm:inline">{o.label}</span>
          </Link>
        ))}
      </div>
      <button onClick={() => setOpen(true)} aria-label="Custom date range" title="Custom dates"
        className={cn("h-9 px-2.5 rounded-[12px] grid place-items-center text-caption font-medium shrink-0",
          value === "custom" ? "bg-accent text-on-accent" : "bg-fill text-ink-2 hover:text-ink")}>
        <CalendarRange size={16} />
      </button>
      {today !== undefined && (
        <Sheet open={open} onClose={() => setOpen(false)} title="Custom dates"
          footer={<Button size="lg" className="w-full" disabled={!f || !t} onClick={() => { setOpen(false); router.push(`${basePath}${sep}period=custom&from=${f}&to=${t}`); }}>Show these dates</Button>}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From" htmlFor="pf"><Input id="pf" type="date" value={f} max={today} onChange={(e) => setF(e.target.value)} /></Field>
            <Field label="To" htmlFor="pt"><Input id="pt" type="date" value={t} max={today} onChange={(e) => setT(e.target.value)} /></Field>
          </div>
        </Sheet>
      )}
    </div>
  );
}
