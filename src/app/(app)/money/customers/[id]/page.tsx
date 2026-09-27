import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { Money, cn } from "@/components/ui/primitives";
import { addDays, ageing, formatRange, todayIn } from "@/lib/finance";
import { StatementRange, StatementTable, type StatementRow } from "@/components/app/statement";
import { PrintButton } from "@/components/app/print-button";

export const metadata = { title: "Customer statement" };

export default async function CustomerStatement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const today = todayIn(ctx.business.timezone);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = sp.from && iso.test(sp.from) ? sp.from : addDays(today, -89);
  const to = sp.to && iso.test(sp.to) ? sp.to : today;
  const [c] = await ctx.q<{ id: string; name: string; phone: string | null; email: string | null; payment_terms_days: number | null; is_walk_in: boolean }>(
    "select * from customers where id = $1 and business_id = $2", [id, ctx.business.id]);
  if (!c) notFound();
  const rows = await ctx.q<StatementRow>("select * from fin_customer_statement($1,$2,$3,$4)", [ctx.business.id, id, from, to]);
  const open = await ctx.q<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_receivables($1,$2) where customer_id = $3", [ctx.business.id, today, id]);
  const a = ageing(open);
  const [credit] = await ctx.q<{ credit: number }>("select app_customer_credit($1) credit", [id]);

  return (
    <div className="animate-rise max-w-4xl">
      <Link href="/money?tab=receivables" className="tap inline-flex items-center gap-1 text-body text-accent mb-3 print:hidden"><ChevronLeft size={18} />Customers owe you</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-caption text-ink-2 hidden print:block">{ctx.business.name} · Statement of account</p>
          <h1 className="text-title font-semibold">{c.name}</h1>
          <p className="text-body text-ink-2 flex items-center gap-2">
            {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="tap inline-flex items-center gap-1 text-accent print:text-ink"><Phone size={14} />{c.phone}</a>}
            <span>Pays within {c.payment_terms_days ?? ctx.business.default_payment_terms_days} days</span>
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Box label="Owes you now" value={<Money value={a.total} />} />
        <Box label="Overdue" value={<Money value={a.overdue} />} tone={a.overdue > 0 ? "negative" : undefined} sub={a.overdueCount ? `${a.overdueCount} invoice${a.overdueCount === 1 ? "" : "s"}` : undefined} />
        <Box label="Credit held" value={<Money value={Math.max(0, credit?.credit ?? 0)} />} sub="Paid but not yet used" />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-headline font-semibold">Statement · {formatRange(from, to)}</h2>
        <StatementRange base={`/money/customers/${id}`} from={from} to={to} today={today} />
      </div>
      <StatementTable rows={rows} party="customer" />
    </div>
  );
}

function Box({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: string; tone?: "negative" }) {
  return (
    <div className="bg-surface rounded-[16px] border border-hairline p-4">
      <div className="text-caption font-medium text-ink-2">{label}</div>
      <div className={cn("text-title font-semibold num mt-1", tone === "negative" && "text-negative")}>{value}</div>
      {sub && <div className="text-caption text-ink-3">{sub}</div>}
    </div>
  );
}
