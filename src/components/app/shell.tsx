"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LayoutGrid, ShoppingBag, Package, Receipt, Wallet, Plus, MoreHorizontal, LogOut,
  ShoppingCart, Banknote, Truck, Tag, UserPlus, X, FileText, Settings,
} from "lucide-react";
import { cn } from "@/components/ui/primitives";
import { can, ROLE_INFO, type Role, type Capability } from "@/lib/permissions";
import { AlertBell, type UiAlert } from "./alerts";

type NavItem = { href: string; label: string; icon: typeof LayoutGrid; need?: Capability };
const NAV_ALL: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/sales", label: "Sales", icon: ShoppingBag },
  { href: "/inventory", label: "Inventory", icon: Package, need: "reports" },
  { href: "/expenses", label: "Expenses", icon: Receipt, need: "reports" },
  { href: "/money", label: "Money", icon: Wallet, need: "reports" },
  { href: "/reports", label: "Reports", icon: FileText, need: "reports" },
  { href: "/settings", label: "Settings", icon: Settings, need: "settings" },
];

const QUICK_ALL: (NavItem & { hint: string; need: Capability })[] = [
  { href: "/sales/new", label: "New sale", hint: "Record what you sold", icon: ShoppingCart, need: "sell" },
  { href: "/expenses?add=1", label: "Add expense", hint: "Fuel, transport, supplies…", icon: Receipt, need: "record" },
  { href: "/inventory/purchases/new", label: "Add purchase", hint: "Stock you bought", icon: Truck, need: "record" },
  { href: "/money?pay=customer", label: "Record payment", hint: "Money a customer paid you", icon: Banknote, need: "sell" },
  { href: "/inventory?add=1", label: "Add product", hint: "Something you sell or use", icon: Tag, need: "record" },
  { href: "/sales?customer=new", label: "Add customer", hint: "For invoices and credit", icon: UserPlus, need: "sell" },
];

function useActive() {
  const path = usePathname();
  return (href: string) => path === href || path.startsWith(href + "/");
}

