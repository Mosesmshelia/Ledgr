import Link from "next/link";
import { ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { loadWeeklyReport } from "@/lib/server/reports";
import { Card, Money, cn } from "@/components/ui/primitives";
import { Trend } from "@/components/ui/metric";
import { ReportMeta } from "@/components/app/report-header";
import { ExportMenu } from "@/components/app/export-menu";
import { formatPercent, formatRange } from "@/lib/finance";

export const metadata = { title: "Weekly report" };

export default async function WeeklyReport({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const r = await loadWeeklyReport(ctx, sp.week);
  const { pnl } = r;
  const vs = r.isCurrent ? "same days last week" : "the week before";
  const tone = { positive: "text-positive", negative: "text-negative", warning: "text-warning", neutral: "" } as const;
  const maxExp = Math.max(1, ...r.operating.map((e) => e.total));

  return (
    <div className="animate-rise max-w-4xl">
      <Link href="/reports" className="tap inline-flex items-center gap-1 text-body text-accent mb-3 print:hidden"><ChevronLeft size={18} />Reports</Link>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div>
          <h1 className="text-title font-semibold">Weekly business report</h1>
          <p className="text-body text-ink-2">{formatRange(r.period.from, r.isCurrent ? r.fullEnd : r.period.to)}{r.isCurrent && " · so far"}</p>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Link href={`/reports/weekly?week=${r.prevWeek}`} className="size-10 grid place-items-center rounded-[10px] bg-fill hover:bg-fill-hover" aria-label="Previous week"><ChevronLeft size={18} /></Link>
          {r.nextWeek ? <Link href={`/reports/weekly?week=${r.nextWeek}`} className="size-10 grid place-items-center rounded-[10px] bg-fill hover:bg-fill-hover" aria-label="Next week"><ChevronRight size={18} /></Link>
            : <span className="size-10 grid place-items-center rounded-[10px] bg-fill opacity-40" aria-hidden><ChevronRight size={18} /></span>}
          <ExportMenu kind="weekly" query={`week=${r.period.from}`} />
        </div>
      </div>
      <ReportMeta business={ctx.business.name} from={r.period.from} to={r.period.to} status={pnl.status} note={pnl.statusNote} />

      <Card className="p-5">
        <h2 className="text-headline font-semibold flex items-center gap-2 mb-2"><Sparkles size={17} className="text-accent" />The week in plain English</h2>
        <div className="flex flex-col gap-1.5">
          {r.summary.map((s) => <p key={s.key} className={cn("text-body", tone[s.tone ?? "neutral"])}>{s.text}</p>)}
        </div>
      </Card>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Card className="p-5">
          <h2 className="text-headline font-semibold mb-3">Performance</h2>
          <dl className="flex flex-col num">
            <Line l="Revenue" v={<Money value={pnl.revenue} />} trend={<Trend c={r.compare.revenue} vs={vs} />} />
            <Line l="Cost of goods sold" v={<Money value={pnl.cogs} />} />
            <Line l="Gross profit" v={<Money value={pnl.grossProfit} />} trend={<Trend c={r.compare.grossProfit} vs={vs} />} strong />
            <Line l="Gross margin" v={formatPercent(pnl.grossMargin)} />
            <Line l="Operating expenses" v={<Money value={pnl.operatingExpenses} />} trend={<Trend c={r.compare.opex} vs={vs} higherIsBetter={false} />} />
            {(pnl.otherIncome !== 0 || pnl.otherExpense !== 0 || pnl.incomeTax !== 0) && <Line l="Other items" v={<Money value={pnl.otherIncome - pnl.otherExpense - pnl.incomeTax} signed />} />}
            <Line l="Net profit" v={<Money value={pnl.netProfit} className={pnl.netProfit < 0 ? "text-negative" : ""} />} trend={<Trend c={r.compare.netProfit} vs={vs} />} strong />
            <Line l="Net profit margin" v={formatPercent(pnl.netMargin)} />
          </dl>
          {pnl.statusNote && <p className="text-caption text-warning mt-3">{pnl.statusNote}</p>}
        </Card>

        <Card className="p-5">
          <h2 className="text-headline font-semibold mb-3">Cash and balances</h2>
          <dl className="flex flex-col num">
            <Line l="Opening cash" v={<Money value={r.cash.opening} />} />
            <Line l="Cash in" v={<Money value={r.cash.cashIn} />} />
            <Line l="Cash out" v={<Money value={r.cash.cashOut} />} />
            <Line l="Closing cash" v={<Money value={r.cash.closing} />} strong />
            <Line l="Customers owe you" v={<Money value={r.rec.total} />} sub={r.rec.overdue ? <span className="text-negative"><Money value={r.rec.overdue} /> overdue</span> : undefined} />
            <Line l="You owe suppliers" v={<Money value={r.pay.total} />} sub={r.pay.overdue ? <span className="text-negative"><Money value={r.pay.overdue} /> overdue</span> : undefined} />
          </dl>
          <p className="text-caption text-ink-3 mt-3">Cash in/out includes transfers between your own accounts, which cancel out.</p>
        </Card>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <Card className="p-5">
          <h2 className="text-headline font-semibold mb-3">Expenses by category</h2>
          {r.operating.length === 0 ? <p className="text-body text-ink-2">No expenses this week.</p> : (
            <ul className="flex flex-col gap-3">
              {r.operating.map((e) => (
                <li key={e.category_id}>
                  <div className="flex justify-between text-body mb-1"><span>{e.name}</span><Money value={e.total} className="num font-medium" /></div>
                  <div className="h-1.5 rounded-full bg-fill overflow-hidden"><div className="h-full rounded-full bg-series-2" style={{ width: `${Math.max(2, (e.total / maxExp) * 100)}%` }} /></div>
                </li>
              ))}
              <li className="flex justify-between text-body font-semibold border-t border-hairline pt-2 num"><span>Total</span><Money value={pnl.operatingExpenses} /></li>
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-headline font-semibold mb-3">Products</h2>
          {r.products.length === 0 ? <p className="text-body text-ink-2">No sales this week.</p> : (
            <table className="w-full text-body num">
              <thead><tr className="text-caption text-ink-2 text-left"><th className="font-medium pb-2">Product</th><th className="font-medium text-right">Sold</th><th className="font-medium text-right">Revenue</th><th className="font-medium text-right">Profit</th></tr></thead>
              <tbody>{r.products.slice(0, 8).map((p) => (
                <tr key={p.product_id} className="border-t border-hairline">
                  <td className="py-2 pr-2 truncate max-w-[140px]">{p.name}</td>
                  <td className="text-right">{p.units}</td>
                  <td className="text-right"><Money value={p.revenue} compact /></td>
                  <td className="text-right">{p.missing_lines ? <span className="text-warning">—</span> : <Money value={p.gross_profit} compact />}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}

function Line({ l, v, trend, strong, sub }: { l: string; v: React.ReactNode; trend?: React.ReactNode; strong?: boolean; sub?: React.ReactNode }) {
  return (
    <div className={cn("py-2 border-t border-hairline first:border-0 flex justify-between gap-3", strong && "font-semibold")}>
      <dt className={strong ? "" : "text-ink-2"}>{l}</dt>
      <dd className="text-right">{v}{(trend || sub) && <span className="flex justify-end text-caption font-normal">{trend ?? sub}</span>}</dd>
    </div>
  );
}
