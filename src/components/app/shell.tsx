"use client";
// The app frame. Phone: 5 tabs with a big Sell button in the middle. Laptop: a calm sidebar.
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  House, Package, Wallet, Plus, MoreHorizontal, LogOut, ReceiptText, Receipt, FileText, Settings,
  Truck, Banknote, Tag, UserPlus, FlaskConical, ShoppingBasket, X, type LucideIcon,
} from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { can, ROLE_INFO, type Role, type Capability } from "@/lib/permissions";
import { AlertBell, type UiAlert } from "./alerts";

type NavItem = { href: string; label: string; icon: LucideIcon; need?: Capability; match?: string[] };

const NAV_ALL: NavItem[] = [
  { href: "/dashboard", label: "Today", icon: House },
  { href: "/sales", label: "Sales", icon: ReceiptText, match: ["/sales"] },
  { href: "/inventory", label: "Stock", icon: Package, need: "reports", match: ["/inventory", "/shopping"] },
  { href: "/money", label: "Money", icon: Wallet, need: "reports" },
  { href: "/expenses", label: "Expenses", icon: Receipt, need: "reports" },
  { href: "/reports", label: "Reports", icon: FileText, need: "reports" },
  { href: "/settings", label: "Settings", icon: Settings, need: "settings" },
];

type Quick = NavItem & { hint: string; need: Capability };
const QUICK_ALL: Quick[] = [
  { href: "/inventory/production/new", label: "Made a batch", hint: "Juice or snacks you made", icon: FlaskConical, need: "record" },
  { href: "/expenses?add=1", label: "Add expense", hint: "Fuel, transport, supplies…", icon: Receipt, need: "record" },
  { href: "/inventory/purchases/new", label: "Bought stock", hint: "Fruit, bottles, packaging", icon: Truck, need: "record" },
  { href: "/money?pay=customer", label: "Customer paid", hint: "Money someone owed you", icon: Banknote, need: "sell" },
  { href: "/shopping", label: "Shopping list", hint: "What to buy next", icon: ShoppingBasket, need: "reports" },
  { href: "/inventory?add=1", label: "Add product", hint: "Something you sell or use", icon: Tag, need: "record" },
  { href: "/sales?customer=new", label: "Add customer", hint: "For credit and receipts", icon: UserPlus, need: "sell" },
];

function useActive() {
  const path = usePathname();
  return (n: { href: string; match?: string[] }) => {
    if (n.href === "/sales") return path === "/sales" || (path.startsWith("/sales/") && !path.startsWith("/sales/new"));
    return (n.match ?? [n.href]).some((m) => path === m || path.startsWith(m + "/"));
  };
}

