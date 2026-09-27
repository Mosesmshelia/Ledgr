// Alerts engine. Pure: takes numbers the server already loaded, returns the alerts that are true right now.
// Each alert has a stable `key` so the database can keep one row per situation (no duplicates, auto-resolve).
import { formatMoney, formatPercent, formatQty, type Kobo } from "./money";

export type AlertKind =
  | "low_cash" | "overdue_receivables" | "overdue_payables" | "high_expense" | "sales_behind_target"
  | "over_budget" | "negative_profit" | "low_stock" | "margin_drop" | "missing_costs";

export type Severity = "info" | "warning" | "critical";

export interface AlertRule { enabled: boolean; value: number }
export type AlertRules = Record<AlertKind, AlertRule>;

/** Default thresholds. Money in kobo, percentages as whole numbers, margin drop in percentage points. */
export const DEFAULT_ALERT_RULES: AlertRules = {
  low_cash: { enabled: true, value: 200_000_00 },
  overdue_receivables: { enabled: true, value: 1 },   // days overdue before it counts
  overdue_payables: { enabled: true, value: 1 },
  high_expense: { enabled: true, value: 25 },         // % above the 8-week average
  sales_behind_target: { enabled: true, value: 10 },  // % behind the target pace
  over_budget: { enabled: true, value: 0 },           // % over budget allowed before alerting
  negative_profit: { enabled: true, value: 0 },
  low_stock: { enabled: true, value: 0 },
  margin_drop: { enabled: true, value: 3 },           // percentage points
  missing_costs: { enabled: true, value: 0 },
};

export const ALERT_META: Record<AlertKind, { label: string; help: string; unit: "money" | "pct" | "pts" | "days" | null; costs: boolean; href: string }> = {
  low_cash: { label: "Low cash", help: "Warn when cash across all accounts falls below", unit: "money", costs: false, href: "/money" },
  overdue_receivables: { label: "Customers paying late", help: "Warn when an invoice is overdue by at least", unit: "days", costs: false, href: "/money?tab=receivables" },
  overdue_payables: { label: "Supplier bills overdue", help: "Warn when a bill is overdue by at least", unit: "days", costs: false, href: "/money?tab=payables" },
  high_expense: { label: "Unusual spending", help: "Warn when a category this week is above its 8-week average by", unit: "pct", costs: false, href: "/expenses" },
  sales_behind_target: { label: "Sales behind target", help: "Warn when sales are behind the weekly target pace by", unit: "pct", costs: false, href: "/dashboard" },
  over_budget: { label: "Over budget", help: "Warn when a budget line is over by more than", unit: "pct", costs: true, href: "/reports/budget" },
  negative_profit: { label: "Loss for the week", help: "Warn when last week's net profit was below zero", unit: null, costs: true, href: "/reports/weekly" },
  low_stock: { label: "Low stock", help: "Warn when a product falls to its minimum stock level", unit: null, costs: false, href: "/inventory" },
  margin_drop: { label: "Margin drop", help: "Warn when last week's gross margin fell versus the 4 weeks before by", unit: "pts", costs: true, href: "/reports/analytics" },
  missing_costs: { label: "Missing costs", help: "Warn when sales have no product cost, so profit can't be fully calculated", unit: null, costs: true, href: "/sales?status=missing" },
};

export interface AlertInputs {
  today: string;
  cash: { total: Kobo };
  receivables: { outstanding: Kobo; days_overdue: number; name?: string }[];
  payables: { outstanding: Kobo; days_overdue: number; name?: string }[];
  /** Expenses per category this week so far, plus the average of the previous 8 full weeks. */
  expenses: { category_id: string; name: string; thisWeek: Kobo; avg8: Kobo }[];
  weeklyTarget: { target: Kobo | null; salesSoFar: Kobo; daysElapsed: number; weekStart: string };
  budget: { month: string; lines: { key: string; label: string; budget: Kobo; actual: Kobo }[] } | null;
  lastWeek: { from: string; netProfit: Kobo; grossMargin: number | null; status: string } | null;
  prior4Margin: number | null;
  lowStock: { product_id: string; name: string; on_hand: number; unit: string }[];
  missingCostSales: number;
}

export interface Alert {
  key: string;
  kind: AlertKind;
  severity: Severity;
  message: string;
  data: { href: string; costs: boolean; amount?: number };
}

const NGN = (k: Kobo) => formatMoney(k, { compact: false });

export function mergeRules(rows: { kind: string; enabled: boolean; threshold: { value?: number } | null }[]): AlertRules {
  const out = structuredClone(DEFAULT_ALERT_RULES);
  for (const r of rows) {
    if (!(r.kind in out)) continue;
    const k = r.kind as AlertKind;
    out[k] = { enabled: r.enabled, value: typeof r.threshold?.value === "number" ? r.threshold.value : out[k].value };
  }
  return out;
}

