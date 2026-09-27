import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { PeriodSelector } from "@/components/app/period-selector";
import { SalesOverTime } from "@/components/app/charts-lazy";
import { ExportMenu } from "@/components/app/export-menu";
import { Card, Money, cn } from "@/components/ui/primitives";
import { parsePeriodParams } from "@/lib/period-params";
import { calculatePnl, daysInclusive, formatDate, formatPercent, formatRange, resolvePeriod, todayIn, type PeriodKey, type PnlInputs } from "@/lib/finance";

export const metadata = { title: "Sales analytics" };

interface B { key: string; label: string; sales_count: number; units: number; revenue: number; cogs: number; gross_profit: number; missing_lines: number; covered_revenue: number }
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export default async function Analytics({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string; by?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const today = todayIn(ctx.business.timezone);
  const { key, custom } = parsePeriodParams(sp, "this_month");
  const period = resolvePeriod(key as PeriodKey, today, ctx.business.week_start, custom);
  const len = daysInclusive(period.from, period.to);
  const grain = (["day", "week", "month"].includes(sp.by ?? "") ? sp.by : len <= 31 ? "day" : len <= 120 ? "week" : "month") as "day" | "week" | "month";
  const b = ctx.business.id;
  const dim = (d: string) => ctx.q<B>("select * from fin_sales_breakdown($1,$2,$3,$4)", [b, period.from, period.to, d]);
  const [time, product, category, customer, salesperson] = [await dim(grain), await dim("product"), await dim("category"), await dim("customer"), await dim("salesperson")];
  const payment = await ctx.q<{ label: string; account_type: string; amount: number; invoices: number }>("select * from fin_sales_by_payment($1,$2,$3)", [b, period.from, period.to]);
  const [pr] = await ctx.q<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, period.from, period.to]);
  const p = calculatePnl(pr.r);
  const units = product.reduce((a, x) => a + x.units, 0);
  const label = (k: string) => grain === "month" ? `${MONTHS[Number(k.slice(5, 7)) - 1]} ${k.slice(2, 4)}` : formatDate(k);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]);
  const byHref = (g: string) => { const u = new URLSearchParams(qs); u.set("by", g); return `/reports/analytics?${u}`; };

  return (
    <div className="animate-rise">
      <Link href="/reports" className="tap inline-flex items-center gap-1 text-body text-accent mb-3"><ChevronLeft size={18} />Reports</Link>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h1 className="text-title font-semibold">Sales analytics</h1>
          <p className="text-body text-ink-2">What sells, to whom, by whom and how it&apos;s paid · {formatRange(period.from, period.to)}</p>
        </div>
        <ExportMenu kind="sales" query={qs.toString()} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <PeriodSelector value={key} basePath="/reports/analytics" from={custom?.from} to={custom?.to} today={today} />
        <div role="tablist" aria-label="Group by" className="inline-flex p-0.5 rounded-[10px] bg-fill">
          {(["day", "week", "month"] as const).map((g) => (
            <Link key={g} href={byHref(g)} role="tab" aria-selected={grain === g} scroll={false}
              className={cn("h-8 px-3 grid place-items-center rounded-[8px] text-caption font-medium", grain === g ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2 hover:text-ink")}>
              {g === "day" ? "Daily" : g === "week" ? "Weekly" : "Monthly"}
            </Link>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-3">
        <Fig label="Revenue" value={<Money value={p.revenue} compact />} />
        <Fig label="Sales" value={p.salesCount.toLocaleString()} />
        <Fig label="Units sold" value={units.toLocaleString()} />
        <Fig label="Average sale" value={<Money value={p.salesCount ? Math.round(p.revenue / p.salesCount) : null} />} />
        <Fig label="Gross margin" value={formatPercent(p.grossMargin, 1)} sub={p.status !== "complete" ? "Some costs missing" : undefined} />
      </div>

      <SalesOverTime data={time.map((t) => ({ label: label(t.key), revenue: t.revenue, sales: t.sales_count, units: t.units }))} />

      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Breakdown title="By product" rows={product} total={p.revenue} hrefBase="/inventory/products/" />
        <Breakdown title="By category" rows={category} total={p.revenue} />
        <Breakdown title="By customer" rows={customer} total={p.revenue} hrefBase="/money/customers/" />
        <Breakdown title="By salesperson" rows={salesperson} total={p.revenue} />
        <Card className="p-5 lg:col-span-2">
          <h2 className="text-headline font-semibold">By payment method</h2>
          <p className="text-caption text-ink-2 mb-3">Invoice totals (incl. VAT, after returns) by where the money went, plus what&apos;s still unpaid.</p>
          <Bars rows={payment.map((x) => ({ key: x.label, label: x.label, value: x.amount, sub: `${x.invoices} invoice${x.invoices === 1 ? "" : "s"}`, tone: x.account_type === "unpaid" ? "warn" : undefined }))} />
        </Card>
      </div>
    </div>
  );
}

function Fig({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="bg-surface rounded-[16px] border border-hairline p-4">
      <div className="text-caption font-medium text-ink-2">{label}</div>
      <div className="text-title font-semibold num mt-1">{value}</div>
      {sub && <div className="text-caption text-warning">{sub}</div>}
    </div>
  );
}

function Breakdown({ title, rows, total, hrefBase }: { title: string; rows: B[]; total: number; hrefBase?: string }) {
  const top = rows.slice(0, 8);
  const rest = rows.slice(8);
  const restTotal = rest.reduce((a, r) => a + r.revenue, 0);
  return (
    <Card className="p-5">
      <h2 className="text-headline font-semibold mb-3">{title}</h2>
      {rows.length === 0 ? <p className="text-body text-ink-2">No sales in this period.</p> : (
        <Bars rows={[
          ...top.map((r) => ({ key: r.key, label: r.label, value: r.revenue, href: hrefBase && r.key !== "none" ? hrefBase + r.key : undefined,
            sub: `${r.units.toLocaleString()} units · ${total ? formatPercent(r.revenue / total, 0) : "—"} of revenue · ${formatPercent(r.covered_revenue ? r.gross_profit / r.covered_revenue : null, 0)} margin${r.missing_lines ? " (excl. sales missing cost)" : ""}` })),
          ...(rest.length ? [{ key: "other", label: `${rest.length} others`, value: restTotal, sub: `${total ? formatPercent(restTotal / total, 0) : "—"} of revenue` }] : []),
        ]} />
      )}
    </Card>
  );
}

function Bars({ rows }: { rows: { key: string; label: string; value: number; sub?: string; href?: string; tone?: "warn" }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="flex justify-between gap-3 text-body">
            {r.href ? <Link href={r.href} className="block truncate hover:text-accent py-1.5 sm:py-0">{r.label}</Link> : <span className="truncate">{r.label}</span>}
            <Money value={r.value} className="font-medium" />
          </div>
          <div className="h-1.5 rounded-full bg-fill overflow-hidden mt-1">
            <div className={cn("h-full rounded-full", r.tone === "warn" ? "bg-warning" : "bg-series-1")} style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </div>
          {r.sub && <div className="text-caption text-ink-2 mt-1 num">{r.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
