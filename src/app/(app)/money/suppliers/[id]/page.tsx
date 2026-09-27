import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Phone } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { Money, cn } from "@/components/ui/primitives";
import { addDays, ageing, formatRange, todayIn } from "@/lib/finance";
import { StatementRange, StatementTable, type StatementRow } from "@/components/app/statement";
import { PrintButton } from "@/components/app/print-button";

export const metadata = { title: "Supplier statement" };

export default async function SupplierStatement({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string; to?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const today = todayIn(ctx.business.timezone);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = sp.from && iso.test(sp.from) ? sp.from : addDays(today, -89);
  const to = sp.to && iso.test(sp.to) ? sp.to : today;
  const [c] = await ctx.q<{ id: string; name: string; phone: string | null; contact_name: string | null }>(
    "select * from suppliers where id = $1 and business_id = $2", [id, ctx.business.id]);
  if (!c) notFound();
  const rows = await ctx.q<StatementRow>("select * from fin_supplier_statement($1,$2,$3,$4)", [ctx.business.id, id, from, to]);
  const open = await ctx.q<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_payables($1,$2) where supplier_id = $3", [ctx.business.id, today, id]);
  const a = ageing(open);

  return (
    <div className="animate-rise max-w-4xl">
      <Link href="/money?tab=payables" className="tap inline-flex items-center gap-1 text-body text-accent mb-3 print:hidden"><ChevronLeft size={18} />You owe suppliers</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-caption text-ink-2 hidden print:block">{ctx.business.name} · Statement of account</p>
          <h1 className="text-title font-semibold">{c.name}</h1>
          <p className="text-body text-ink-2 flex items-center gap-2">
            {c.phone && <a href={`tel:${c.phone.replace(/\s/g, "")}`} className="tap inline-flex items-center gap-1 text-accent print:text-ink"><Phone size={14} />{c.phone}</a>}
            {c.contact_name && <span>Contact: {c.contact_name}</span>}
          </p>
        </div>
        <PrintButton />
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <Box label="You owe" value={<Money value={a.total} />} />
        <Box label="Overdue" value={<Money value={a.overdue} />} tone={a.overdue > 0 ? "negative" : undefined} sub={a.overdueCount ? `${a.overdueCount} bill${a.overdueCount === 1 ? "" : "s"}` : undefined} />
        <Box label="Open bills" value={String(a.count)} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <h2 className="text-headline font-semibold">Statement · {formatRange(from, to)}</h2>
        <StatementRange base={`/money/suppliers/${id}`} from={from} to={to} today={today} />
      </div>
      <StatementTable rows={rows} party="supplier" />
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
