"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, AlertTriangle, AlertOctagon, Info, Check, ChevronRight } from "lucide-react";
import { cn, Card } from "@/components/ui/primitives";
import { dismissAlert } from "@/app/actions/control";

export interface UiAlert {
  id: string; kind: string; severity: "info" | "warning" | "critical"; message: string;
  data: { href?: string }; read_at: string | null; updated_at: string;
}

const ICON = { critical: AlertOctagon, warning: AlertTriangle, info: Info } as const;
const TONE = { critical: "text-negative bg-negative-soft", warning: "text-warning bg-warning-soft", info: "text-accent bg-accent-soft" } as const;

function AlertItem({ a, onDone, compact }: { a: UiAlert; onDone?: () => void; compact?: boolean }) {
  const [pending, start] = useTransition();
  const [gone, setGone] = useState(false);
  const Icon = ICON[a.severity];
  if (gone) return null;
  return (
    <li className={cn("flex items-start gap-3 py-2.5", a.read_at && "opacity-60")}>
      <span className={cn("size-8 shrink-0 rounded-full grid place-items-center", TONE[a.severity])}><Icon size={16} /></span>
      <div className="flex-1 min-w-0">
        <p className="text-body leading-snug">{a.message}</p>
        <div className="flex items-center gap-3 mt-1">
          {a.data.href && (
            <Link href={a.data.href} onClick={onDone} className="tap text-caption text-accent inline-flex items-center gap-0.5 font-medium">
              Look into it<ChevronRight size={13} />
            </Link>
          )}
          {!a.read_at && (
            <button disabled={pending} onClick={() => start(async () => { const r = await dismissAlert(a.id); if (r.ok) setGone(!compact); })}
              className="tap text-caption text-ink-2 hover:text-ink inline-flex items-center gap-1">
              <Check size={13} />{pending ? "…" : "Dismiss"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Bell in the top bar with a dropdown list. */
export function AlertBell({ alerts }: { alerts: UiAlert[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = alerts.filter((a) => !a.read_at);
  const worst = "bg-negative-fill";
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    setTimeout(() => document.addEventListener("click", onClick), 0);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(!open)} aria-haspopup="dialog" aria-expanded={open}
        aria-label={unread.length ? `Alerts, ${unread.length} new` : "Alerts"}
        className="relative size-9 grid place-items-center rounded-full text-ink-2 hover:text-ink hover:bg-fill transition-colors">
        <Bell size={19} />
        {unread.length > 0 && (
          <span className={cn("absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-semibold text-white grid place-items-center num", worst)}>
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Alerts"
          className="absolute right-0 top-11 z-50 w-[min(92vw,380px)] bg-raised rounded-[16px] shadow-[var(--shadow-sheet)] border border-hairline animate-[rise_180ms_var(--ease-apple)]">
          <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
            <h2 className="text-headline font-semibold">Alerts</h2>
            <Link href="/settings?tab=alerts" onClick={() => setOpen(false)} className="text-caption text-accent">Alert settings</Link>
          </div>
          {alerts.length === 0 ? (
            <div className="px-4 pb-5 pt-3 text-center">
              <span className="mx-auto size-10 rounded-full bg-positive-soft text-positive grid place-items-center mb-2"><Check size={18} /></span>
              <p className="text-body font-medium">All clear</p>
              <p className="text-caption text-ink-2">Nothing needs your attention right now.</p>
            </div>
          ) : (
            <ul className="px-4 pb-2 max-h-[60vh] overflow-y-auto divide-y divide-hairline">
              {alerts.map((a) => <AlertItem key={a.id} a={a} onDone={() => setOpen(false)} compact />)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Dashboard card: the unread alerts, most serious first. Hidden when there's nothing to say. */
export function AlertsCard({ alerts }: { alerts: UiAlert[] }) {
  const unread = alerts.filter((a) => !a.read_at);
  if (!unread.length) return null;
  const shown = unread.slice(0, 4);
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-headline font-semibold">Needs your attention</h2>
        {unread.length > shown.length && <span className="text-caption text-ink-2">{unread.length - shown.length} more in the bell</span>}
      </div>
      <ul className="divide-y divide-hairline">{shown.map((a) => <AlertItem key={a.id} a={a} />)}</ul>
    </Card>
  );
}
