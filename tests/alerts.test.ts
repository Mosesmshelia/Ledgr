import { describe, it, expect } from "vitest";
import { evaluateAlerts, mergeRules, DEFAULT_ALERT_RULES, type AlertInputs } from "@/lib/finance";

const N = (n: number) => Math.round(n * 100);
const calm: AlertInputs = {
  today: "2026-09-24",
  cash: { total: N(900_000) },
  receivables: [{ outstanding: N(50_000), days_overdue: 0 }],
  payables: [],
  expenses: [{ category_id: "fuel", name: "Fuel", thisWeek: N(30_000), avg8: N(28_000) }],
  weeklyTarget: { target: N(700_000), salesSoFar: N(310_000), daysElapsed: 3, weekStart: "2026-09-21" },
  budget: { month: "2026-09-01", lines: [{ key: "opex", label: "Operating expenses", budget: N(500_000), actual: N(420_000) }] },
  lastWeek: { from: "2026-09-14", netProfit: N(80_000), grossMargin: 0.42, status: "complete" },
  prior4Margin: 0.43,
  lowStock: [],
  missingCostSales: 0,
};

describe("Alerts", () => {
  it("a healthy business has no alerts", () => {
    expect(evaluateAlerts(calm)).toEqual([]);
  });

  it("fires each alert at its threshold, with stable keys", () => {
    const a = evaluateAlerts({
      ...calm,
      cash: { total: N(150_000) },
      receivables: [{ outstanding: N(80_000), days_overdue: 12 }, { outstanding: N(20_000), days_overdue: 40 }],
      payables: [{ outstanding: N(60_000), days_overdue: 3 }],
      expenses: [{ category_id: "fuel", name: "Fuel", thisWeek: N(40_000), avg8: N(30_000) }, { category_id: "tiny", name: "Tea", thisWeek: N(9_000), avg8: N(1_000) }],
      weeklyTarget: { ...calm.weeklyTarget, salesSoFar: N(200_000) }, // pace 300k → 33% behind
      budget: { month: "2026-09-01", lines: [{ key: "opex", label: "Operating expenses", budget: N(500_000), actual: N(550_000) }] },
      lastWeek: { from: "2026-09-14", netProfit: N(-12_000), grossMargin: 0.38, status: "complete" },
      lowStock: [{ product_id: "p1", name: "Zobo 50cl", on_hand: 0, unit: "unit" }],
      missingCostSales: 2,
    });
    const kinds = a.map((x) => x.kind).sort();
    expect(kinds).toEqual(["high_expense", "low_cash", "low_stock", "margin_drop", "missing_costs", "negative_profit",
      "over_budget", "overdue_payables", "overdue_receivables", "sales_behind_target"]);
    expect(a.find((x) => x.kind === "overdue_receivables")!).toMatchObject({ severity: "critical", key: "overdue_receivables:all" });
    expect(a.find((x) => x.kind === "overdue_receivables")!.message).toContain("₦100,000");
    expect(a.find((x) => x.kind === "high_expense")!.key).toBe("high_expense:2026-09-21:fuel"); // Tea is under ₦10k, ignored
    expect(a.find((x) => x.kind === "sales_behind_target")!.severity).toBe("critical");
    expect(a.find((x) => x.kind === "margin_drop")!.message).toContain("5.0 points");
    expect(a[0].severity).toBe("critical"); // sorted by severity
    expect(a.find((x) => x.kind === "over_budget")!.data.costs).toBe(true);
    expect(a.find((x) => x.kind === "low_cash")!.data.costs).toBe(false);
  });

  it("boundaries: exactly on the threshold does not fire; custom rules and disabled rules apply", () => {
    expect(evaluateAlerts({ ...calm, cash: { total: N(200_000) } })).toEqual([]);
    expect(evaluateAlerts({ ...calm, expenses: [{ category_id: "f", name: "Fuel", thisWeek: N(125_000), avg8: N(100_000) }] })).toEqual([]); // exactly 25%
    expect(evaluateAlerts({ ...calm, lastWeek: { ...calm.lastWeek!, grossMargin: 0.40 } }).map((a) => a.kind)).toEqual(["margin_drop"]); // exactly 3 pts
    const rules = mergeRules([{ kind: "low_cash", enabled: true, threshold: { value: N(1_000_000) } }, { kind: "margin_drop", enabled: false, threshold: null }, { kind: "bogus", enabled: true, threshold: null }]);
    expect(rules.low_cash.value).toBe(N(1_000_000));
    expect(evaluateAlerts(calm, rules).map((a) => a.kind)).toEqual(["low_cash"]);
    expect(evaluateAlerts({ ...calm, lastWeek: { ...calm.lastWeek!, grossMargin: 0.30 } }, rules).map((a) => a.kind)).toEqual(["low_cash"]);
    expect(DEFAULT_ALERT_RULES.low_cash.value).toBe(N(200_000));
  });

  it("does not judge target pace on the first day of the week", () => {
    expect(evaluateAlerts({ ...calm, weeklyTarget: { ...calm.weeklyTarget, salesSoFar: 0, daysElapsed: 1 } })).toEqual([]);
  });
});
