// Home for people who can't see costs (the Sales role): their own selling, the team's progress to
// target, and customers who owe money — never costs or profit.
import Link from "next/link";
import { ChevronRight, ShoppingCart, Target, Clock } from "lucide-react";
import type { Ctx } from "@/lib/server/session";
import { ButtonLink, Card, Money, Badge, EmptyState, cn, invoiceStatus } from "@/components/ui/primitives";
import { todayIn, startOfWeek, startOfMonth, formatPercent, formatDate } from "@/lib/finance";
import { saleStatus } from "@/lib/server/queries";
import { can } from "@/lib/permissions";

export async function SalesHome({ ctx }: { ctx: Ctx }) {
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  const week = startOfWeek(today, ctx.business.week_start);
  const month = startOfMonth(today);
  // Revenue = net of VAT, minus returns (the same definition the owner sees).
  const REV = "s.net - coalesce((select sum(r.net_total) from sale_returns r where r.sale_id = s.id and r.voided_at is null), 0)";
  const from = month < week ? month : week;
  const [mine] = await ctx.q<{ today: number; today_n: number; week: number; week_n: number; month: number; month_n: number }>(`
    with x as (
      select s.date, ${REV} rev from sales s
      where s.business_id = $1 and s.salesperson_id = $2 and s.voided_at is null and s.date between $5 and $3
    )
    select coalesce(sum(rev) filter (where date = $3), 0)::bigint as today, count(*) filter (where date = $3)::int as today_n,
           coalesce(sum(rev) filter (where date >= $4), 0)::bigint as week, count(*) filter (where date >= $4)::int as week_n,
           coalesce(sum(rev) filter (where date >= $6), 0)::bigint as month, count(*) filter (where date >= $6)::int as month_n
    from x`, [b, ctx.userId, today, week, from, month]);
  const [team] = await ctx.q<{ week: number }>(
    `select coalesce(sum(${REV}), 0)::bigint as week from sales s where s.business_id = $1 and s.voided_at is null and s.date between $2 and $3`, [b, week, today]);
  const [target] = await ctx.q<{ amount: number }>(
    "select amount from targets where business_id = $1 and kind = 'weekly_sales' and effective_from <= $2 order by effective_from desc limit 1", [b, today]);
  const recent = await ctx.q<{ id: string; invoice_no: string; date: string; due_date: string; customer_name: string; total: number; outstanding: number; paid: number; voided_at: string | null }>(`
    select s.id, s.invoice_no, s.date, s.due_date, c.name customer_name, s.total, s.voided_at,
      app_sale_outstanding(s.id) outstanding, app_sale_paid(s.id) paid
    from sales s join customers c on c.id = s.customer_id
    where s.business_id = $1 and s.salesperson_id = $2 order by s.date desc, s.created_at desc limit 8`, [b, ctx.userId]);
  const owing = await ctx.q<{ id: string; invoice_no: string; customer_name: string; outstanding: number; due_date: string }>(`
    select s.id, s.invoice_no, c.name customer_name, app_sale_outstanding(s.id) outstanding, s.due_date
    from sales s join customers c on c.id = s.customer_id
    where s.business_id = $1 and s.voided_at is null and not c.is_walk_in and s.due_date < $2 and app_sale_outstanding(s.id) > 0
    order by s.due_date limit 6`, [b, today]);

  const pct = target ? team.week / target.amount : null;
  const first = ctx.displayName ? `, ${ctx.displayName}` : "";

  return (
    <div className="animate-rise max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 className="text-title sm:text-[1.75rem] sm:leading-9 font-semibold tracking-tight">Hello{first}</h1>
          <p className="text-body text-ink-2 mt-0.5">Your sales at {ctx.business.name}</p>
        </div>
        {can(ctx.role, "sell") && <ButtonLink href="/sales/new" size="lg"><ShoppingCart size={17} />New sale</ButtonLink>}
      </div>

      <section aria-label="Your sales" className="grid grid-cols-3 gap-3">
        {([["Today", mine.today, mine.today_n], ["This week", mine.week, mine.week_n], ["This month", mine.month, mine.month_n]] as const).map(([l, v, n]) => (
          <Card key={l} className="p-4">
            <div className="text-caption font-medium text-ink-2">{l}</div>
            <div className="text-title font-semibold num mt-1"><Money value={v} compact /></div>
            <div className="text-caption text-ink-3 num">{n} sale{n === 1 ? "" : "s"}</div>
          </Card>
        ))}
      </section>

      <Card className="p-5 mt-3">
        <h2 className="text-headline font-semibold flex items-center gap-2"><Target size={17} className="text-ink-2" />Team target this week</h2>
        {pct === null ? <p className="text-body text-ink-2 mt-2">No weekly target set yet. Ask the owner to set one.</p> : (
          <>
            <div className="flex items-baseline justify-between mt-3">
              <span className="text-display-sm font-semibold num">{formatPercent(pct, 0)}</span>
              <span className="text-caption text-ink-2 num"><Money value={team.week} compact /> of <Money value={target!.amount} compact /></span>
            </div>
            <div className="h-2 rounded-full bg-fill mt-2 overflow-hidden" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Team target this week">
              <div className={cn("h-full rounded-full", pct >= 1 ? "bg-positive" : "bg-accent")} style={{ width: `${Math.min(100, pct * 100)}%` }} />
            </div>
          </>
        )}
      </Card>

      <div className="grid lg:grid-cols-2 gap-3 mt-3">
        <Card className="p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-headline font-semibold">Your recent sales</h2>
            <Link href="/sales" className="tap text-caption text-accent font-medium">All sales</Link>
          </div>
          {recent.length === 0 ? <EmptyState icon={<ShoppingCart size={20} />} title="No sales yet" body="Sales you record will show here." /> : (
            <ul className="divide-y divide-hairline">
              {recent.map((r) => {
                const st = invoiceStatus[saleStatus(r, today)];
                return (
                  <li key={r.id}>
                    <Link href={`/sales/${r.id}`} className="flex items-center gap-3 py-2.5 group">
                      <span className="flex-1 min-w-0">
                        <span className="block text-body truncate">{r.customer_name}</span>
                        <span className="block text-caption text-ink-2 num whitespace-nowrap">{r.invoice_no} · {formatDate(r.date)}{st.label !== "Paid" && <span className="sm:hidden"> · {st.label}</span>}</span>
                      </span>
                      <Badge tone={st.tone} className="hidden sm:inline-flex">{st.label}</Badge>
                      <Money value={r.total} className="num text-body text-right" />
                      <ChevronRight size={16} className="text-ink-3" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <h2 className="text-headline font-semibold flex items-center gap-2 mb-1"><Clock size={17} className="text-ink-2" />Customers to follow up</h2>
          {owing.length === 0 ? <p className="text-body text-ink-2 mt-2">No overdue invoices. Nice.</p> : (
            <ul className="divide-y divide-hairline">
              {owing.map((o) => (
                <li key={o.id}>
                  <Link href={`/sales/${o.id}`} className="flex items-center gap-3 py-2.5">
                    <span className="flex-1 min-w-0">
                      <span className="block text-body truncate">{o.customer_name}</span>
                      <span className="block text-caption text-negative num">{o.invoice_no} · due {formatDate(o.due_date)}</span>
                    </span>
                    <Money value={o.outstanding} className="num text-body" />
                    <ChevronRight size={16} className="text-ink-3" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