/** Bottom sheet on phones for "More": the rest of the app plus quick actions. */
function MoreSheet({ open, onClose, nav, quick, signOut, isActive }: {
  open: boolean; onClose: () => void; nav: NavItem[]; quick: Quick[]; signOut: () => Promise<void>; isActive: (n: NavItem) => boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("a,button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="More">
      <div className="absolute inset-0 bg-black/35 animate-[fade-in_150ms]" onClick={onClose} aria-hidden />
      <div ref={ref} className="absolute inset-x-0 bottom-0 bg-raised rounded-t-[26px] shadow-[var(--shadow-sheet)] pb-[calc(16px+env(safe-area-inset-bottom))] animate-[sheet-in_220ms_var(--ease-apple)] max-h-[85dvh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <span className="w-10 h-1.5 rounded-full bg-hairline-strong absolute left-1/2 -translate-x-1/2 top-2" aria-hidden />
          <h2 className="text-headline font-semibold">More</h2>
          <button onClick={onClose} className="size-10 grid place-items-center rounded-full bg-fill text-ink-2" aria-label="Close"><X size={18} /></button>
        </div>
        {quick.length > 0 && (
          <div className="px-4 pb-2">
            <div className="text-overline uppercase font-semibold text-ink-3 px-1 mb-2">Record</div>
            <div className="grid grid-cols-3 gap-2">
              {quick.map((q) => (
                <Link key={q.href} href={q.href} onClick={onClose} className="press flex flex-col items-center gap-1.5 text-center rounded-[16px] bg-surface-2 border border-hairline px-2 py-3">
                  <span className="size-10 rounded-full bg-accent-soft text-accent grid place-items-center"><q.icon size={19} /></span>
                  <span className="text-caption font-medium leading-tight">{q.label}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
        <div className="px-4 pt-3">
          <div className="text-overline uppercase font-semibold text-ink-3 px-1 mb-1">Go to</div>
          <div className="flex flex-col">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} onClick={onClose} aria-current={isActive(n) ? "page" : undefined}
                className={cn("flex items-center gap-3 h-12 px-2 rounded-[12px] text-body", isActive(n) ? "text-accent font-semibold" : "hover:bg-fill")}>
                <n.icon size={20} className={isActive(n) ? "" : "text-ink-2"} /> {n.label}
              </Link>
            ))}
            <form action={signOut}><button className="w-full flex items-center gap-3 h-12 px-2 rounded-[12px] hover:bg-fill text-body text-ink-2"><LogOut size={20} /> Sign out</button></form>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Laptop "+ New" menu. */
function QuickMenu({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: Quick[] }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("keydown", onKey);
    setTimeout(() => document.addEventListener("click", onClick), 0);
    ref.current?.querySelector<HTMLElement>("a")?.focus();
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("click", onClick); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div ref={ref} role="menu" className="absolute right-0 top-12 z-50 bg-raised rounded-[18px] shadow-[var(--shadow-sheet)] border border-hairline p-1.5 w-[300px] animate-[rise_180ms_var(--ease-apple)]">
      {actions.map((a) => (
        <Link key={a.href} href={a.href} role="menuitem" onClick={(e) => { e.preventDefault(); onClose(); router.push(a.href); }}
          className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 hover:bg-fill focus:bg-fill outline-none">
          <span className="size-9 rounded-full bg-accent-soft text-accent grid place-items-center shrink-0"><a.icon size={17} /></span>
          <span className="flex flex-col">
            <span className="text-body font-medium">{a.label}</span>
            <span className="text-caption text-ink-2">{a.hint}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function AppShell({ children, businessName, userName, role, alerts, signOut }: {
  children: ReactNode; businessName: string; userName: string; role: Role; alerts: UiAlert[]; signOut: () => Promise<void>;
}) {
  const isActive = useActive();
  const path = usePathname();
  const NAV = NAV_ALL.filter((n) => !n.need || can(role, n.need));
  const quick = QUICK_ALL.filter((a) => can(role, a.need));
  const canSell = can(role, "sell");
  // Phone tabs: Today, Stock (or Sales for staff), [Sell], Money (or Sales), More.
  const left = [NAV[0], NAV.find((n) => n.href === "/inventory") ?? NAV.find((n) => n.href === "/sales")].filter(Boolean) as NavItem[];
  const right = [NAV.find((n) => n.href === "/money") ?? (left.some((l) => l.href === "/sales") ? undefined : NAV.find((n) => n.href === "/sales"))].filter(Boolean) as NavItem[];
  const inMore = NAV.filter((n) => !left.includes(n) && !right.includes(n));
  const [menu, setMenu] = useState(false);
  const [more, setMore] = useState(false);
  const onTill = path.startsWith("/sales/new");

  // Keyboard: "n" opens the till from anywhere (not while typing).
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || t.isContentEditable) return;
      if (e.key === "n" && can(role, "sell")) router.push("/sales/new");
      if (e.key === "e" && can(role, "record")) router.push("/expenses?add=1");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, role]);

  return (
    <div className="min-h-dvh lg:pl-[248px] print:pl-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:h-11 focus:px-4 focus:rounded-full focus:bg-accent focus:text-on-accent focus:grid focus:place-items-center focus:font-medium">Skip to content</a>

      {/* Laptop sidebar */}
      <aside className="print:hidden hidden lg:flex fixed inset-y-0 left-0 w-[248px] flex-col border-r border-hairline bg-surface-2 px-4 py-5">
        <Link href="/dashboard" className="flex items-center gap-3 px-2 mb-6">
          <BrandMark />
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-body font-semibold truncate">{businessName}</span>
            <span className="text-caption text-ink-3">Ledgr</span>
          </span>
        </Link>
        {canSell && (
          <Link href="/sales/new" className="press mb-5 h-12 rounded-[14px] bg-accent text-on-accent font-semibold flex items-center justify-center gap-2 shadow-[0_6px_18px_rgba(47,91,234,0.28)]">
            <Plus size={19} strokeWidth={2.6} /> New sale
          </Link>
        )}
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map((n) => {
            const on = isActive(n);
            return (
              <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                className={cn("flex items-center gap-3 h-11 px-3 rounded-[12px] text-body transition-colors",
                  on ? "bg-accent-soft text-accent font-semibold" : "text-ink-2 hover:text-ink hover:bg-fill")}>
                <n.icon size={19} strokeWidth={on ? 2.2 : 1.8} />
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="mt-auto flex items-center gap-2.5 px-2 pt-4 border-t border-hairline">
          <span className="size-9 rounded-full bg-accent text-on-accent grid place-items-center text-caption font-semibold">{(userName || businessName).slice(0, 1).toUpperCase()}</span>
          <span className="flex flex-col flex-1 min-w-0 leading-tight">
            <span className="text-caption font-medium text-ink truncate">{userName || ROLE_INFO[role].label}</span>
            <span className="text-[12px] text-ink-3">{ROLE_INFO[role].label}</span>
          </span>
          <form action={signOut}><button className="size-9 grid place-items-center rounded-[10px] text-ink-3 hover:text-ink hover:bg-fill" aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></form>
        </div>
      </aside>

      {/* Top bar */}
      <header className={cn("print:hidden sticky top-0 z-30 bg-bg/85 backdrop-blur-xl", onTill && "max-lg:hidden")}>
        <div className="mx-auto max-w-[1180px] h-14 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <Link href="/dashboard" className="lg:hidden flex items-center gap-2.5 min-w-0">
            <BrandMark small />
            <span className="text-body font-semibold truncate max-w-[60vw]">{businessName}</span>
          </Link>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
            <AlertBell alerts={alerts} />
            {quick.length > 0 && (
              <div className="relative hidden lg:block">
                <button onClick={() => setMenu(!menu)} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-full bg-surface border border-hairline text-body font-medium hover:bg-fill active:scale-[0.98] transition" aria-haspopup="menu" aria-expanded={menu}>
                  <Plus size={17} strokeWidth={2.4} /> Record
                </button>
                <QuickMenu open={menu} onClose={() => setMenu(false)} actions={quick} />
              </div>
            )}
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className={cn("outline-none mx-auto max-w-[1180px] px-4 sm:px-6 lg:px-8 pt-3 lg:pt-5 lg:pb-16", onTill ? "pb-0" : "pb-[calc(104px+env(safe-area-inset-bottom))]")}>{children}</main>

      {/* Phone tab bar (hidden on the till, which has its own big Charge button) */}
      {!onTill && (
        <nav className="print:hidden lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/90 backdrop-blur-xl border-t border-hairline pb-[env(safe-area-inset-bottom)]" aria-label="Main">
          <div className="grid grid-cols-5 h-[66px] items-center">
            {left.map((n) => <TabLink key={n.href} item={n} active={isActive(n)} />)}
            {left.length < 2 && <span />}
            <div className="grid place-items-center">
              {canSell ? (
                <Link href="/sales/new" aria-label="Sell" className="press -mt-7 size-[58px] rounded-full bg-accent text-on-accent grid place-items-center shadow-[0_8px_22px_rgba(47,91,234,0.38)] ring-4 ring-bg">
                  <Plus size={28} strokeWidth={2.6} />
                </Link>
              ) : <span />}
            </div>
            {right.map((n) => <TabLink key={n.href} item={n} active={isActive(n)} />)}
            {right.length < 1 && <span />}
            <button onClick={() => setMore(true)} aria-haspopup="dialog" className={cn("flex flex-col items-center gap-1 text-[11px] font-medium h-full justify-center", inMore.some(isActive) ? "text-accent" : "text-ink-3")}>
              <MoreHorizontal size={24} /> More
            </button>
          </div>
        </nav>
      )}
      <MoreSheet open={more} onClose={() => setMore(false)} nav={inMore} quick={quick} signOut={signOut} isActive={isActive} />
    </div>
  );
}

function TabLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link href={item.href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-1 text-[11px] font-medium h-full justify-center", active ? "text-accent" : "text-ink-3")}>
      <Icon size={24} strokeWidth={active ? 2.2 : 1.8} /> {item.label}
    </Link>
  );
}

/** The Ledgr mark. */
export function BrandMark({ small }: { small?: boolean }) {
  return (
    <span className={cn("relative rounded-[10px] bg-[#111318] dark:bg-white text-white dark:text-[#111318] grid place-items-center font-bold shrink-0", small ? "size-8 text-[15px]" : "size-10 text-[18px]")} aria-hidden>
      L<span className={cn("absolute rounded-full bg-accent", small ? "size-[6px] top-[8px] right-[8px]" : "size-[7px] top-[10px] right-[10px]")} />
    </span>
  );
}
