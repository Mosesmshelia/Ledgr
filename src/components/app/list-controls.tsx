"use client";
// One toolbar for every list: search, quick filters, date range and sort. All state lives in the URL.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowDownUp, CalendarRange, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/components/ui/primitives";

/** The first filter shows as chips; any others show as compact dropdowns ("All …"). */
export interface FilterDef { param: string; label: string; options: { value: string; label: string }[]; allLabel?: string }

function useUrl() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const set = (patch: Record<string, string | undefined>) => {
    const u = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) (v ? u.set(k, v) : u.delete(k));
    if (!("page" in patch)) u.delete("page"); // any change goes back to page 1
    const s = u.toString();
    start(() => router.replace(`${path}${s ? "?" + s : ""}`, { scroll: false }));
  };
  return { sp, set, pending };
}

export function ListControls({ search, filters = [], sorts = [], dates = true, keep = [], defaultSort = "Newest first" }: {
  search?: string; filters?: FilterDef[]; sorts?: { value: string; label: string }[]; dates?: boolean; defaultSort?: string;
  /** Params that belong to the page (e.g. tab) and must survive "Clear". */
  keep?: string[];
}) {
  const { sp, set, pending } = useUrl();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [showDates, setShowDates] = useState(!!(sp.get("from") || sp.get("to")));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { setQ(sp.get("q") ?? ""); }, [sp]);
  const onSearch = (v: string) => {
    setQ(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => set({ q: v.trim() || undefined }), 350);
  };
  const active = ["q", "from", "to", ...filters.map((f) => f.param)].filter((k) => !keep.includes(k)).some((k) => sp.get(k));
  const sortVal = `${sp.get("sort") ?? ""}:${sp.get("dir") ?? ""}`;

  return (
    <div className={cn("flex flex-col gap-2.5 mb-4 transition-opacity print:hidden", pending && "opacity-70")} aria-busy={pending}>
      <div className="flex flex-wrap gap-2 items-center">
        {search && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
            <input type="search" value={q} onChange={(e) => onSearch(e.target.value)} placeholder={search} aria-label={search}
              onKeyDown={(e) => { if (e.key === "Enter") { if (timer.current) clearTimeout(timer.current); set({ q: q.trim() || undefined }); } }}
              className="h-10 w-full rounded-[10px] bg-fill pl-9 pr-3 text-body outline-none border border-transparent focus:border-accent focus:bg-surface" />
          </div>
        )}
        {dates && (
          <button type="button" onClick={() => setShowDates(!showDates)} aria-expanded={showDates}
            className={cn("h-10 px-3.5 rounded-[10px] inline-flex items-center gap-2 text-body border", showDates || sp.get("from") || sp.get("to") ? "bg-accent-soft text-accent border-transparent" : "bg-fill border-transparent text-ink-2 hover:text-ink")}>
            <CalendarRange size={16} aria-hidden />Dates
          </button>
        )}
        {filters.slice(1).map((f) => (
          <label key={f.param} className="relative inline-flex items-center">
            <span className="sr-only">{f.label}</span>
            <select value={sp.get(f.param) ?? ""} onChange={(e) => set({ [f.param]: e.target.value || undefined })}
              className={cn("h-10 max-w-[200px] rounded-[10px] px-3 text-body outline-none border border-transparent focus:border-accent appearance-none truncate",
                sp.get(f.param) ? "bg-accent-soft text-accent" : "bg-fill text-ink")}>
              <option value="">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {sorts.length > 0 && (
          <label className="relative inline-flex items-center">
            <span className="sr-only">Sort by</span>
            <ArrowDownUp size={15} className="absolute left-3 text-ink-2 pointer-events-none" aria-hidden />
            <select value={sortVal === ":" ? "" : sortVal} onChange={(e) => { const [s, d] = e.target.value.split(":"); set({ sort: s || undefined, dir: d || undefined }); }}
              className="h-10 rounded-[10px] bg-fill pl-9 pr-3 text-body text-ink outline-none border border-transparent focus:border-accent appearance-none">
              <option value="">{defaultSort}</option>
              {sorts.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
        )}
        {active && (
          <button type="button" onClick={() => { setQ(""); set(Object.fromEntries(["q", "from", "to", "sort", "dir", ...filters.map((f) => f.param)].filter((k) => !keep.includes(k)).map((k) => [k, undefined]))); setShowDates(false); }}
            className="tap h-10 px-2 text-caption text-accent font-medium inline-flex items-center gap-1"><X size={14} aria-hidden />Clear</button>
        )}
      </div>
      {showDates && <DateRange from={sp.get("from") ?? ""} to={sp.get("to") ?? ""} onChange={(from, to) => set({ from: from || undefined, to: to || undefined })} />}
      {filters.slice(0, 1).map((f) => (
        <div key={f.param} role="group" aria-label={f.label} className="flex gap-1.5 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0 no-scrollbar">
          {[{ value: "", label: "All" }, ...f.options].map((o) => {
            const on = (sp.get(f.param) ?? "") === o.value;
            return (
              <button key={o.value} type="button" onClick={() => set({ [f.param]: o.value || undefined })} aria-pressed={on}
                className={cn("h-8 px-3 rounded-full text-caption font-medium whitespace-nowrap border shrink-0 transition-colors",
                  on ? "bg-ink text-bg border-ink" : "border-hairline-strong text-ink-2 hover:text-ink")}>{o.label}</button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function iso(d: Date) { return d.toISOString().slice(0, 10); }

function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const today = new Date();
  const presets: [string, () => [string, string]][] = [
    ["Last 7 days", () => [iso(new Date(today.getTime() - 6 * 864e5)), iso(today)]],
    ["This month", () => [iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1))), iso(today)]],
    ["Last month", () => [iso(new Date(Date.UTC(today.getFullYear(), today.getMonth() - 1, 1))), iso(new Date(Date.UTC(today.getFullYear(), today.getMonth(), 0)))]],
    ["Last 90 days", () => [iso(new Date(today.getTime() - 89 * 864e5)), iso(today)]],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2 animate-rise">
      <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)}
        className="h-10 rounded-[10px] bg-fill px-3 text-body border border-transparent focus:border-accent outline-none" />
      <span className="text-ink-3" aria-hidden>–</span>
      <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)}
        className="h-10 rounded-[10px] bg-fill px-3 text-body border border-transparent focus:border-accent outline-none" />
      <div className="flex gap-1.5 flex-wrap">
        {presets.map(([l, f]) => (
          <button key={l} type="button" onClick={() => { const [a, b] = f(); onChange(a, b); }}
            className="h-8 px-3 rounded-full text-caption font-medium border border-hairline-strong text-ink-2 hover:text-ink">{l}</button>
        ))}
      </div>
    </div>
  );
}

/** Column header that sorts the list (desktop tables). */
export function SortTh({ label, sortKey, align = "left", className }: { label: string; sortKey: string; align?: "left" | "right"; className?: string }) {
  const sp = useSearchParams();
  const path = usePathname();
  const on = sp.get("sort") === sortKey;
  const dir = on && sp.get("dir") === "asc" ? "asc" : on ? "desc" : null;
  const u = new URLSearchParams(sp.toString());
  u.set("sort", sortKey); u.set("dir", dir === "desc" ? "asc" : "desc"); u.delete("page");
  return (
    <th scope="col" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} className={cn("font-medium", align === "right" && "text-right", className)}>
      <Link href={`${path}?${u}`} scroll={false} className={cn("tap inline-flex items-center gap-1 hover:text-ink", on && "text-ink")}>
        {label}<span aria-hidden className="text-[10px] w-2">{dir === "asc" ? "▲" : dir === "desc" ? "▼" : ""}</span>
      </Link>
    </th>
  );
}

/** Newer / Older paging with a count line. Server-friendly: plain links. */
export function Pager({ page, hasMore, shown, pageSize }: { page: number; hasMore: boolean; shown: number; pageSize: number }) {
  const sp = useSearchParams();
  const path = usePathname();
  if (page === 1 && !hasMore) return shown ? <p className="text-caption text-ink-3 text-center mt-3">{shown} {shown === 1 ? "item" : "items"}</p> : null;
  const href = (p: number) => { const u = new URLSearchParams(sp.toString()); if (p > 1) u.set("page", String(p)); else u.delete("page"); return `${path}?${u}`; };
  const start = (page - 1) * pageSize + 1;
  return (
    <nav aria-label="Pages" className="flex items-center justify-between mt-3 print:hidden">
      {page > 1 ? <Link href={href(page - 1)} className="h-9 px-3 rounded-full bg-fill hover:bg-fill-hover inline-flex items-center gap-1 text-caption font-medium"><ChevronLeft size={15} aria-hidden />Previous</Link> : <span />}
      <span className="text-caption text-ink-2 num">{start}–{start + shown - 1}</span>
      {hasMore ? <Link href={href(page + 1)} className="h-9 px-3 rounded-full bg-fill hover:bg-fill-hover inline-flex items-center gap-1 text-caption font-medium">Next<ChevronRight size={15} aria-hidden /></Link> : <span />}
    </nav>
  );
}
