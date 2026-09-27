// Unit tests for the pure TypeScript finance engine.
import { describe, it, expect } from "vitest";
import {
  allocate, parseNaira, formatMoney, formatPercent, resolvePeriod, previousComparable, daysInMonth,
  calculateBreakEven, breakEvenUnits, calculateMonthEndEstimate, calculateCashFlow, ageing, equivalents,
  accrualBetween, todayIn, startOfWeek,
} from "@/lib/finance";

describe("money", () => {
  it("allocate always adds up exactly", () => {
    expect(allocate(100_000, [1, 1, 1])).toEqual([33_333, 33_333, 33_334]);
    expect(allocate(3_500_000, [20_000_000, 15_000_000])).toEqual([2_000_000, 1_500_000]);
    for (const total of [1, 7, 999_999, 123_456_789]) {
      const parts = allocate(total, [3, 1.5, 7, 0.001]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });
  it("parses what people type", () => {
    expect(parseNaira("1,200.50")).toBe(120_050);
    expect(parseNaira("₦ 23,077")).toBe(2_307_700);
    expect(parseNaira("12.345")).toBeNull();
    expect(parseNaira("abc")).toBeNull();
  });
  it("formats compact and exact", () => {
    expect(formatMoney(485_000_000, { compact: true })).toBe("₦4.85m");
    expect(formatMoney(62_000_000, { compact: true })).toBe("₦620k");
    expect(formatMoney(2_333_334, { compact: true })).toBe("₦23.3k");
    expect(formatMoney(485_000_000)).toBe("₦4,850,000");
    expect(formatMoney(2_333_334)).toBe("₦23,333");
    expect(formatMoney(2_333_334, { exact: true })).toBe("₦23,333.34");
    expect(formatMoney(-12_000_000)).toBe("−₦120,000");
    expect(formatMoney(null)).toBe("—");
    expect(formatPercent(0.3429, 2)).toBe("34.29%");
    expect(formatPercent(null)).toBe("—");
  });
});

describe("periods", () => {
  const today = "2026-09-23"; // a Wednesday
  it("weeks start on Monday by default", () => {
    expect(startOfWeek(today)).toBe("2026-09-21");
    expect(startOfWeek(today, 0)).toBe("2026-09-20");
  });
  it("this week so far compares with the same days last week", () => {
    const p = resolvePeriod("this_week", today);
    expect(p).toMatchObject({ from: "2026-09-21", to: "2026-09-23" });
    expect(previousComparable(p)).toMatchObject({ from: "2026-09-14", to: "2026-09-16" });
  });
  it("month to date compares with the same number of days last month, capped at month end", () => {
    const p = resolvePeriod("this_month", "2026-03-31");
    expect(previousComparable(p)).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    const q = resolvePeriod("this_month", "2026-09-17");
    expect(previousComparable(q)).toMatchObject({ from: "2026-08-01", to: "2026-08-17" });
  });
  it("last month is a full month", () => {
    expect(resolvePeriod("last_month", "2026-03-15")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(daysInMonth("2028-02-10")).toBe(29);
  });
  it("today follows Lagos time, not the server's", () => {
    // 23:30 UTC on 30 Sep is already 1 Oct in Lagos (UTC+1)
    expect(todayIn("Africa/Lagos", new Date("2026-09-30T23:30:00Z"))).toBe("2026-10-01");
  });
});

describe("analysis", () => {
  it("break-even revenue and units", () => {
    expect(calculateBreakEven(N(620_000), 0.4).breakEvenRevenue).toBe(N(1_550_000));
    expect(calculateBreakEven(N(620_000), 0).breakEvenRevenue).toBeNull();
    expect(calculateBreakEven(N(620_000), null).reason).toBeDefined();
    expect(breakEvenUnits(N(100_000), N(1_500), N(1_000))).toBe(200);
  });
  it("month-end estimate uses the daily pace and the full month's expenses", () => {
    const e = calculateMonthEndEstimate({ today: "2026-09-10", monthStart: "2026-09-01", mtdGrossProfit: N(1_000_000), monthOperatingExpenses: N(1_200_000) });
    expect(e.projectedGrossProfit).toBe(N(3_000_000));
    expect(e.value).toBe(N(1_800_000));
  });
  it("cash flow reconciles", () => {
    const c = calculateCashFlow([
      { account_id: "a", name: "Cash", type: "cash", opening: N(1_500_000), cash_in: N(4_200_000), cash_out: N(3_100_000), closing: N(2_600_000) },
    ]);
    expect(c.closing).toBe(N(2_600_000));
    expect(c.reconciles).toBe(true);
  });
  it("ageing buckets", () => {
    const a = ageing([{ outstanding: 100, days_overdue: 0, status: "unpaid" }, { outstanding: 50, days_overdue: 45, status: "overdue" }, { outstanding: 25, days_overdue: 120, status: "overdue" }]);
    expect(a).toMatchObject({ current: 100, d31_60: 50, d90p: 25, total: 175, overdue: 75, overdueCount: 2 });
  });
  it("recurring equivalents and partial months", () => {
    expect(equivalents({ amount: N(1_200_000), frequency: "annual" })).toMatchObject({ monthly: N(100_000), weekly: 2_307_692 });
    // Monthly ₦30,000 starting on the 16th of a 30-day month → half the month.
    expect(accrualBetween({ amount: N(30_000), frequency: "monthly", start_date: "2026-09-16" }, "2026-09-01", "2026-09-30")).toBe(N(15_000));
  });
});

function N(n: number) { return Math.round(n * 100); }