function QuickMenu({ open, onClose, anchor, actions }: { open: boolean; onClose: () => void; anchor: "top" | "bottom"; actions: typeof QUICK_ALL }) {
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
    <>
      {anchor === "bottom" && <div className="fixed inset-0 bg-black/30 z-40 animate-[fade-in_150ms]" aria-hidden />}
      <div
        ref={ref}
        role="menu"
        className={cn(
          "z-50 bg-raised rounded-[16px] shadow-[var(--shadow-sheet)] border border-hairline p-1.5 w-[min(92vw,300px)] animate-[rise_180ms_var(--ease-apple)]",
          anchor === "top" ? "absolute right-0 top-12" : "fixed left-1/2 -translate-x-1/2 bottom-[calc(84px+env(safe-area-inset-bottom))]",
        )}
      >
        {actions.map((a) => (
          <Link key={a.href} href={a.href} role="menuitem" onClick={(e) => { e.preventDefault(); onClose(); router.push(a.href); }}
            className="flex items-center gap-3 rounded-[10px] px-3 py-2.5 hover:bg-fill focus:bg-fill outline-none">
            <span className="size-9 rounded-full bg-accent-soft text-accent grid place-items-center shrink-0"><a.icon size={17} /></span>
            <span className="flex flex-col">
              <span className="text-body font-medium">{a.label}</span>
              <span className="text-caption text-ink-2">{a.hint}</span>
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

export function AppShell({ children, businessName, userName, role, alerts, signOut }: {
  children: ReactNode; businessName: string; userName: string; role: Role; alerts: UiAlert[]; signOut: () => Promise<void>;
}) {
  const isActive = useActive();
  const NAV = NAV_ALL.filter((n) => !n.need || can(role, n.need));
  const actions = QUICK_ALL.filter((a) => can(role, a.need));
  const canCreate = actions.length > 0;
  // Mobile bar: first two tabs, the + button, then one more tab, then "More" for the rest.
  const mobileTabs = NAV.slice(0, 2);
  const mobileFourth = NAV.find((n) => n.href === "/expenses") ?? NAV[2];
  const mobileMore = NAV.filter((n) => !mobileTabs.includes(n) && n !== mobileFourth);
  const [menu, setMenu] = useState<null | "top" | "bottom">(null);
  const [more, setMore] = useState(false);

  // Keyboard: "n" opens a new sale from anywhere (not while typing).
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
    <div className="min-h-dvh lg:pl-[232px] print:pl-0">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:h-11 focus:px-4 focus:rounded-full focus:bg-accent focus:text-on-accent focus:grid focus:place-items-center focus:font-medium">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="print:hidden hidden lg:flex fixed inset-y-0 left-0 w-[232px] flex-col border-r border-hairline bg-surface-2/60 backdrop-blur-xl px-3 py-5">
        <Link href="/dashboard" className="flex items-center gap-2.5 px-2.5 mb-7">
          <span className="size-8 rounded-[9px] bg-accent text-on-accent grid place-items-center font-semibold text-[15px]">L</span>
          <span className="flex flex-col leading-tight min-w-0">
            <span className="text-body font-semibold">Ledgr</span>
            <span className="text-caption text-ink-2 truncate">{businessName}</span>
          </span>
        </Link>
        <nav className="flex flex-col gap-0.5" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={isActive(n.href) ? "page" : undefined}
              className={cn("flex items-center gap-3 h-9 px-2.5 rounded-[8px] text-body transition-colors",
                isActive(n.href) ? "bg-fill text-ink font-medium" : "text-ink-2 hover:text-ink hover:bg-fill/60")}>
              <n.icon size={17} strokeWidth={isActive(n.href) ? 2.2 : 1.8} className={isActive(n.href) ? "text-accent" : ""} />
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-2 px-2.5">
          <span className="size-8 rounded-full bg-fill grid place-items-center text-caption font-semibold text-ink-2">{(userName || businessName).slice(0, 1).toUpperCase()}</span>
          <span className="flex flex-col flex-1 min-w-0 leading-tight">
            <span className="text-caption text-ink truncate">{userName || ROLE_INFO[role].label}</span>
            <span className="text-[11px] text-ink-3">{ROLE_INFO[role].label}</span>
          </span>
          <form action={signOut}><button className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:text-ink hover:bg-fill" aria-label="Sign out" title="Sign out"><LogOut size={16} /></button></form>
        </div>
      </aside>

      {/* Top bar (desktop: quick action; mobile: brand) */}
      <header className="print:hidden sticky top-0 z-30 bg-bg/80 backdrop-blur-xl border-b border-hairline lg:border-none">
        <div className="mx-auto max-w-[1180px] h-14 px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <Link href="/dashboard" className="lg:hidden flex items-center gap-2">
            <span className="size-7 rounded-[8px] bg-accent text-on-accent grid place-items-center font-semibold text-[13px]">L</span>
            <span className="text-body font-semibold truncate max-w-[55vw]">{businessName}</span>
          </Link>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-2">
          <AlertBell alerts={alerts} />
          {canCreate && <div className="relative hidden lg:block">
            <button onClick={() => setMenu(menu ? null : "top")} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-accent text-on-accent text-body font-medium hover:bg-accent-hover active:scale-[0.98] transition" aria-haspopup="menu" aria-expanded={menu === "top"}>
              <Plus size={17} strokeWidth={2.4} /> New
            </button>
            <QuickMenu open={menu === "top"} onClose={() => setMenu(null)} anchor="top" actions={actions} />
          </div>}
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className="outline-none mx-auto max-w-[1180px] px-4 sm:px-6 lg:px-8 pt-5 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-16">{children}</main>

      {/* Mobile bottom bar */}
      <nav className="print:hidden lg:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/85 backdrop-blur-xl border-t border-hairline pb-[env(safe-area-inset-bottom)]" aria-label="Main">
        <div className="grid h-[64px] items-center" style={{ gridTemplateColumns: `repeat(${mobileTabs.length + (canCreate ? 1 : 0) + (mobileFourth ? 1 : 0) + 1}, minmax(0, 1fr))` }}>
          {mobileTabs.map((n) => <TabLink key={n.href} {...n} active={isActive(n.href)} />)}
          {canCreate && <div className="grid place-items-center">
            <button onClick={() => setMenu(menu ? null : "bottom")} aria-label="New" aria-haspopup="menu" aria-expanded={menu === "bottom"}
              className="size-12 rounded-full bg-accent text-on-accent grid place-items-center shadow-[0_6px_16px_rgba(0,113,227,0.35)] active:scale-95 transition">
              {menu === "bottom" ? <X size={22} /> : <Plus size={24} strokeWidth={2.4} />}
            </button>
          </div>}
          {mobileFourth && <TabLink {...mobileFourth} active={isActive(mobileFourth.href)} />}
          <button onClick={() => setMore(!more)} className={cn("flex flex-col items-center gap-0.5 text-[10px] font-medium", more || mobileMore.some((n) => isActive(n.href)) ? "text-accent" : "text-ink-3")}>
            <MoreHorizontal size={22} /> More
          </button>
        </div>
      </nav>
      <QuickMenu open={menu === "bottom"} onClose={() => setMenu(null)} anchor="bottom" actions={actions} />
      {more && (
        <>
          <div className="lg:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setMore(false)} aria-hidden />
          <div className="lg:hidden fixed z-50 right-3 bottom-[calc(76px+env(safe-area-inset-bottom))] w-56 bg-raised rounded-[16px] shadow-[var(--shadow-sheet)] border border-hairline p-1.5 animate-[rise_180ms_var(--ease-apple)]">
            {mobileMore.map((n) => (
              <Link key={n.href} href={n.href} onClick={() => setMore(false)} className="flex items-center gap-3 h-11 px-3 rounded-[10px] hover:bg-fill text-body">
                <n.icon size={18} className="text-ink-2" /> {n.label}
              </Link>
            ))}
            <form action={signOut}><button className="w-full flex items-center gap-3 h-11 px-3 rounded-[10px] hover:bg-fill text-body text-ink-2"><LogOut size={18} /> Sign out</button></form>
          </div>
        </>
      )}
    </div>
  );
}

function TabLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: typeof LayoutGrid; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center gap-0.5 text-[10px] font-medium", active ? "text-accent" : "text-ink-3")}>
      <Icon size={22} strokeWidth={active ? 2.2 : 1.8} /> {label}
    </Link>
  );
}
