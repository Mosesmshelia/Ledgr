"use client";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { parseNaira, type Kobo } from "@/lib/finance/money";
import { cn, inputClass } from "./primitives";

/** ₦ amount field. Shows what the person types; hands back kobo (or null while empty/invalid). */
export function MoneyInput({ value, onChange, id, placeholder = "0", autoFocus, className, invalid, "aria-label": ariaLabel }: {
  value: Kobo | null; onChange: (k: Kobo | null) => void; id?: string; placeholder?: string; autoFocus?: boolean; className?: string; invalid?: boolean; "aria-label"?: string;
}) {
  const fmt = (k: Kobo | null) => (k === null ? "" : (k / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 }));
  const [text, setText] = useState(fmt(value));
  const last = useRef(value);
  useEffect(() => {
    if (value !== last.current) { setText(fmt(value)); last.current = value; }
  }, [value]);
  return (
    <div className={cn("relative", className)}>
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 text-body pointer-events-none">₦</span>
      <input
        id={id} inputMode="decimal" autoComplete="off" autoFocus={autoFocus} aria-label={ariaLabel} aria-invalid={invalid || undefined}
        className={cn(inputClass, "pl-7 num", invalid && "border-negative")}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d.,]/g, "");
          setText(raw);
          const k = parseNaira(raw);
          last.current = k;
          onChange(k);
        }}
        onBlur={() => setText(fmt(parseNaira(text)))}
      />
    </div>
  );
}

export function QtyInput({ value, onChange, unit, className, id }: { value: number; onChange: (n: number) => void; unit?: string; className?: string; id?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { if (Number(text) !== value) setText(String(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d: number) => onChange(Math.max(0, Math.round((value + d) * 1000) / 1000));
  return (
    <div className={cn("flex items-center h-11 rounded-[10px] bg-fill focus-within:ring-2 focus-within:ring-accent", className)}>
      <button type="button" onClick={() => step(-1)} className="w-10 h-full grid place-items-center text-ink-2 text-lg active:scale-90" aria-label="Decrease">−</button>
      <input id={id} inputMode="decimal" className="w-full min-w-0 bg-transparent text-center num text-body outline-none" value={text} aria-label={`Quantity${unit && unit !== "unit" ? ` (${unit})` : ""}`}
        onChange={(e) => { const t = e.target.value.replace(/[^\d.]/g, ""); setText(t); const n = Number(t); if (!Number.isNaN(n)) onChange(n); }} />
      <button type="button" onClick={() => step(1)} className="w-10 h-full grid place-items-center text-ink-2 text-lg active:scale-90" aria-label="Increase">+</button>
    </div>
  );
}

export interface ComboOption { value: string; label: string; hint?: ReactNode; group?: string; keywords?: string }

/** Searchable picker. Keyboard: type to filter, ↑/↓ to move, Enter to choose, Esc to close. */
export function Combobox({ options, value, onChange, placeholder = "Search…", id, invalid, footer }: {
  options: ComboOption[]; value: string | null; onChange: (v: string) => void; placeholder?: string; id?: string; invalid?: boolean; footer?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => (o.label + " " + (o.keywords ?? "")).toLowerCase().includes(q)) : options;
  }, [options, query]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const choose = (o: ComboOption) => { onChange(o.value); setOpen(false); setQuery(""); };
  return (
    <div ref={ref} className="relative">
      {open ? (
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
          <input
            id={id} autoFocus role="combobox" aria-expanded aria-controls={listId} aria-activedescendant={filtered[active] ? `${listId}-${active}` : undefined}
            className={cn(inputClass, "pl-9 bg-surface border-accent")} placeholder={placeholder} value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
              if (e.key === "Enter" && filtered[active]) { e.preventDefault(); choose(filtered[active]); }
              if (e.key === "Escape") setOpen(false);
            }}
          />
        </div>
      ) : (
        <button type="button" id={id} onClick={() => setOpen(true)} className={cn(inputClass, "flex items-center justify-between text-left", invalid && "border-negative")}>
          <span className={cn("truncate", !selected && "text-ink-2")}>{selected?.label ?? placeholder}</span>
          <ChevronDown size={16} className="text-ink-3 shrink-0" />
        </button>
      )}
      {open && (
        <div className="absolute z-30 mt-1.5 w-full bg-raised border border-hairline rounded-[12px] shadow-[var(--shadow-sheet)] overflow-hidden animate-[rise_140ms_var(--ease-apple)]">
          <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1">
            {filtered.length === 0 && <li className="px-3 py-3 text-body text-ink-2">No matches</li>}
            {filtered.map((o, i) => (
              <li key={o.value} id={`${listId}-${i}`} role="option" aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                className={cn("flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] cursor-pointer", i === active && "bg-fill")}>
                <span className="min-w-0">
                  <span className="block text-body truncate">{o.label}</span>
                  {o.hint && <span className="block text-caption text-ink-2 truncate">{o.hint}</span>}
                </span>
                {o.value === value && <Check size={16} className="text-accent shrink-0" />}
              </li>
            ))}
          </ul>
          {footer && <div className="border-t border-hairline p-1">{footer}</div>}
        </div>
      )}
    </div>
  );
}

/** Pill choice group (payment status, account, category). */
export function Chips<T extends string>({ options, value, onChange, label }: { options: { value: T; label: ReactNode }[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={value === o.value} key={o.value} onClick={() => onChange(o.value)}
          className={cn("h-9 px-3.5 rounded-full text-caption font-medium border transition-colors",
            value === o.value ? "bg-accent text-on-accent border-accent" : "bg-surface border-hairline-strong text-ink hover:bg-fill")}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
