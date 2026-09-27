// Core UI primitives. All styling comes from the design tokens in globals.css.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { formatMoney, formatPercent, type Kobo } from "@/lib/finance/money";

// Later classes win over earlier conflicting ones (e.g. a "hidden" passed to a Button beats its "inline-flex").
// Ledgr's custom text sizes are registered so they aren't mistaken for text colours.
const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["caption", "body", "title", "headline", "display", "display-sm", "overline"] }] } } });
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

// ---------- Button ----------
type Variant = "primary" | "secondary" | "ghost" | "destructive" | "plain";
type Size = "sm" | "md" | "lg";
const base = "inline-flex items-center justify-center gap-2 font-medium select-none transition-[background,color,transform,box-shadow] duration-150 ease-[var(--ease-apple)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap";
const variants: Record<Variant, string> = {
  primary: "bg-accent text-on-accent hover:bg-accent-hover",
  secondary: "bg-fill text-ink hover:bg-fill-hover",
  ghost: "text-accent hover:bg-accent-soft",
  destructive: "bg-negative-soft text-negative hover:brightness-95",
  plain: "text-ink-2 hover:text-ink hover:bg-fill",
};
const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-caption rounded-[8px]",
  md: "h-10 px-4 text-body rounded-[10px]",
  lg: "h-12 px-5 text-headline rounded-[12px]",
};
export function buttonClass(variant: Variant = "primary", size: Size = "md", extra?: string) {
  return cn(base, variants[variant], sizes[size], extra);
}
export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...p} />;
}
export function ButtonLink({ variant = "primary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...p} />;
}

// ---------- Surfaces ----------
export function Card({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("bg-surface rounded-[16px] border border-hairline shadow-[var(--shadow-card)]", className)} {...p} />;
}
export function Overline({ className, ...p }: ComponentProps<"div">) {
  return <div className={cn("text-overline uppercase font-semibold text-ink-2", className)} {...p} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
      <div className="min-w-0">
        <h1 className="text-title font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-body text-ink-2 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------- Numbers ----------
export function Money({ value, compact, signed, className, exact }: { value: Kobo | null | undefined; compact?: boolean; signed?: boolean; exact?: boolean; className?: string }) {
  return (
    <span className={cn("num", className)} title={compact && value != null ? formatMoney(value, { exact: true }) : undefined}>
      {formatMoney(value, { compact, signed, exact })}
    </span>
  );
}
export function Percent({ value, dp = 1, className }: { value: number | null | undefined; dp?: number; className?: string }) {
  return <span className={cn("num", className)}>{formatPercent(value, dp)}</span>;
}

// ---------- Status ----------
const tones = {
  neutral: "bg-fill text-ink-2",
  positive: "bg-positive-soft text-positive",
  negative: "bg-negative-soft text-negative",
  warning: "bg-warning-soft text-warning",
  accent: "bg-accent-soft text-accent",
} as const;
export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof tones; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 h-6 px-2 rounded-full text-caption font-medium whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

export const invoiceStatus: Record<string, { label: string; tone: keyof typeof tones }> = {
  paid: { label: "Paid", tone: "positive" },
  partially_paid: { label: "Part paid", tone: "accent" },
  unpaid: { label: "Unpaid", tone: "neutral" },
  overdue: { label: "Overdue", tone: "negative" },
  voided: { label: "Voided", tone: "neutral" },
};

// ---------- Empty state ----------
export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-6 py-14">
      {icon && <div className="size-12 rounded-full bg-fill grid place-items-center text-ink-2 mb-4">{icon}</div>}
      <h3 className="text-headline font-semibold">{title}</h3>
      <p className="text-body text-ink-2 mt-1 max-w-sm">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------- Forms ----------
export function Field({ label, hint, error, children, className, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-caption font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p className="text-caption text-negative">{error}</p> : hint ? <p className="text-caption text-ink-3">{hint}</p> : null}
    </div>
  );
}
export const inputClass = "h-11 w-full rounded-[10px] bg-fill px-3 text-body text-ink placeholder:text-ink-3 outline-none border border-transparent focus:border-accent focus:bg-surface transition-colors";
export function Input({ className, ...p }: ComponentProps<"input">) {
  return <input className={cn(inputClass, className)} {...p} />;
}
export function Select({ className, children, ...p }: ComponentProps<"select">) {
  return (
    <select className={cn(inputClass, "appearance-none pr-9 bg-[length:12px] bg-no-repeat bg-[position:right_12px_center] bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 12 12%22><path d=%22M3 4.5l3 3 3-3%22 fill=%22none%22 stroke=%22%238e8e93%22 stroke-width=%221.5%22 stroke-linecap=%22round%22/></svg>')]", className)} {...p}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...p }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputClass, "h-auto min-h-20 py-2.5", className)} {...p} />;
}

export function Divider({ className }: { className?: string }) {
  return <div className={cn("h-px bg-hairline", className)} />;
}
