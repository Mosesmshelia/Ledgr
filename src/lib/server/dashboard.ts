import "server-only";
import type { Ctx } from "./session";
import {
  calculatePnl, comparePeriods, resolvePeriod, previousComparable, todayIn, addDays, startOfWeek, startOfMonth, endOfMonth, addMonths,
  buckets, bucketSeries, businessSummary, ageing, calculateCashFlow, calculateMonthEndEstimate, calculateBreakEven,
  type PeriodKey, type PnlInputs, type CashAccountRow, type DayRow,
} from "@/lib/finance";

const PERIOD_WORD: Record<string, [string, string]> = {
  today: ["today", "yesterday"], this_week: ["this week", "last week"], this_month: ["this month", "last month"],
  last_month: ["last month", "the month before"], custom: ["in this period", "the previous period"],
};

export async function loadDashboard(ctx: Ctx, key: PeriodKey, custom?: { from: string; to: string }) {
  const b = ctx.business.id;
  const tz = ctx.business.timezone;
  const today = todayIn(tz);
  const period = resolvePeriod(key, today, ctx.business.week_start, custom);
  const prev = previousComparable(period);
  const seriesFrom = startOfMonth(addMonths(today, -11));
  const beFrom = addDays(today, -29);

  const [cur, before, cashRows, cashPrevRows, recRows, payRows, inv, exp, perf, series, targets, mtd, monthOpex, trailing, monthFixed] = await ctx.db(async (db) => {
    const one = async <T,>(sql: string, p: unknown[]) => (await db.query(sql, p)).rows as T[];
    // One connection runs queries one at a time; run them in order.
    const sequential = async <T extends unknown[]>(jobs: { [K in keyof T]: () => Promise<T[K]> }) => {
      const out: unknown[] = [];
      for (const j of jobs) out.push(await j());
      return out as T;
    };
    return sequential([
      () => one<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, period.from, period.to]),
      () => one<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, prev.from, prev.to]),
      () => one<CashAccountRow>("select * from fin_cash_accounts($1,$2,$3)", [b, period.from, period.to]),
      () => one<CashAccountRow>("select * from fin_cash_accounts($1,$2,$3)", [b, prev.from, prev.to]),
      () => one<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_receivables($1,$2)", [b, today]),
      () => one<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_payables($1,$2)", [b, today]),
      () => one<{ product_id: string; value: number; low_stock: boolean; name: string; on_hand: number; unit: string; is_sellable: boolean }>("select * from fin_inventory($1)", [b]),
      () => one<{ category_id: string; name: string; total: number; kind: string }>("select * from fin_expense_breakdown($1,$2,$3)", [b, period.from, period.to]),
      () => one<{ product_id: string; name: string; units: number; revenue: number; cogs: number; gross_profit: number; missing_lines: number }>("select * from fin_product_performance($1,$2,$3)", [b, period.from, period.to]),
      () => one<DayRow>("select * from fin_daily_series($1,$2,$3)", [b, seriesFrom, today]),
      () => one<{ kind: string; amount: number }>("select distinct on (kind) kind, amount from targets where business_id = $1 and effective_from <= $2 order by kind, effective_from desc", [b, today]),
      () => one<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, startOfMonth(today), today]),
      () => one<{ total: number }>("select coalesce(sum(total),0)::bigint total from fin_expense_breakdown($1,$2,$3) where kind = 'operating'", [b, startOfMonth(today), endOfMonth(today)]),
      () => one<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, beFrom, today]),
      () => one<{ total: number }>("select coalesce(sum(monthly_equivalent),0)::bigint total from fin_recurring_status($1,$2) where end_date is null or end_date >= $2", [b, today]),
    ]);
  });

  const pnl = calculatePnl(cur[0].r);
  const pnlPrev = calculatePnl(before[0].r);
  const cash = calculateCashFlow(cashRows);
  const cashPrev = calculateCashFlow(cashPrevRows);
  const receivables = ageing(recRows);
  const payables = ageing(payRows);
  const inventoryValue = inv.reduce((a, r) => a + r.value, 0);
  const lowStock = inv.filter((r) => r.low_stock && r.is_sellable);

  // Trend charts at three granularities. Leading empty buckets (before the business had data) are dropped.
  const firstActive = series.find((d) => d.revenue !== 0 || d.opex !== 0 || d.cash_in !== 0 || d.cash_out !== 0)?.day ?? today;
  const ws = ctx.business.week_start;
  const trends = {
    daily: bucketSeries(series, buckets(addDays(today, -29), today, "day", ws)),
    weekly: bucketSeries(series, buckets(addDays(startOfWeek(today, ws), -7 * 11), today, "week", ws)),
    monthly: bucketSeries(series, buckets(seriesFrom, today, "month", ws)),
  };
  for (const k of Object.keys(trends) as (keyof typeof trends)[]) {
    const idx = trends[k].findIndex((x) => x.to >= firstActive);
    trends[k] = trends[k].slice(Math.max(0, idx));
  }

  const target = (k: string) => targets.find((t) => t.kind === k)?.amount ?? null;
  const mtdPnl = calculatePnl(mtd[0].r);
  const weekToDate = series.filter((d) => d.day >= startOfWeek(today, ws)).reduce((a, d) => a + d.revenue, 0);
  // A day is too short for a target, so "Today" shows the week's progress.
  const salesTarget = key === "this_week" || key === "today"
    ? { label: "Weekly sales target", amount: target("weekly_sales"), current: weekToDate }
    : { label: "Monthly sales target", amount: target("monthly_sales"), current: mtdPnl.revenue };

  const estimate = calculateMonthEndEstimate({
    today, monthStart: startOfMonth(today), mtdGrossProfit: mtdPnl.grossProfit, monthOperatingExpenses: monthOpex[0].total,
    otherNet: mtdPnl.otherIncome - mtdPnl.otherExpense - mtdPnl.incomeTax,
  });
  const trailingPnl = calculatePnl(trailing[0].r);
  const breakEven = calculateBreakEven(monthFixed[0].total, trailingPnl.grossMargin);

  const operating = exp.filter((e) => e.kind === "operating");
  const byRevenue = [...perf].sort((a, z) => z.revenue - a.revenue);
  const byProfit = perf.filter((p) => p.missing_lines === 0).sort((a, z) => z.gross_profit - a.gross_profit);
  const [word, prevWord] = PERIOD_WORD[key] ?? PERIOD_WORD.custom;
  const summary = businessSummary({
    periodWord: word, prevWord, pnl, prev: pnlPrev,
    topExpense: operating[0] ? { name: operating[0].name, amount: operating[0].total } : null,
    topRevenueProduct: byRevenue[0] ? { name: byRevenue[0].name, revenue: byRevenue[0].revenue } : null,
    topProfitProduct: byProfit[0] ? { name: byProfit[0].name, profit: byProfit[0].gross_profit } : null,
    receivables: { total: receivables.total, overdue: receivables.overdue },
  });

  return {
    today, period, prev, pnl, pnlPrev, word,
    compare: {
      revenue: comparePeriods(pnl.revenue, pnlPrev.revenue),
      grossProfit: comparePeriods(pnl.grossProfit, pnlPrev.grossProfit, { profitLike: true }),
      opex: comparePeriods(pnl.operatingExpenses, pnlPrev.operatingExpenses),
      netProfit: comparePeriods(pnl.netProfit, pnlPrev.netProfit, { profitLike: true }),
      cash: comparePeriods(cash.closing, cashPrev.closing),
    },
    cash, cashAccounts: cashRows,
    receivables, payables, inventoryValue, lowStock,
    expenses: operating,
    topProducts: byRevenue.slice(0, 6),
    trends,
    salesTarget,
    estimate,
    breakEven: { ...breakEven, mtdRevenue: mtdPnl.revenue, windowDays: 30 },
    summary,
  };
}

export type Dashboard = Awaited<ReturnType<typeof loadDashboard>>;
