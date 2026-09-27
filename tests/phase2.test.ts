// Phase 2: statements, stock movements, FIFO queue, the plain-English summary and chart buckets.
import { describe, it, expect, afterAll } from "vitest";
import { pool, setup, q, N } from "./helpers";
import { businessSummary, bucketSeries, calculatePnl, type PnlInputs } from "@/lib/finance";
import { rpc } from "@/lib/db/core";

afterAll(() => pool.end());

const blank: PnlInputs = {
  from: "2026-09-21", to: "2026-09-27", sales_count: 0, gross_sales: 0, discounts: 0, sales_net: 0, returns: 0, cogs_known: 0, returns_cogs: 0,
  revenue_missing_cost: 0, returns_missing_cost: 0, lines_actual: 0, lines_estimated: 0, lines_missing: 0, sales_with_missing_cost: 0,
  opex_one_time: 0, opex_recurring: 0, other_expense: 0, income_tax: 0, other_income: 0, vat_collected: 0,
};

describe("Customer & supplier statements", () => {
  it("running balance: invoice, part payment, return, then full settlement", async () => {
    const ctx = await setup();
    const C = await ctx.customer("Greenleaf", 30);
    const P = await ctx.product("Juice");
    await ctx.rpc("set_opening_stock", { product_id: P, qty: 100, unit_cost: N(500), date: "2026-05-01" });
    const s1 = await ctx.rpc<string>("post_sale", { customer_id: C, date: "2026-05-02", items: [{ product_id: P, qty: 10, unit_price: N(1_000) }] });
    await ctx.rpc("record_payment", { party: "customer", party_id: C, account_id: ctx.bank, date: "2026-05-05", amount: N(4_000) });
    const [line] = await q<{ id: string }>(ctx, "select id from sale_items where sale_id = $1", [s1]);
    await ctx.as((db) => rpc(db, "post_return", { sale_id: s1, date: "2026-05-06", restock: true, refund_method: "credit", items: [{ sale_item_id: line.id, qty: 2 }] }));
    await ctx.rpc("post_sale", { customer_id: C, date: "2026-06-01", items: [{ product_id: P, qty: 5, unit_price: N(1_000) }] });
    await ctx.rpc("record_payment", { party: "customer", party_id: C, account_id: ctx.bank, date: "2026-06-10", amount: N(9_000) });

    const st = await q<{ kind: string; debit: number; credit: number; balance: number }>(ctx, "select * from fin_customer_statement($1,$2,$3,$4)", [ctx.b, C, "2026-05-01", "2026-06-30"]);
    expect(st.map((r) => [r.kind, r.balance])).toEqual([
      ["opening", 0], ["invoice", N(10_000)], ["payment", N(6_000)], ["return", N(4_000)], ["invoice", N(9_000)], ["payment", 0],
    ]);
    // Opening balance for a later window carries forward.
    const june = await q<{ kind: string; balance: number }>(ctx, "select * from fin_customer_statement($1,$2,$3,$4)", [ctx.b, C, "2026-06-01", "2026-06-30"]);
    expect(june[0]).toMatchObject({ kind: "opening", balance: N(4_000) });
    // Statement closing balance equals what receivables say.
    const rec = await q<{ outstanding: number }>(ctx, "select * from fin_receivables($1,$2)", [ctx.b, "2026-06-30"]);
    expect(rec.reduce((a, r) => a + r.outstanding, 0)).toBe(0);
  });

  it("supplier statement tracks what you owe", async () => {
    const ctx = await setup();
    const S = await ctx.supplier("Dei-Dei");
    const R = await ctx.product("Oranges", { is_sellable: false });
    await ctx.rpc("post_purchase", { supplier_id: S, date: "2026-05-01", items: [{ product_id: R, qty: 100, unit_cost: N(900) }] });
    await ctx.rpc("record_payment", { party: "supplier", party_id: S, account_id: ctx.bank, date: "2026-05-10", amount: N(50_000) });
    const st = await q<{ kind: string; balance: number }>(ctx, "select * from fin_supplier_statement($1,$2,$3,$4)", [ctx.b, S, "2026-05-01", "2026-05-31"]);
    expect(st.map((r) => r.balance)).toEqual([0, N(90_000), N(40_000)]);
  });
});

