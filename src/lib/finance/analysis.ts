// Comparisons, break-even, month-end estimate, budget variance, cash flow.
import type { Kobo } from "./money";
import { daysInMonth, daysInclusive, type ISODate } from "./periods";

export type Comparison =
  | { kind: "change"; ratio: number; diff: number }   // ratio: +0.124 = up 12.4%
  | { kind: "same" }
  | { kind: "new" }                                     // previous was 0
  | { kind: "none" }                                    // both 0
  | { kind: "turned_profit" } | { kind: "turned_loss" };

/** Like-for-like change between two values. Uses |previous| so a smaller loss reads as an improvement. */
export function comparePeriods(current: number, previous: number, opts: { profitLike?: boolean } = {}): Comparison {
  if (current === previous) return current === 0 ? { kind: "none" } : { kind: "same" };
  if (previous === 0) return current === 0 ? { kind: "none" } : { kind: "new" };
  if (opts.profitLike) {
    if (previous < 0 && current >= 0) return { kind: "turned_profit" };
    if (previous >= 0 && current < 0) return { kind: "turned_loss" };
  }
  return { kind: "change", ratio: (current - previous) / Math.abs(previous), diff: current - previous };
}

export interface BreakEven {
  fixedCosts: Kobo;
  grossMarginRatio: number | null;
  breakEvenRevenue: Kobo | null;
  reason?: string;
}

/** Break-even revenue = fixed operating costs ÷ gross-margin ratio. */
export function calculateBreakEven(fixedCosts: Kobo, grossMarginRatio: number | null): BreakEven {
  if (grossMarginRatio === null) return { fixedCosts, grossMarginRatio, breakEvenRevenue: null, reason: "Not enough sales with known costs to work out your margin yet." };
  if (grossMarginRatio <= 0) return { fixedCosts, grossMarginRatio, breakEvenRevenue: null, reason: "You're selling at or below cost, so no amount of sales covers your expenses." };
  return { fixedCosts, grossMarginRatio, breakEvenRevenue: Math.round(fixedCosts / grossMarginRatio) };
}

/** Per-product break-even in units. */
export function breakEvenUnits(fixedCosts: Kobo, price: Kobo, variableCost: Kobo): number | null {
  const cm = price - variableCost;
  return cm > 0 ? Math.ceil(fixedCosts / cm) : null;
}

export interface MonthEndEstimate {
  value: Kobo;
  mtdGrossProfit: Kobo;
  daysElapsed: number;
  daysInMonth: number;
  projectedGrossProfit: Kobo;
  monthOperatingExpenses: Kobo;
  otherNet: Kobo;
}

/** (MTD gross profit ÷ days elapsed × days in month) − the whole month's operating expenses (+ other items to date). */
export function calculateMonthEndEstimate(args: {
  today: ISODate; monthStart: ISODate; mtdGrossProfit: Kobo; monthOperatingExpenses: Kobo; otherNet?: Kobo;
}): MonthEndEstimate {
  const elapsed = daysInclusive(args.monthStart, args.today);
  const dim = daysInMonth(args.today);
  const projected = Math.round((args.mtdGrossProfit / elapsed) * dim);
  const otherNet = args.otherNet ?? 0;
  return {
    value: projected - args.monthOperatingExpenses + otherNet,
    mtdGrossProfit: args.mtdGrossProfit, daysElapsed: elapsed, daysInMonth: dim,
    projectedGrossProfit: projected, monthOperatingExpenses: args.monthOperatingExpenses, otherNet,
  };
}

export function calculateBudgetVariance(budget: Kobo, actual: Kobo) {
  const variance = actual - budget;
  return { budget, actual, variance, ratio: budget > 0 ? variance / budget : null, over: variance > 0 };
}

export interface CashAccountRow { account_id: string; name: string; type: string; opening: Kobo; cash_in: Kobo; cash_out: Kobo; closing: Kobo }

export function calculateCashFlow(rows: CashAccountRow[]) {
  const opening = rows.reduce((a, r) => a + r.opening, 0);
  const cashIn = rows.reduce((a, r) => a + r.cash_in, 0);
  const cashOut = rows.reduce((a, r) => a + r.cash_out, 0);
  const closing = rows.reduce((a, r) => a + r.closing, 0);
  // Transfers between own accounts appear in both in and out; they cancel in the totals.
  return { opening, cashIn, cashOut, net: cashIn - cashOut, closing, reconciles: opening + cashIn - cashOut === closing };
}

export interface AgedRow { outstanding: Kobo; days_overdue: number; status: string }
export function ageing(rows: AgedRow[]) {
  const b = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
  for (const r of rows) {
    if (r.days_overdue <= 0) b.current += r.outstanding;
    else if (r.days_overdue <= 30) b.d1_30 += r.outstanding;
    else if (r.days_overdue <= 60) b.d31_60 += r.outstanding;
    else if (r.days_overdue <= 90) b.d61_90 += r.outstanding;
    else b.d90p += r.outstanding;
  }
  const total = rows.reduce((a, r) => a + r.outstanding, 0);
  const overdue = rows.filter((r) => r.days_overdue > 0).reduce((a, r) => a + r.outstanding, 0);
  return { ...b, total, overdue, count: rows.length, overdueCount: rows.filter((r) => r.days_overdue > 0).length };
}
