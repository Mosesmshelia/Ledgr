import { Receipt, Repeat } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { Badge, Card, EmptyState, Money, PageHeader, cn } from "@/components/ui/primitives";
import { PeriodSelector } from "@/components/app/period-selector";
import { parsePeriodParams } from "@/lib/period-params";
import { formatDate, formatRange, resolvePeriod, todayIn, type PeriodKey } from "@/lib/finance";
import { AddExpenseTrigger, RecurringActions, AddRecurringButton, ExpenseRowMenu } from "./expense-client";
import { readListParams, Where, orderAndPage, pageOf, like } from "@/lib/server/list";
import { ListControls, Pager } from "@/components/app/list-controls";

export const metadata = { title: "Expenses" };
const FREQ: Record<string, string> = { daily: "a day", weekly: "a week", monthly: "a month", quarterly: "a quarter", annual: "a year" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const lp = readListParams(sp, { sort: "date" });
  const { key, custom } = parsePeriodParams(sp, "this_month");
  const today = todayIn(ctx.business.timezone);
  const period = resolvePeriod(key as PeriodKey, today, ctx.business.week_start, custom);
  const b = ctx.business.id;
  const w = new Where("e.business_id = ?", b).add("e.date between ? and ?", period.from, period.to);
  if (lp.q) w.add("(e.name ilike ? or e.vendor ilike ? or c.name ilike ?)", like(lp.q), like(lp.q), like(lp.q));
  if (lp.cat && /^[0-9a-f-]{36}$/.test(String(lp.cat))) w.add("e.category_id = ?", lp.cat);
  if (lp.state === "voided") w.add("e.voided_at is not null");
  if (lp.state === "active") w.add("e.voided_at is null");
  const order = orderAndPage(lp, { date: "e.date", amount: "e.amount", name: "e.name" }, "date", w, "e.created_at desc");

  const [breakdown, expensesRaw, recurring, categories, accounts] = [
    await ctx.q<{ category_id: string; name: string; one_time: number; recurring: number; total: number; kind: string }>("select * from fin_expense_breakdown($1,$2,$3)", [b, period.from, period.to]),
    await ctx.q<{ id: string; date: string; name: string; category: string; amount: number; vendor: string | null; account: string; voided_at: string | null; void_reason: string | null }>(`
      select e.id, e.date, e.name, c.name category, e.amount, e.vendor, a.name account, e.voided_at, e.void_reason
      from expenses e join expense_categories c on c.id = e.category_id left join cash_accounts a on a.id = e.cash_account_id
      where ${w.sql} ${order}`, w.params),
    await ctx.q<{ recurring_expense_id: string; name: string; category: string; amount: number; frequency: string; start_date: string; end_date: string | null;
      accrued_to_date: number; paid_to_date: number; balance: number; monthly_equivalent: number; weekly_equivalent: number }>("select * from fin_recurring_status($1,$2)", [b, today]),
    await ctx.q<{ id: string; name: string; kind: string; icon: string | null }>("select id, name, kind, icon from expense_categories where business_id = $1 order by sort_order, name", [b]),
    await ctx.q<{ id: string; name: string; type: string }>("select id, name, type from cash_accounts where business_id = $1 and is_active order by created_at", [b]),
  ];
  const { rows: expenses, hasMore, page, pageSize } = pageOf(expensesRaw, lp);
  const filtered = !!(lp.q || lp.cat || lp.state);
  const total = breakdown.filter((x) => x.kind === "operating").reduce((a, x) => a + x.total, 0);
  const max = Math.max(1, ...breakdown.map((x) => x.total));
  const monthlyFixed = recurring.filter((r) => !r.end_date || r.end_date >= today).reduce((a, r) => a + r.monthly_equivalent, 0);

  return (
    <div className="animate-rise">
      <PageHeader title="Expenses" subtitle="What it costs to run the business."
        actions={can(ctx.role, "record") ? <AddExpenseTrigger open={sp.add === "1"} categories={categories} accounts={accounts} today={today} /> : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <PeriodSelector value={key} basePath="/expenses" from={custom?.from} to={custom?.to} today={today} />
        <span className="text-caption text-ink-2">{formatRange(period.from, period.to)}</span>
      </div>

      <div className="grid lg:grid-cols-[1fr_1.3fr] gap-3">
        <Card className="p-5">
          <div className="text-caption font-medium text-ink-2">Operating expenses · {key === "custom" ? formatRange(period.from, period.to) : period.label.toLowerCase()}</div>
          <div className="text-display-sm font-semibold num mt-1"><Money value={total} compact /></div>
          <p className="text-caption text-ink-2 mt-1">Includes each recurring cost&apos;s share for these dates, whether or not you&apos;ve paid it yet.</p>
          <ul className="mt-5 flex flex-col gap-3">
            {breakdown.length === 0 && <li className="text-body text-ink-2">No expenses in this period.</li>}
            {breakdown.map((x) => (
              <li key={x.category_id}>
                <div className="flex justify-between text-body mb-1">
                  <span>{x.name}{x.kind !== "operating" && <span className="text-ink-3"> · not operating</span>}</span>
                  <Money value={x.total} className="font-medium" />
                </div>
                <div className="h-1.5 rounded-full bg-fill overflow-hidden flex gap-[2px]">
                  {x.recurring > 0 && <div className="h-full rounded-full bg-series-2 opacity-60" style={{ width: `${(x.recurring / max) * 100}%` }} title="Recurring share" />}
                  {x.one_time > 0 && <div className="h-full rounded-full bg-series-2" style={{ width: `${(x.one_time / max) * 100}%` }} title="One-time" />}
                </div>
              </li>
            ))}
          </ul>
          {breakdown.some((x) => x.recurring > 0) && (
            <div className="flex gap-4 mt-4 text-caption text-ink-2">
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-series-2" />One-time</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-series-2 opacity-60" />Recurring share</span>
            </div>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="px-5 pt-4 pb-2 flex items-baseline justify-between">
            <h2 className="text-headline font-semibold">One-time expenses</h2>
          </div>
          <div className="px-5">
            <ListControls search="Search name, vendor or category" dates={false} keep={["period", "from", "to"]}
              filters={[
                { param: "state", label: "Status", options: [{ value: "active", label: "Active" }, { value: "voided", label: "Voided" }] },
                { param: "cat", label: "Category", allLabel: "All categories", options: categories.filter((c) => breakdown.some((x) => x.category_id === c.id)).map((c) => ({ value: c.id, label: c.name })) },
              ]}
              sorts={[{ value: "date:asc", label: "Oldest first" }, { value: "amount:desc", label: "Largest first" }, { value: "amount:asc", label: "Smallest first" }, { value: "name:asc", label: "Name A–Z" }]} />
          </div>
          {expenses.length === 0 && filtered ? (
            <EmptyState icon={<Receipt size={22} />} title="No matching expenses" body="Try a different search or filter, or pick another period above." />
          ) : expenses.length === 0 ? (
            <EmptyState icon={<Receipt size={22} />} title="Nothing recorded" body="Fuel, transport, repairs, supplies — tap Add expense to record one in seconds." />
          ) : (
            <ul>
              {expenses.map((e) => (
                <li key={e.id} className={cn("flex items-center gap-3 px-5 py-3 border-t border-hairline", e.voided_at && "text-ink-3")}>
                  <div className="min-w-0 flex-1">
                    <div className="text-body truncate">{e.name}</div>
                    <div className="text-caption text-ink-2 truncate">{e.category}{e.vendor && ` · ${e.vendor}`} · {e.account} · {formatDate(e.date)}</div>
                    {e.voided_at && <div className="text-caption">Voided: {e.void_reason}</div>}
                  </div>
                  <Money value={e.amount} className={cn("font-medium", e.voided_at && "line-through")} />
                  {!e.voided_at && can(ctx.role, "void") && <ExpenseRowMenu id={e.id} amount={e.amount} />}
                </li>
              ))}
            </ul>
          )}
          <div className="px-5 pb-3 empty:hidden"><Pager page={page} hasMore={hasMore} shown={expenses.length} pageSize={pageSize} /></div>
        </Card>
      </div>

      <Card className="mt-3 overflow-hidden">
        <div className="px-5 pt-4 pb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-headline font-semibold flex items-center gap-2"><Repeat size={17} className="text-ink-2" />Recurring expenses</h2>
            <p className="text-caption text-ink-2 mt-0.5">About <Money value={monthlyFixed} className="text-ink font-medium" /> a month. Spread day by day, so paying a year&apos;s rent upfront doesn&apos;t make one month look terrible.</p>
          </div>
          {can(ctx.role, "record") && <AddRecurringButton categories={categories} accounts={accounts} today={today} />}
        </div>
        {recurring.length === 0 ? (
          <EmptyState icon={<Repeat size={22} />} title="No recurring expenses" body="Add rent, salaries, diesel and other regular costs so your profit is accurate every week." />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="w-full text-body min-w-[680px]">
              <thead><tr className="text-caption text-ink-2 text-left"><th className="font-medium py-2.5 pl-5">Expense</th><th className="font-medium text-right">Amount</th><th className="font-medium text-right">Per month</th><th className="font-medium text-right">Per week</th><th className="font-medium text-right">Paid vs used</th><th className="pr-5" /></tr></thead>
              <tbody>
                {recurring.map((r) => (
                  <tr key={r.recurring_expense_id} className="border-t border-hairline">
                    <td className="py-3 pl-5"><div>{r.name}</div><div className="text-caption text-ink-3">{r.category} · since {formatDate(r.start_date, true)}{r.end_date && ` · ends ${formatDate(r.end_date, true)}`}</div></td>
                    <td className="text-right num"><Money value={r.amount} /> <span className="text-caption text-ink-2">{FREQ[r.frequency]}</span></td>
                    <td className="text-right num"><Money value={r.monthly_equivalent} /></td>
                    <td className="text-right num text-ink-2"><Money value={r.weekly_equivalent} /></td>
                    <td className="text-right">
                      {r.balance > 0 ? <Badge tone="accent"><Money value={r.balance} compact /> prepaid</Badge> : r.balance < 0 ? <Badge tone="warning"><Money value={-r.balance} compact /> owed</Badge> : <Badge tone="positive">Up to date</Badge>}
                    </td>
                    <td className="pr-5 text-right">{can(ctx.role, "record") && <RecurringActions r={{ id: r.recurring_expense_id, name: r.name, amount: r.amount, owed: Math.max(0, -r.balance) }} accounts={accounts} today={today} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