export function evaluateAlerts(i: AlertInputs, rules: AlertRules = DEFAULT_ALERT_RULES): Alert[] {
  const out: Alert[] = [];
  const add = (kind: AlertKind, key: string, severity: Severity, message: string, amount?: number) =>
    out.push({ key: `${kind}:${key}`, kind, severity, message, data: { href: ALERT_META[kind].href, costs: ALERT_META[kind].costs, amount } });
  const on = (k: AlertKind) => rules[k].enabled;

  if (on("low_cash") && i.cash.total < rules.low_cash.value) {
    add("low_cash", "all", i.cash.total <= 0 ? "critical" : "warning",
      `Cash is low: ${NGN(i.cash.total)} across all accounts (your alert level is ${NGN(rules.low_cash.value)}).`, i.cash.total);
  }

  for (const [kind, rows, who] of [["overdue_receivables", i.receivables, "customers owe"], ["overdue_payables", i.payables, "you owe suppliers"]] as const) {
    if (!on(kind)) continue;
    const late = rows.filter((r) => r.outstanding > 0 && r.days_overdue >= rules[kind].value);
    if (!late.length) continue;
    const total = late.reduce((a, r) => a + r.outstanding, 0);
    const worst = Math.max(...late.map((r) => r.days_overdue));
    add(kind, "all", worst > 30 ? "critical" : "warning",
      `${NGN(total)} ${who} is overdue across ${late.length} ${late.length === 1 ? "invoice" : "invoices"} (oldest ${worst} ${worst === 1 ? "day" : "days"} late).`, total);
  }

  if (on("high_expense")) {
    for (const e of i.expenses) {
      if (e.thisWeek < 10_000_00 || e.avg8 <= 0) continue;
      const over = (e.thisWeek - e.avg8) / e.avg8;
      if (over * 100 > rules.high_expense.value) {
        add("high_expense", `${i.weeklyTarget.weekStart}:${e.category_id}`, "warning",
          `${e.name} spending this week is ${NGN(e.thisWeek)} — ${formatPercent(over, 0)} above the usual ${NGN(e.avg8)} a week.`, e.thisWeek);
      }
    }
  }

  const t = i.weeklyTarget;
  if (on("sales_behind_target") && t.target && t.daysElapsed >= 2) {
    const pace = Math.round((t.target * t.daysElapsed) / 7);
    const behind = pace > 0 ? (pace - t.salesSoFar) / pace : 0;
    if (behind * 100 > rules.sales_behind_target.value) {
      add("sales_behind_target", t.weekStart, behind > 0.3 ? "critical" : "warning",
        `Sales are ${formatPercent(behind, 0)} behind this week's target pace: ${NGN(t.salesSoFar)} so far against ${NGN(pace)} expected by now.`, t.salesSoFar);
    }
  }

  if (on("over_budget") && i.budget) {
    for (const l of i.budget.lines) {
      if (l.budget <= 0) continue;
      const over = (l.actual - l.budget) / l.budget;
      if (l.actual > l.budget && over * 100 > rules.over_budget.value) {
        add("over_budget", `${i.budget.month}:${l.key}`, over > 0.2 ? "critical" : "warning",
          `${l.label} is over budget this month: ${NGN(l.actual)} spent against ${NGN(l.budget)} (${formatPercent(over, 0, true)}).`, l.actual);
      }
    }
  }

  if (on("negative_profit") && i.lastWeek && i.lastWeek.netProfit < 0) {
    add("negative_profit", i.lastWeek.from, "critical", `Last week made a loss of ${NGN(-i.lastWeek.netProfit)}.`, i.lastWeek.netProfit);
  }

  if (on("margin_drop") && i.lastWeek && i.lastWeek.grossMargin !== null && i.prior4Margin !== null) {
    const drop = Math.round((i.prior4Margin - i.lastWeek.grossMargin) * 1000) / 10; // points, to 0.1 as shown
    if (drop >= rules.margin_drop.value) {
      add("margin_drop", i.lastWeek.from, "warning",
        `Gross margin fell to ${formatPercent(i.lastWeek.grossMargin)} last week, down ${drop.toFixed(1)} points from ${formatPercent(i.prior4Margin)} over the 4 weeks before.`);
    }
  }

  if (on("low_stock")) {
    for (const p of i.lowStock) {
      add("low_stock", p.product_id, p.on_hand <= 0 ? "critical" : "info",
        p.on_hand <= 0 ? `${p.name} is out of stock.` : `${p.name} is running low: ${formatQty(p.on_hand, p.unit === "unit" ? "left" : p.unit)}${p.unit === "unit" ? "" : " left"}.`, p.on_hand);
    }
  }

  if (on("missing_costs") && i.missingCostSales > 0) {
    add("missing_costs", "all", "warning",
      `${i.missingCostSales} ${i.missingCostSales === 1 ? "sale has" : "sales have"} no product cost, so profit leaves them out until you add it.`, i.missingCostSales);
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
