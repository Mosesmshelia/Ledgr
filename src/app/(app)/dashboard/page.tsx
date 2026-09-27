import Link from "next/link";
import { ChevronRight, PackageOpen, ShoppingCart, Sparkles, Target } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { loadDashboard } from "@/lib/server/dashboard";
import { PeriodSelector } from "@/components/app/period-selector";
import { parsePeriodParams } from "@/lib/period-params";
import { TrendSection } from "@/components/app/charts-lazy";
import { MetricCard, StatusNote } from "@/components/ui/metric";
import { ButtonLink, Card, EmptyState, Money, Percent, cn } from "@/components/ui/primitives";
import { formatMoney, formatPercent, formatRange } from "@/lib/finance";
import { listAlerts, refreshAlerts } from "@/lib/server/alerts";
import { AlertsCard } from "@/components/app/alerts";
import { SalesHome } from "./sales-home";
import { GettingStarted } from "./getting-started";
import { can } from "@/lib/permissions";

export const metadata = { title: "Dashboard" };

function greeting(tz: string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: tz }).format(new Date()));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string; from?: string; to?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.canSeeCosts) return <SalesHome ctx={ctx} />;
  const sp = await searchParams;
  const { key, custom } = parsePeriodParams(sp, "this_week");
  const d = await loadDashboard(ctx, key, custom);
  await refreshAlerts(ctx); // usually instant (throttled / already running from the layout)
  const alerts = await listAlerts(ctx);
  const { pnl } = d;
  const vs = d.prev.label;
  const hasData = pnl.salesCount > 0 || d.trends.weekly.some((w) => w.revenue > 0);
  const range = `period=custom&from=${d.period.from}&to=${d.period.to}`;
  const tone = { positive: "text-positive", negative: "text-negative", warning: "text-warning", neutral: "" } as const;

  return (
    <div className="animate-rise">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
        <div className="min-w-0">
          <h1 className="text-title sm:text-[1.75rem] sm:leading-9 font-semibold tracking-tight">
            {greeting(ctx.business.timezone)}{ctx.displayName ? `, ${ctx.displayName}` : ""}
          </h1>
          <p className="text-body text-ink-2 mt-0.5">
            Here&apos;s how {ctx.business.name} is doing {d.word} <span className="text-ink-3 whitespace-nowrap">· {formatRange(d.period.from, d.period.to)}</span>
          </p>
        </div>
        <PeriodSelector value={key} basePath="/dashboard" from={custom?.from} to={custom?.to} today={d.today} />
      </div>

      <div className="mb-3 empty:hidden"><AlertsCard alerts={alerts} /></div>

      {!hasData ? (
        can(ctx.role, "record") ? <GettingStarted ctx={ctx} /> : (
          <Card><EmptyState icon={<ShoppingCart size={22} />} title="No sales yet" body="Once sales are recorded, revenue, profit and cash will appear here." /></Card>
        )
      ) : (
        <>
          {pnl.status !== "complete" && (
            <div className="mb-4"><StatusNote status={pnl.status} note={pnl.statusNote} href="/sales?status=missing" /></div>
          )}

          {/* Hero metrics */}
          <section aria-label="Key figures" className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <MetricCard label="Revenue" value={pnl.revenue} comparison={d.compare.revenue} vs={vs}
              sub={`${pnl.salesCount} sale${pnl.salesCount === 1 ? "" : "s"}`}
              explain={pnl.metrics.revenue.explain} steps={pnl.metrics.revenue.steps} href={`/sales?${range}`} />
            <MetricCard label="Gross profit" value={pnl.grossProfit} tone="profit" comparison={d.compare.grossProfit} vs={vs}
              sub={<><Percent value={pnl.grossMargin} /> margin · goods cost <Money value={pnl.cogs} compact /></>} status={pnl.status} note={pnl.statusNote}
              explain={pnl.metrics.grossProfit.explain} steps={pnl.metrics.grossProfit.steps} href={`/sales?${range}`} />
            <MetricCard label="Operating expenses" value={pnl.operatingExpenses} comparison={d.compare.opex} vs={vs} higherIsBetter={false}
              sub={pnl.revenue > 0 ? <>{formatPercent(pnl.operatingExpenses / pnl.revenue, 0)} of revenue</> : "Rent, fuel, salaries…"}
              explain={pnl.metrics.operatingExpenses.explain} steps={pnl.metrics.operatingExpenses.steps} href={`/expenses?${range}`} />
            <MetricCard label="Net profit" value={pnl.netProfit} tone="profit" comparison={d.compare.netProfit} vs={vs}
              sub={<><Percent value={pnl.netMargin} /> margin</>} status={pnl.status} note={pnl.statusNote}
              explain={pnl.metrics.netProfit.explain} steps={pnl.metrics.netProfit.steps} href={`/reports/pnl?${range}`} />
            <div className="col-span-2 lg:col-span-1">
              <MetricCard label="Money you have" value={d.cash.closing} comparison={d.compare.cash} vs={vs}
                sub={`Across ${d.cashAccounts.length} account${d.cashAccounts.length === 1 ? "" : "s"}`}
                explain="Cash in hand, bank and POS balances at the end of this period."
                steps={[
                  { label: "Opening balance", amount: d.cash.opening },
                  { label: "Money in", amount: d.cash.cashIn, op: "+" },
                  { label: "Money out", amount: d.cash.cashOut, op: "−" },
                  { label: "Closing balance", amount: d.cash.closing, op: "=" },
                  ...d.cashAccounts.map((a) => ({ label: `· ${a.name}`, amount: a.closing })),
                ]}
                href={`/money?tab=cashflow&${range}`} />
            </div>
          </section>

          {/* Secondary metrics */}
          <section aria-label="Balances" className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
            <Secondary href="/money?tab=receivables" label="Customers owe you" value={d.receivables.total}
              sub={d.receivables.overdue > 0 ? <span className="text-negative">{formatMoney(d.receivables.overdue, { compact: true })} overdue</span> : "Nothing overdue"} />
            <Secondary href="/money?tab=payables" label="You owe suppliers" value={d.payables.total}
              sub={d.payables.overdue > 0 ? <span className="text-negative">{formatMoney(d.payables.overdue, { compact: true })} overdue</span> : `${d.payables.count} open bill${d.payables.count === 1 ? "" : "s"}`} />
            <Secondary href="/inventory" label="Stock value" value={d.inventoryValue}
              sub={d.lowStock.length ? <span className="text-warning">{d.lowStock.length} running low</span> : "Stock levels OK"} />
            <TargetCard {...d.salesTarget} canSet={can(ctx.role, "settings")} />
          </section>

          {/* Plain-English insight */}
          {d.summary.length > 0 && (
            <Card className="mt-3 p-5">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h2 className="text-headline font-semibold flex items-center gap-2"><Sparkles size={17} className="text-accent" />In a nutshell</h2>
                <Link href={key === "this_week" || key === "today" ? "/reports/weekly" : `/reports/pnl?${range}`} className="tap text-caption text-accent font-medium">
                  {key === "this_week" || key === "today" ? "Weekly report" : "Full P&L"}
                </Link>
              </div>
              <p className="text-body leading-7 text-ink max-w-4xl">
                {d.summary.map((s) => <span key={s.key} className={cn(tone[s.tone ?? "neutral"])}>{s.text} </span>)}
              </p>
              <p className="text-caption text-ink-3 mt-2">Written from your recorded numbers only. No guesses.</p>
            </Card>
          )}

          <TrendSection trends={d.trends} />

          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <Card className="p-5">
              <h2 className="text-headline font-semibold">Estimated month-end profit</h2>
              <p className="text-caption text-ink-2 mt-0.5">If the rest of the month goes like the first {d.estimate.daysElapsed} day{d.estimate.daysElapsed === 1 ? "" : "s"}.</p>
              <div className={cn("text-display-sm font-semibold num mt-4", d.estimate.value < 0 && "text-negative")}><Money value={d.estimate.value} compact /></div>
              <div className="text-caption text-ink-3">Estimate · not an actual result</div>
              <dl className="mt-4 text-caption flex flex-col gap-2 num">
                <Row l="Gross profit so far" v={<Money value={d.estimate.mtdGrossProfit} />} />
                <Row l={`At this pace, for ${d.estimate.daysInMonth} days`} v={<Money value={d.estimate.projectedGrossProfit} />} />
                <Row l="Month's operating expenses" v={<>−<Money value={d.estimate.monthOperatingExpenses} /></>} />
                {d.estimate.otherNet !== 0 && <Row l="Other items so far" v={<Money value={d.estimate.otherNet} signed />} />}
              </dl>
            </Card>

            <Card className="p-5">
              <h2 className="text-headline font-semibold flex items-center gap-2"><Target size={17} className="text-ink-2" />Break-even</h2>
              {d.breakEven.breakEvenRevenue === null ? (
                <p className="text-body text-ink-2 mt-3">{d.breakEven.reason}</p>
              ) : (
                <>
                  <p className="text-body mt-2">
                    You need about <span className="font-semibold num"><Money value={d.breakEven.breakEvenRevenue} /></span> in sales each month to cover your fixed operating costs.
                  </p>
                  {(() => {
                    const pct = d.breakEven.mtdRevenue / d.breakEven.breakEvenRevenue!;
                    return (
                      <>
                        <div className="h-2 rounded-full bg-fill mt-4 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to break-even this month">
                          <div className={cn("h-full rounded-full", pct >= 1 ? "bg-positive" : "bg-accent")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
                        </div>
                        <p className="text-caption text-ink-2 mt-1.5 num">
                          {pct >= 1 ? <>Covered. You&apos;re <Money value={d.breakEven.mtdRevenue - d.breakEven.breakEvenRevenue!} /> past break-even this month.</> : <><Money value={d.breakEven.mtdRevenue} /> sold so far this month ({formatPercent(pct, 0)}).</>}
                        </p>
                      </>
                    );
                  })()}
                  <dl className="mt-4 text-caption flex flex-col gap-2 num">
                    <Row l="Fixed costs per month (recurring)" v={<Money value={d.breakEven.fixedCosts} />} />
                    <Row l={`Gross margin (last ${d.breakEven.windowDays} days)`} v={formatPercent(d.breakEven.grossMarginRatio, 1)} />
                    <Row l="Fixed costs ÷ margin" v={<Money value={d.breakEven.breakEvenRevenue} />} />
                  </dl>
                </>
              )}
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-3 mt-3">
            <Card className="p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-headline font-semibold">Sales by product</h2>
                <Link href={`/reports/products?${range}`} className="tap text-caption text-accent font-medium">All products</Link>
              </div>
              {d.topProducts.length === 0 ? <p className="text-body text-ink-2 py-6">No sales in this period.</p> : (
                <ul className="flex flex-col gap-3">
                  {d.topProducts.map((p) => {
                    const max = d.topProducts[0].revenue || 1;
                    return (
                      <li key={p.product_id}>
                        <Link href={`/inventory/products/${p.product_id}`} className="block group">
                          <div className="flex justify-between gap-3 text-body">
                            <span className="truncate group-hover:text-accent">{p.name}</span>
                            <Money value={p.revenue} className="font-medium" />
                          </div>
                          <div className="h-1.5 rounded-full bg-fill overflow-hidden mt-1">
                            <div className="h-full rounded-full bg-series-1" style={{ width: `${Math.max(2, (p.revenue / max) * 100)}%` }} />
                          </div>
                          <div className="flex justify-between text-caption text-ink-2 mt-1 num">
                            <span>{p.units.toLocaleString()} sold</span>
                            {p.missing_lines > 0 ? <span className="text-warning">Profit unavailable</span> : <span><Money value={p.gross_profit} /> profit · {formatPercent(p.revenue ? p.gross_profit / p.revenue : null, 0)}</span>}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card className="p-5">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-headline font-semibold">Expenses by category</h2>
                <Link href={`/expenses?${range}`} className="tap text-caption text-accent font-medium">All expenses</Link>
              </div>
              {d.expenses.length === 0 ? <p className="text-body text-ink-2 py-6">No expenses in this period.</p> : (
                <ul className="flex flex-col gap-3">
                  {d.expenses.slice(0, 7).map((e) => {
                    const max = d.expenses[0].total || 1;
                    return (
                      <li key={e.category_id}>
                        <div className="flex justify-between text-body mb-1"><span>{e.name}</span>
                          <span className="num"><Money value={e.total} className="font-medium" /> <span className="text-caption text-ink-3">{formatPercent(pnl.operatingExpenses ? e.total / pnl.operatingExpenses : null, 0)}</span></span>
                        </div>
                        <div className="h-1.5 rounded-full bg-fill overflow-hidden">
                          <div className="h-full rounded-full bg-series-2" style={{ width: `${Math.max(2, (e.total / max) * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>

          {d.lowStock.length > 0 && (
            <Card className="p-5 mt-3">
              <div className="flex items-center gap-2 mb-2"><PackageOpen size={18} className="text-warning" /><h2 className="text-headline font-semibold">Running low</h2></div>
              <div className="flex flex-wrap gap-2">
                {d.lowStock.map((p) => (
                  <Link key={p.product_id} href={`/inventory/products/${p.product_id}`} className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-warning-soft text-caption">
                    <span className="text-ink">{p.name}</span><span className="text-warning font-medium num">{p.on_hand} left</span>
                  </Link>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Row({ l, v }: { l: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-3"><dt className="text-ink-2">{l}</dt><dd>{v}</dd></div>;
}

function Secondary({ href, label, value, sub }: { href: string; label: string; value: number; sub: React.ReactNode }) {
  return (
    <Link href={href} className="group bg-surface rounded-[16px] border border-hairline p-4 hover:border-hairline-strong transition-colors">
      <div className="flex items-center justify-between text-caption font-medium text-ink-2">{label}<ChevronRight size={15} className="text-ink-3 group-hover:translate-x-0.5 transition-transform" /></div>
      <div className="text-title font-semibold num mt-1.5"><Money value={value} compact /></div>
      <div className="text-caption text-ink-2 mt-0.5">{sub}</div>
    </Link>
  );
}

function TargetCard({ label, amount, current, canSet }: { label: string; amount: number | null; current: number; canSet: boolean }) {
  if (!amount) {
    return (
      <div className="bg-surface rounded-[16px] border border-hairline p-4">
        <div className="text-caption font-medium text-ink-2">Sales target</div>
        <div className="text-body text-ink-2 mt-2">No target set yet.</div>
        {canSet && <Link href="/settings?tab=targets" className="tap text-caption text-accent font-medium">Set a target</Link>}
      </div>
    );
  }
  const pct = current / amount;
  return (
    <div className="bg-surface rounded-[16px] border border-hairline p-4">
      <div className="text-caption font-medium text-ink-2">{label}</div>
      <div className="text-title font-semibold num mt-1.5">{formatPercent(pct, 0)}</div>
      <div className="h-1.5 rounded-full bg-fill mt-2 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={cn("h-full rounded-full", pct >= 1 ? "bg-positive" : "bg-accent")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
      </div>
      <div className="text-caption text-ink-2 mt-1.5 num"><Money value={current} compact /> of <Money value={amount} compact /></div>
    </div>
  );
}