describe("Stock movements and FIFO queue", () => {
  it("running quantity matches stock on hand; layers show what sells next", async () => {
    const ctx = await setup();
    const P = await ctx.product("Zobo");
    await ctx.rpc("post_purchase", { date: "2026-02-01", items: [{ product_id: P, qty: 10, unit_cost: N(300) }] });
    await ctx.rpc("post_purchase", { date: "2026-02-03", items: [{ product_id: P, qty: 10, unit_cost: N(350) }] });
    await ctx.rpc("post_sale", { date: "2026-02-04", items: [{ product_id: P, qty: 12, unit_price: N(1_000) }] });
    const mv = await q<{ kind: string; balance: number }>(ctx, "select * from fin_stock_movements($1,$2) order by seq", [ctx.b, P]);
    expect(mv.at(-1)!.balance).toBe(8);
    const layers = await q<{ qty_remaining: number; remaining_value: number }>(ctx, "select * from fin_cost_layers($1,$2)", [ctx.b, P]);
    expect(layers).toHaveLength(1);
    expect(layers[0]).toMatchObject({ qty_remaining: 8, remaining_value: N(2_800) });
  });
});

describe("Plain-English summary", () => {
  it("says only what the numbers support", () => {
    const pnl = calculatePnl({ ...blank, sales_count: 40, gross_sales: N(4_850_000), sales_net: N(4_850_000), cogs_known: N(2_920_000), lines_actual: 40, opex_one_time: N(620_000) });
    const prev = calculatePnl({ ...blank, sales_count: 35, gross_sales: N(4_315_000), sales_net: N(4_315_000), cogs_known: N(2_753_000), lines_actual: 35, opex_one_time: N(600_000) });
    const s = businessSummary({ periodWord: "this week", prevWord: "last week", pnl, prev,
      topExpense: { name: "Logistics & delivery", amount: N(180_000) },
      topRevenueProduct: { name: "Orange juice", revenue: N(1_200_000) }, topProfitProduct: { name: "Green smoothie", profit: N(420_000) },
      receivables: { total: N(450_000), overdue: N(120_000) } });
    const text = s.map((x) => x.text).join(" ");
    expect(text).toContain("Your business sold ₦4.85m this week, up 12% on last week.");
    expect(text).toContain("Gross profit was ₦1.93m, a 39.8% margin. That's up from 36.2% last week.");
    expect(text).toContain("Operating expenses were ₦620,000, leaving a net profit of ₦1.31m.");
    expect(text).toContain("Your largest expense was logistics & delivery at ₦180,000.");
    expect(text).toContain("Orange juice brought in the most revenue (₦1.2m), while Green smoothie made the most profit (₦420,000).");
    expect(text).toContain("Customers owe you ₦450,000, of which ₦120,000 is overdue.");
  });

  it("reports a loss honestly and skips sentences with no data", () => {
    const pnl = calculatePnl({ ...blank, sales_count: 3, gross_sales: N(100_000), sales_net: N(100_000), cogs_known: N(60_000), lines_actual: 3, opex_recurring: N(90_000) });
    const s = businessSummary({ periodWord: "this week", prevWord: "last week", pnl, prev: null });
    expect(s.map((x) => x.key)).toEqual(["revenue", "grossProfit", "netProfit"]);
    expect(s[2].text).toContain("made a loss of ₦50,000");
    expect(s[2].tone).toBe("negative");
  });

  it("chart buckets compute profit the same way as the P&L", () => {
    const days = [
      { day: "2026-09-21", revenue: 1000, cogs_known: 400, revenue_missing_cost: 0, opex: 100, cash_in: 900, cash_out: 50 },
      { day: "2026-09-22", revenue: 500, cogs_known: 0, revenue_missing_cost: 500, opex: 100, cash_in: 500, cash_out: 0 },
    ];
    const [b] = bucketSeries(days, [{ label: "w", from: "2026-09-21", to: "2026-09-27" }]);
    expect(b).toMatchObject({ revenue: 1500, grossProfit: 600, netOperating: 400, incomplete: true, cashIn: 1400, cashOut: 50 });
  });
});
