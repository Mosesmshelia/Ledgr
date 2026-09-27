import "server-only";
import type { Ctx } from "./session";
import {
  addDays, ageing, businessSummary, calculateCashFlow, calculatePnl, comparePeriods, previousComparable, startOfWeek, todayIn,
  type CashAccountRow, type Period, type PnlInputs,
} from "@/lib/finance";

export interface ExpenseRow { category_id: string; name: string; kind: string; one_time: number; recurring: number; total: number }
export interface ProductRow { product_id: string; name: string; units: number; revenue: number; cogs: number; gross_profit: number; missing_lines: number; estimated_lines: number }

/** Everything a P&L needs for one period and its comparison period. */
export async function loadPnl(ctx: Ctx, period: Period, prev: Period) {
  const b = ctx.business.id;
  const [[cur], [before], exp, expPrev] = [
    await ctx.q<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, period.from, period.to]),
    await ctx.q<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, prev.from, prev.to]),
    await ctx.q<ExpenseRow>("select * from fin_expense_breakdown($1,$2,$3)", [b, period.from, period.to]),
    await ctx.q<ExpenseRow>("select * from fin_expense_breakdown($1,$2,$3)", [b, prev.from, prev.to]),
  ];
  return { pnl: calculatePnl(cur.r), prevPnl: calculatePnl(before.r), expenses: exp, prevExpenses: expPrev };
}

/** The weekly business report (brief §13, §14, §21). `weekStart` is the Monday (or configured start). */
export async function loadWeeklyReport(ctx: Ctx, weekStartParam?: string) {
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  const ws = ctx.business.week_start;
  const thisWeek = startOfWeek(today, ws);
  const start = weekStartParam && /^\d{4}-\d{2}-\d{2}$/.test(weekStartParam) ? startOfWeek(weekStartParam, ws) : thisWeek;
  const safeStart = start > thisWeek ? thisWeek : start;
  const fullEnd = addDays(safeStart, 6);
  const isCurrent = safeStart === thisWeek;
  const end = isCurrent ? today : fullEnd;
  const period: Period = { key: isCurrent ? "this_week" : "last_week", from: safeStart, to: end, label: isCurrent ? "This week" : "Week" };
  const prev = isCurrent ? previousComparable(period) : { key: "custom" as const, from: addDays(safeStart, -7), to: addDays(safeStart, -1), label: "the week before" };

  const { pnl, prevPnl, expenses } = await loadPnl(ctx, period, prev);
  const cashRows = await ctx.q<CashAccountRow>("select * from fin_cash_accounts($1,$2,$3)", [b, period.from, period.to]);
  const rec = ageing(await ctx.q<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_receivables($1,$2)", [b, end]));
  const pay = ageing(await ctx.q<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_payables($1,$2)", [b, end]));
  const products = await ctx.q<ProductRow>("select * from fin_product_performance($1,$2,$3)", [b, period.from, period.to]);
  const cash = calculateCashFlow(cashRows);
  const operating = expenses.filter((e) => e.kind === "operating");
  const byProfit = products.filter((p) => p.missing_lines === 0).sort((a, z) => z.gross_profit - a.gross_profit);
  const prevWord = isCurrent ? "the same days last week" : "the week before";
  const summary = businessSummary({
    periodWord: isCurrent ? "so far this week" : "this week", prevWord, pnl, prev: prevPnl,
    topExpense: operating[0] ? { name: operating[0].name, amount: operating[0].total } : null,
    topRevenueProduct: products[0] ? { name: products[0].name, revenue: products[0].revenue } : null,
    topProfitProduct: byProfit[0] ? { name: byProfit[0].name, profit: byProfit[0].gross_profit } : null,
    receivables: { total: rec.total, overdue: rec.overdue },
  });
  return {
    today, period, prev, isCurrent, fullEnd, prevWeek: addDays(safeStart, -7), nextWeek: isCurrent ? null : addDays(safeStart, 7),
    pnl, prevPnl, cash, cashRows, rec, pay, operating, products, summary,
    compare: {
      revenue: comparePeriods(pnl.revenue, prevPnl.revenue),
      grossProfit: comparePeriods(pnl.grossProfit, prevPnl.grossProfit, { profitLike: true }),
      opex: comparePeriods(pnl.operatingExpenses, prevPnl.operatingExpenses),
      netProfit: comparePeriods(pnl.netProfit, prevPnl.netProfit, { profitLike: true }),
    },
  };
}
