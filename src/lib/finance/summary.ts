// Plain-English business summary, generated ONLY from calculated figures.
// Each sentence carries the metric it came from, and is skipped when its data is missing.
// No causes, no advice, no guesses: "Sales fell 12%" is allowed; "because of the rain" is not.
import { formatMoney, formatPercent, type Kobo } from "./money";
import { comparePeriods } from "./analysis";
import type { Pnl } from "./pnl";

export interface SummaryInput {
  periodWord: string;               // "this week"
  prevWord: string;                 // "last week"
  pnl: Pnl;
  prev: Pnl | null;
  topExpense?: { name: string; amount: Kobo } | null;
  topRevenueProduct?: { name: string; revenue: Kobo } | null;
  topProfitProduct?: { name: string; profit: Kobo } | null;
  receivables?: { total: Kobo; overdue: Kobo } | null;
  closingCash?: Kobo | null;
}

export interface Sentence { key: string; text: string; tone?: "positive" | "negative" | "neutral" | "warning" }

const m = (k: Kobo) => formatMoney(k, { compact: Math.abs(k) >= 1_000_000_00 ? true : false });

export function businessSummary(i: SummaryInput): Sentence[] {
  const out: Sentence[] = [];
  const { pnl, prev } = i;

  if (pnl.salesCount === 0 && pnl.revenue === 0) {
    out.push({ key: "revenue", text: `No sales were recorded ${i.periodWord}.`, tone: "neutral" });
  } else {
    const c = prev ? comparePeriods(pnl.revenue, prev.revenue) : null;
    let tail = "";
    if (c?.kind === "change") tail = `, ${c.ratio > 0 ? "up" : "down"} ${formatPercent(Math.abs(c.ratio), 0)} on ${i.prevWord}`;
    else if (c?.kind === "same") tail = `, the same as ${i.prevWord}`;
    else if (c?.kind === "new") tail = ` (there were no sales ${i.prevWord})`;
    out.push({ key: "revenue", text: `Your business sold ${m(pnl.revenue)} ${i.periodWord}${tail}.`,
      tone: c?.kind === "change" ? (c.ratio > 0 ? "positive" : "negative") : "neutral" });
  }

  if (pnl.coveredRevenue > 0) {
    let s = `Gross profit was ${m(pnl.grossProfit)}, a ${formatPercent(pnl.grossMargin, 1)} margin.`;
    if (prev?.grossMargin != null && pnl.grossMargin != null) {
      const pts = (pnl.grossMargin - prev.grossMargin) * 100;
      if (Math.abs(pts) >= 1) s += ` That's ${pts > 0 ? "up" : "down"} from ${formatPercent(prev.grossMargin, 1)} ${i.prevWord}.`;
    }
    out.push({ key: "grossProfit", text: s });
  }

  if (pnl.operatingExpenses > 0 || pnl.revenue > 0) {
    const net = pnl.netProfit;
    const other = pnl.otherIncome - pnl.otherExpense - pnl.incomeTax;
    const otherText = other < 0 ? ` and other costs (like loan interest or tax) came to ${m(-other)}` : other > 0 ? ` and other income added ${m(other)}` : "";
    const s = net >= 0
      ? `Operating expenses were ${m(pnl.operatingExpenses)}${otherText}, leaving a net profit of ${m(net)}.`
      : `Operating expenses were ${m(pnl.operatingExpenses)}${otherText}, so the business made a loss of ${m(-net)}.`;
    out.push({ key: "netProfit", text: s, tone: net < 0 ? "negative" : "neutral" });
  }

  if (i.topExpense && i.topExpense.amount > 0) {
    out.push({ key: "topExpense", text: `Your largest expense was ${i.topExpense.name.toLowerCase()} at ${m(i.topExpense.amount)}.` });
  }

  if (i.topRevenueProduct && i.topRevenueProduct.revenue > 0) {
    let s = `${i.topRevenueProduct.name} brought in the most revenue (${m(i.topRevenueProduct.revenue)})`;
    if (i.topProfitProduct && i.topProfitProduct.name !== i.topRevenueProduct.name && i.topProfitProduct.profit > 0) {
      s += `, while ${i.topProfitProduct.name} made the most profit (${m(i.topProfitProduct.profit)})`;
    }
    out.push({ key: "topProduct", text: s + "." });
  }

  if (i.receivables && i.receivables.total > 0) {
    out.push({
      key: "receivables",
      text: `Customers owe you ${m(i.receivables.total)}${i.receivables.overdue > 0 ? `, of which ${m(i.receivables.overdue)} is overdue` : ""}.`,
      tone: i.receivables.overdue > 0 ? "warning" : "neutral",
    });
  }

  if (pnl.status === "missing_data") {
    out.push({ key: "missing", text: `Some sales have no cost recorded, so they're left out of profit until you add the cost.`, tone: "warning" });
  }
  return out;
}

/** Group a daily series into buckets and compute profit per bucket the same way the P&L does. */
export interface DayRow { day: string; revenue: Kobo; cogs_known: Kobo; revenue_missing_cost: Kobo; opex: Kobo; other_net?: Kobo; cash_in: Kobo; cash_out: Kobo }
export interface Bucket { label: string; from: string; to: string; revenue: Kobo; cogs: Kobo; opex: Kobo; grossProfit: Kobo; netOperating: Kobo; netProfit: Kobo; cashIn: Kobo; cashOut: Kobo; incomplete: boolean }

export function bucketSeries(days: DayRow[], ranges: { label: string; from: string; to: string }[]): Bucket[] {
  return ranges.map((r) => {
    const d = days.filter((x) => x.day >= r.from && x.day <= r.to);
    const sum = (f: (x: DayRow) => number) => d.reduce((a, x) => a + f(x), 0);
    const revenue = sum((x) => x.revenue);
    const missing = sum((x) => x.revenue_missing_cost);
    const cogs = sum((x) => x.cogs_known);
    const opex = sum((x) => x.opex);
    const grossProfit = revenue - missing - cogs;
    return { ...r, revenue, cogs, opex, grossProfit, netOperating: grossProfit - opex, netProfit: grossProfit - opex + sum((x) => x.other_net ?? 0), cashIn: sum((x) => x.cash_in), cashOut: sum((x) => x.cash_out), incomplete: missing !== 0 };
  });
}
