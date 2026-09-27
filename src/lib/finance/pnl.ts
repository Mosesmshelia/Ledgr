// Profit & loss engine. Takes the raw period totals from the database (fin_pnl) and produces
// traceable metrics. Never treats a missing cost as ₦0: sales without cost are EXCLUDED from profit
// (and the result is flagged), rather than counted as 100% profit.
import type { Kobo } from "./money";
import type { ISODate } from "./periods";

export type Completeness = "complete" | "partial" | "missing_data";

export interface PnlInputs {
  from: ISODate; to: ISODate;
  sales_count: number;
  gross_sales: Kobo; discounts: Kobo; sales_net: Kobo; returns: Kobo;
  cogs_known: Kobo; returns_cogs: Kobo;
  /** Net cost of stock written off (+) or found (−). Optional for older callers. */
  stock_adjustments?: Kobo;
  revenue_missing_cost: Kobo; returns_missing_cost: Kobo;
  lines_actual: number; lines_estimated: number; lines_missing: number; sales_with_missing_cost: number;
  opex_one_time: Kobo; opex_recurring: Kobo; other_expense: Kobo; income_tax: Kobo; other_income: Kobo;
  vat_collected: Kobo;
}

export interface Step { label: string; amount: Kobo; op?: "+" | "−" | "=" }

export interface Metric<T = Kobo | null> {
  key: string;
  label: string;
  value: T;
  status: Completeness;
  /** Plain-English explanation shown under the number / in the sheet. */
  explain: string;
  /** "How was this calculated?" lines, in order. */
  steps: Step[];
  note?: string;
}

export interface Pnl {
  period: { from: ISODate; to: ISODate };
  status: Completeness;
  statusNote?: string;
  salesCount: number;
  grossSales: Kobo;
  discounts: Kobo;
  returns: Kobo;
  revenue: Kobo;
  /** Revenue from sales whose cost is known — the base for profit and margins. */
  coveredRevenue: Kobo;
  excludedRevenue: Kobo;
  cogs: Kobo;
  grossProfit: Kobo;
  grossMargin: number | null;
  operatingExpenses: Kobo;
  operatingProfit: Kobo;
  otherIncome: Kobo;
  otherExpense: Kobo;
  incomeTax: Kobo;
  netProfit: Kobo;
  netMargin: number | null;
  vatCollected: Kobo;
  metrics: Record<"revenue" | "cogs" | "grossProfit" | "operatingExpenses" | "netProfit", Metric<Kobo>>;
}

export function completenessOf(i: Pick<PnlInputs, "lines_missing" | "lines_estimated">): Completeness {
  if (i.lines_missing > 0) return "missing_data";
  if (i.lines_estimated > 0) return "partial";
  return "complete";
}

export function calculateRevenue(i: PnlInputs): Kobo {
  return i.gross_sales - i.discounts - i.returns;
}

export function calculateCOGS(i: PnlInputs): Kobo {
  return i.cogs_known - i.returns_cogs + (i.stock_adjustments ?? 0);
}

export function calculateGrossProfit(i: PnlInputs): Kobo {
  const covered = calculateRevenue(i) - (i.revenue_missing_cost - i.returns_missing_cost);
  return covered - calculateCOGS(i);
}

/** Ratio (0–1). null when there is no revenue: we show "—", never 0%. */
export function margin(profit: Kobo, revenue: Kobo): number | null {
  return revenue > 0 ? profit / revenue : null;
}

export function calculateOperatingExpenses(i: PnlInputs): Kobo {
  return i.opex_one_time + i.opex_recurring;
}

