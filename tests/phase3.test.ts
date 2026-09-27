// Phase 3: breakdowns reconcile to the P&L, payment split reconciles to invoices, stock summary reconciles to stock.
import { describe, it, expect, afterAll } from "vitest";
import { pool, setup, q, N, type Ctx } from "./helpers";
import { rpc } from "@/lib/db/core";

afterAll(() => pool.end());

async function scenario(ctx: Ctx) {
  const A = await ctx.product("Orange juice");
  const B = await ctx.product("Zobo");
  const C1 = await ctx.customer("Greenleaf", 30);
  const C2 = await ctx.customer("Pulse Gym", 7);
  await ctx.rpc("post_purchase", { date: "2026-03-01", items: [{ product_id: A, qty: 50, unit_cost: N(700) }, { product_id: B, qty: 50, unit_cost: N(400) }] });
  const s1 = await ctx.rpc<string>("post_sale", { customer_id: C1, date: "2026-03-02", items: [{ product_id: A, qty: 10, unit_price: N(1_500) }, { product_id: B, qty: 5, unit_price: N(1_000) }],
    payment: { account_id: ctx.bank, amount: N(12_000) } });
  await ctx.rpc("post_sale", { customer_id: C2, date: "2026-03-09", items: [{ product_id: B, qty: 20, unit_price: N(900) }], payment: { account_id: ctx.cash, amount: N(18_000) } });
  await ctx.rpc("post_sale", { date: "2026-03-10", items: [{ product_id: A, qty: 4, unit_price: N(1_500) }], payment: { account_id: ctx.cash, amount: N(6_000) } });
  const [line] = await q<{ id: string }>(ctx, "select id from sale_items where sale_id=$1 and product_id=$2", [s1, A]);
  await ctx.as((db) => rpc(db, "post_return", { sale_id: s1, date: "2026-03-12", restock: true, refund_method: "credit", items: [{ sale_item_id: line.id, qty: 2 }] }));
  return { A, B, C1, C2 };
}

describe("Analytics breakdowns", () => {
  it("every breakdown adds up to P&L revenue and gross profit", async () => {
    const ctx = await setup();
    await scenario(ctx);
    const p = await ctx.pnl("2026-03-01", "2026-03-31");
    for (const dim of ["product", "category", "customer", "salesperson", "day", "week", "month"]) {
      const rows = await q<{ revenue: number; gross_profit: number }>(ctx, "select * from fin_sales_breakdown($1,$2,$3,$4)", [ctx.b, "2026-03-01", "2026-03-31", dim]);
      expect(rows.reduce((a, r) => a + r.revenue, 0), dim).toBe(p.revenue);
      expect(rows.reduce((a, r) => a + r.gross_profit, 0), dim).toBe(p.grossProfit);
    }
    const byProduct = await q<{ label: string; units: number; revenue: number }>(ctx, "select * from fin_sales_breakdown($1,$2,$3,'product')", [ctx.b, "2026-03-01", "2026-03-31"]);
    expect(byProduct.find((r) => r.label === "Orange juice")).toMatchObject({ units: 12, revenue: N(18_000) }); // 10 + 4 − 2 returned
    const weeks = await q<{ key: string }>(ctx, "select * from fin_sales_breakdown($1,$2,$3,'week')", [ctx.b, "2026-03-01", "2026-03-31"]);
    expect(weeks.map((w) => w.key)).toEqual(["2026-03-02", "2026-03-09"]); // Mondays
  });

  it("payment split: paid by account + not yet paid = invoice totals after returns", async () => {
    const ctx = await setup();
    await scenario(ctx);
    const rows = await q<{ label: string; amount: number }>(ctx, "select * from fin_sales_by_payment($1,$2,$3)", [ctx.b, "2026-03-01", "2026-03-31"]);
    const total = rows.reduce((a, r) => a + r.amount, 0);
    // Invoices: 20,000 + 18,000 + 6,000 = 44,000; returned 3,000 → 41,000
    expect(total).toBe(N(41_000));
    expect(rows.find((r) => r.label === "Not paid yet")!.amount).toBe(N(5_000));
    expect(rows.find((r) => r.label === "Cash")!.amount).toBe(N(24_000));
  });
});

describe("Inventory summary", () => {
  it("opening + in − out = closing, and closing value matches stock value", async () => {
    const ctx = await setup();
    const { A } = await scenario(ctx);
    const rows = await q<{ product_id: string; opening: number; purchased: number; produced: number; used: number; sold: number; returned: number; adjusted: number; closing: number; closing_value: number }>(
      ctx, "select * from fin_inventory_summary($1,$2,$3)", [ctx.b, "2026-03-05", "2026-03-31"]);
    const a = rows.find((r) => r.product_id === A)!;
    expect(a).toMatchObject({ opening: 40, sold: 4, returned: 2, closing: 38 });
    for (const r of rows) expect(r.opening + r.purchased + r.produced - r.used - r.sold + r.returned + r.adjusted).toBe(r.closing);
    const [{ v }] = await q<{ v: number }>(ctx, "select fin_inventory_value_at($1,$2) v", [ctx.b, "2026-03-31"]);
    expect(rows.reduce((s, r) => s + r.closing_value, 0)).toBe(v);
  });
});
