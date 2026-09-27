"use client";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { Select, cn } from "@/components/ui/primitives";
import type { FilterDef } from "@/lib/reports/types";

/** Search + dropdown filters that live in the URL, so exports and shared links match what's on screen. */
export function ReportFilters({ filters, searchable }: { filters: FilterDef[]; searchable: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [pending, start] = useTransition();
  const set = (k: string, v: string) => {
    const u = new URLSearchParams(sp.toString());
    if (v) u.set(k, v); else u.delete(k);
    start(() => router.replace(`${path}?${u.toString()}`, { scroll: false }));
  };
  if (!filters.length && !searchable) return null;
  return (
    <div className={cn("flex flex-wrap gap-2 items-center print:hidden", pending && "opacity-70")}>
      {searchable && (
        <form className="relative w-full sm:w-64" onSubmit={(e) => { e.preventDefault(); set("q", q.trim()); }}>
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => set("q", q.trim())} placeholder="Search this report" aria-label="Search this report"
            className="h-10 w-full rounded-[10px] bg-fill pl-9 pr-3 text-body outline-none border border-transparent focus:border-accent focus:bg-surface" />
        </form>
      )}
      {filters.map((f) => (
        <Select key={f.key} aria-label={f.label} value={sp.get(f.key) ?? ""} onChange={(e) => set(f.key, e.target.value)} className="h-10 w-auto min-w-40 max-w-64">
          {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ))}
    </div>
  );
}

export function AsAtPicker({ value, max }: { value: string; max: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <label className="inline-flex items-center gap-2 text-caption text-ink-2 print:hidden">
      As at
      <input type="date" value={value} max={max} onChange={(e) => e.target.value && router.replace(`${path}?to=${e.target.value}`)}
        className="h-9 rounded-[10px] bg-fill px-3 text-body text-ink outline-none border border-transparent focus:border-accent" />
    </label>
  );
}