export function calculatePnl(i: PnlInputs): Pnl {
  const status = completenessOf(i);
  const revenue = calculateRevenue(i);
  const excludedRevenue = i.revenue_missing_cost - i.returns_missing_cost;
  const coveredRevenue = revenue - excludedRevenue;
  const cogs = calculateCOGS(i);
  const grossProfit = coveredRevenue - cogs;
  const opex = calculateOperatingExpenses(i);
  const operatingProfit = grossProfit - opex;
  const netProfit = operatingProfit + i.other_income - i.other_expense - i.income_tax;

  const statusNote =
    status === "missing_data"
      ? `Profit can't be calculated accurately for ${i.sales_with_missing_cost} sale${i.sales_with_missing_cost === 1 ? "" : "s"} because product cost information is missing. Those sales are left out of profit until you add the cost.`
      : status === "partial"
        ? `${i.lines_estimated} sale line${i.lines_estimated === 1 ? " uses" : "s use"} an estimated cost (the product's standard cost).`
        : undefined;

  const revSteps: Step[] = [
    { label: "Gross sales", amount: i.gross_sales },
    { label: "Discounts", amount: i.discounts, op: "−" },
    { label: "Returns", amount: i.returns, op: "−" },
    { label: "Net revenue", amount: revenue, op: "=" },
  ];
  const gpSteps: Step[] = [
    { label: "Net revenue", amount: revenue },
    ...(excludedRevenue ? [{ label: "Sales with missing cost (left out)", amount: excludedRevenue, op: "−" as const }] : []),
    { label: "Cost of goods sold", amount: cogs, op: "−" },
    { label: "Gross profit", amount: grossProfit, op: "=" },
  ];
  const netSteps: Step[] = [
    ...gpSteps.slice(0, -1),
    { label: "Gross profit", amount: grossProfit, op: "=" },
    { label: "Operating expenses", amount: opex, op: "−" },
    ...(i.other_income ? [{ label: "Other income", amount: i.other_income, op: "+" as const }] : []),
    ...(i.other_expense ? [{ label: "Other expenses (e.g. loan interest)", amount: i.other_expense, op: "−" as const }] : []),
    ...(i.income_tax ? [{ label: "Income tax", amount: i.income_tax, op: "−" as const }] : []),
    { label: "Net profit", amount: netProfit, op: "=" },
  ];

  return {
    period: { from: i.from, to: i.to },
    status, statusNote,
    salesCount: i.sales_count,
    grossSales: i.gross_sales, discounts: i.discounts, returns: i.returns,
    revenue, coveredRevenue, excludedRevenue, cogs, grossProfit,
    grossMargin: margin(grossProfit, coveredRevenue),
    operatingExpenses: opex, operatingProfit,
    otherIncome: i.other_income, otherExpense: i.other_expense, incomeTax: i.income_tax,
    netProfit,
    netMargin: margin(netProfit, coveredRevenue),
    vatCollected: i.vat_collected,
    metrics: {
      revenue: { key: "revenue", label: "Revenue", value: revenue, status: "complete",
        explain: "What you sold, after discounts and returns. VAT is not included.", steps: revSteps },
      cogs: { key: "cogs", label: "Cost of goods sold", value: cogs, status,
        explain: "What the products you sold cost you to buy or make.", steps: [
          { label: "Cost of items sold", amount: i.cogs_known },
          { label: "Cost of items returned to stock", amount: i.returns_cogs, op: "−" },
          ...(i.stock_adjustments ? [{ label: "Stock written off / adjustments", amount: i.stock_adjustments, op: "+" as const }] : []),
          { label: "Cost of goods sold", amount: cogs, op: "=" },
        ], note: statusNote },
      grossProfit: { key: "grossProfit", label: "Gross profit", value: grossProfit, status,
        explain: "What's left from sales after paying for the products.", steps: gpSteps, note: statusNote },
      operatingExpenses: { key: "operatingExpenses", label: "Operating expenses", value: opex, status: "complete",
        explain: "The cost of running the business: rent, fuel, salaries and so on.", steps: [
          { label: "One-time expenses", amount: i.opex_one_time },
          { label: "Recurring expenses (share for this period)", amount: i.opex_recurring, op: "+" },
          { label: "Operating expenses", amount: opex, op: "=" },
        ] },
      netProfit: { key: "netProfit", label: "Net profit", value: netProfit, status,
        explain: "What the business actually made after all costs.", steps: netSteps, note: statusNote },
    },
  };
}
