// The 18 golden financial tests from PLAN.md §11. Every expected value is exact, in kobo.
import { describe, it, expect, afterAll } from "vitest";
import { pool, setup, q, N, type Ctx } from "./helpers";
import { accrualBetween, comparePeriods, calculateBudgetVariance, formatPercent } from "@/lib/finance";
import { withUser, rpc } from "@/lib/db/core";

afterAll(() => pool.end());

async function stock(ctx: Ctx, productId: string) {
  const rows = await q<{ product_id: string; on_hand: number; value: number }>(ctx, "select * from fin_inventory($1)", [ctx.b]);
  return rows.find((r) => r.product_id === productId)!;
}
async function cashTotal(ctx: Ctx, from = "2026-01-01", to = "2026-12-31") {
  const rows = await q<{ closing: number }>(ctx, "select * from fin_cash_accounts($1,$2,$3)", [ctx.b, from, to]);
  return rows.reduce((a, r) => a + r.closing, 0);
}

/** Test 1 setup: A 2×₦100,000 (cost ₦70,000), B 1×₦150,000 (cost ₦90,000) */
async function saleAB(ctx: Ctx, extra: Record<string, unknown> = {}) {
  const A = await ctx.product("Orange juice 1L", { price: N(100_000) });
  const B = await ctx.product("Pineapple juice 1L", { price: N(150_000) });
  await ctx.rpc("post_purchase", { date: "2026-03-01", items: [
    { product_id: A, qty: 2, unit_cost: N(70_000) }, { product_id: B, qty: 1, unit_cost: N(90_000) }] });
  const sale = await ctx.rpc<string>("post_sale", { date: "2026-03-02", items: [
    { product_id: A, qty: 2, unit_price: N(100_000) }, { product_id: B, qty: 1, unit_price: N(150_000) }], ...extra });
  return { A, B, sale };
}

describe("Golden financial tests", () => {
  it("1. multi-product sale: revenue, COGS, gross profit, margin", async () => {
    const ctx = await setup();
    await saleAB(ctx);
    const p = await ctx.pnl("2026-03-02", "2026-03-02");
    expect(p.revenue).toBe(N(350_000));
    expect(p.cogs).toBe(N(230_000));
    expect(p.grossProfit).toBe(N(120_000));
    expect(formatPercent(p.grossMargin, 2)).toBe("34.29%");
    expect(p.status).toBe("complete");
  });

  it("2. FIFO: oldest cost first", async () => {
    const ctx = await setup();
    const P = await ctx.product("Mango juice");
    await ctx.rpc("post_purchase", { date: "2026-02-01", items: [{ product_id: P, qty: 10, unit_cost: N(70_000) }] });
    await ctx.rpc("post_purchase", { date: "2026-02-05", items: [{ product_id: P, qty: 10, unit_cost: N(80_000) }] });
    await ctx.rpc("post_sale", { date: "2026-02-10", items: [{ product_id: P, qty: 15, unit_price: N(120_000) }] });
    const p = await ctx.pnl("2026-02-10", "2026-02-10");
    expect(p.cogs).toBe(N(1_100_000));
    const s = await stock(ctx, P);
    expect(s.on_hand).toBe(5);
    expect(s.value).toBe(N(400_000));
  });

  it("3. credit purchase is stock and a payable, not an expense", async () => {
    const ctx = await setup();
    const S = await ctx.supplier("Fruit Farm Ltd");
    const P = await ctx.product("Oranges (crate)", { is_sellable: false });
    const before = await cashTotal(ctx);
    await ctx.rpc("post_purchase", { supplier_id: S, date: "2026-04-01", items: [{ product_id: P, qty: 100, unit_cost: N(10_000) }] });
    expect((await stock(ctx, P)).value).toBe(N(1_000_000));
    const pay = await q<{ outstanding: number }>(ctx, "select * from fin_payables($1,$2)", [ctx.b, "2026-04-01"]);
    expect(pay.reduce((a, r) => a + r.outstanding, 0)).toBe(N(1_000_000));
    const p = await ctx.pnl("2026-04-01", "2026-04-30");
    expect(p.operatingExpenses).toBe(0);
    expect(p.cogs).toBe(0);
    expect(await cashTotal(ctx)).toBe(before);
  });

  it("4. partial payment creates a receivable, then goes overdue", async () => {
    const ctx = await setup();
    const C = await ctx.customer("Shoprite Wuse", 14);
    const P = await ctx.product("Juice carton");
    await ctx.rpc("set_opening_stock", { product_id: P, qty: 10, unit_cost: N(30_000), date: "2026-05-01" });
    const sale = await ctx.rpc<string>("post_sale", { customer_id: C, date: "2026-05-02",
      items: [{ product_id: P, qty: 5, unit_price: N(100_000) }], payment: { account_id: ctx.bank, amount: N(300_000) } });
    const p = await ctx.pnl("2026-05-02", "2026-05-02");
    expect(p.revenue).toBe(N(500_000));
    const cash = await q<{ cash_in: number }>(ctx, "select * from fin_cash_accounts($1,$2,$3)", [ctx.b, "2026-05-02", "2026-05-02"]);
    expect(cash.reduce((a, r) => a + r.cash_in, 0)).toBe(N(300_000));
    const [r1] = await q<{ outstanding: number; status: string; sale_id: string }>(ctx, "select * from fin_receivables($1,$2)", [ctx.b, "2026-05-10"]);
    expect(r1.sale_id).toBe(sale);
    expect(r1.outstanding).toBe(N(200_000));
    expect(r1.status).toBe("partially_paid");
    const [r2] = await q<{ status: string; days_overdue: number }>(ctx, "select * from fin_receivables($1,$2)", [ctx.b, "2026-05-20"]);
    expect(r2.status).toBe("overdue");
    expect(r2.days_overdue).toBe(4);
  });

  it("5. VAT is a liability, never revenue (exclusive and inclusive)", async () => {
    const ctx = await setup({ vat_registered: true, vat_rate_bp: 750 });
    const P = await ctx.product("Smoothie");
    await ctx.rpc("set_opening_stock", { product_id: P, qty: 10, unit_cost: N(40_000), date: "2026-06-01" });
    const s1 = await ctx.rpc<string>("post_sale", { date: "2026-06-02", items: [{ product_id: P, qty: 1, unit_price: N(100_000) }] });
    const [sale] = await q<{ total: number; net: number; vat_amount: number }>(ctx, "select * from sales where id = $1", [s1]);
    expect(sale.total).toBe(N(107_500));
    expect(sale.net).toBe(N(100_000));
    expect(sale.vat_amount).toBe(N(7_500));
    let p = await ctx.pnl("2026-06-02", "2026-06-02");
    expect(p.revenue).toBe(N(100_000));
    expect(p.vatCollected).toBe(N(7_500));

    await ctx.rpc("update_business_settings", { prices_include_vat: true });
    const s2 = await ctx.rpc<string>("post_sale", { date: "2026-06-03", items: [{ product_id: P, qty: 1, unit_price: N(107_500) }] });
    const [inc] = await q<{ total: number; net: number; vat_amount: number }>(ctx, "select * from sales where id = $1", [s2]);
    expect(inc.total).toBe(N(107_500));
    expect(inc.net).toBe(N(100_000));
    expect(inc.vat_amount).toBe(N(7_500));
    p = await ctx.pnl("2026-06-03", "2026-06-03");
    expect(p.revenue).toBe(N(100_000));
  });

  it("6. return reverses revenue and COGS and restocks at original cost", async () => {
    const ctx = await setup();
    const { A, sale } = await saleAB(ctx);
    const [lineA] = await q<{ id: string }>(ctx, "select id from sale_items where sale_id = $1 and product_id = $2", [sale, A]);
    await ctx.as((db) => rpc(db, "post_return", { sale_id: sale, date: "2026-03-03", restock: true, refund_method: "credit",
      items: [{ sale_item_id: lineA.id, qty: 1 }] }));
    const p = await ctx.pnl("2026-03-01", "2026-03-31");
    expect(p.revenue).toBe(N(250_000));
    expect(p.cogs).toBe(N(160_000));
    expect(p.grossProfit).toBe(N(90_000));
    const s = await stock(ctx, A);
    expect(s.on_hand).toBe(1);
    expect(s.value).toBe(N(70_000));
  });

  it("7. annual rent accrues exactly by day", async () => {
    const ctx = await setup();
    await q(ctx, "insert into recurring_expenses (business_id, name, category_id, amount, frequency, start_date) values ($1,'Shop rent',$2,$3,'annual','2026-01-01')",
      [ctx.b, ctx.cat["Rent"], N(1_200_000)]);
    const sum = async (f: string, t: string) =>
      (await q<{ amount: number }>(ctx, "select * from fin_recurring_accrual($1,$2,$3)", [ctx.b, f, t])).reduce((a, r) => a + r.amount, 0);
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      const last = new Date(Date.UTC(2026, m, 0)).getUTCDate();
      expect(await sum(`2026-${mm}-01`, `2026-${mm}-${last}`)).toBe(N(100_000));
    }
    expect(await sum("2026-09-21", "2026-09-27")).toBe(2_333_334);          // ₦23,333.34
    expect(await sum("2026-09-28", "2026-10-04")).toBe(1_000_000 + 1_290_322); // ₦10,000.00 + ₦12,903.22
    expect(await sum("2026-01-01", "2026-12-31")).toBe(N(1_200_000));
    // The TypeScript mirror agrees with the database.
    const r = { amount: N(1_200_000), frequency: "annual" as const, start_date: "2026-01-01" };
    expect(accrualBetween(r, "2026-09-21", "2026-09-27")).toBe(2_333_334);
    expect(accrualBetween(r, "2026-09-28", "2026-10-04")).toBe(2_290_322);
  });

  it("8. paying rent upfront is prepaid, not a one-month expense", async () => {
    const ctx = await setup();
    const [re] = await q<{ id: string }>(ctx,
      "insert into recurring_expenses (business_id, name, category_id, amount, frequency, start_date) values ($1,'Shop rent',$2,$3,'annual','2026-01-01') returning id",
      [ctx.b, ctx.cat["Rent"], N(1_200_000)]);
    await ctx.as((db) => rpc(db, "record_recurring_payment", { recurring_expense_id: re.id, account_id: ctx.bank, date: "2026-01-01", amount: N(1_200_000) }));
    expect(await cashTotal(ctx, "2026-01-01", "2026-01-31")).toBe(-N(1_200_000));
    const jan = await ctx.pnl("2026-01-01", "2026-01-31");
    expect(jan.operatingExpenses).toBe(N(100_000));
    const bal = async (d: string) => (await q<{ balance: number }>(ctx, "select * from fin_recurring_status($1,$2)", [ctx.b, d]))[0].balance;
    expect(await bal("2026-01-31")).toBe(N(1_100_000));
    expect(await bal("2026-09-30")).toBe(N(300_000));
  });

  it("9. production batch sets unit cost; rounding never loses a kobo", async () => {
    const ctx = await setup();
    const J = await ctx.product("Fresh orange juice 50cl");
    const batch = await ctx.rpc<string>("post_production", { product_id: J, date: "2026-07-01", qty: 100, costs: [
      { kind: "materials", amount: N(500_000) }, { kind: "labour", amount: N(100_000) },
      { kind: "packaging", amount: N(50_000) }, { kind: "transport", amount: N(30_000) }] });
    const [b] = await q<{ total_cost: number }>(ctx, "select total_cost from production_batches where id = $1", [batch]);
    expect(b.total_cost / 100).toBe(N(6_800));
    await ctx.rpc("post_sale", { date: "2026-07-02", items: [{ product_id: J, qty: 20, unit_price: N(10_000) }] });
    expect((await ctx.pnl("2026-07-02", "2026-07-02")).cogs).toBe(N(136_000));

    const T = await ctx.product("Test juice");
    await ctx.rpc("post_production", { product_id: T, date: "2026-07-03", qty: 3, costs: [{ kind: "other", amount: N(1_000) }] });
    const cogs: number[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await ctx.rpc<string>("post_sale", { date: "2026-07-04", items: [{ product_id: T, qty: 1, unit_price: N(500) }] });
      cogs.push((await q<{ cogs: number }>(ctx, "select cogs from sale_items where sale_id = $1", [s]))[0].cogs);
    }
    expect(cogs).toEqual([33_333, 33_333, 33_334]);
    expect(cogs.reduce((a, c) => a + c, 0)).toBe(N(1_000));
  });

  it("10. missing cost is never treated as 100% profit, and settles when stock arrives", async () => {
    const ctx = await setup();
    const C = await ctx.product("Zobo drink");
    await expect(ctx.rpc("post_sale", { date: "2026-08-01", items: [{ product_id: C, qty: 1, unit_price: N(50_000) }] }))
      .rejects.toMatchObject({ hint: "INSUFFICIENT_STOCK" });
    await ctx.rpc("post_sale", { date: "2026-08-01", allow_negative_stock: true, items: [{ product_id: C, qty: 1, unit_price: N(50_000) }] });
    let p = await ctx.pnl("2026-08-01", "2026-08-01");
    expect(p.revenue).toBe(N(50_000));
    expect(p.status).toBe("missing_data");
    expect(p.excludedRevenue).toBe(N(50_000));
    expect(p.grossMargin).toBeNull();          // not 100%
    expect(p.grossProfit).toBe(0);             // the sale is left out, not counted as profit
    expect(p.statusNote).toContain("1 sale");
    // Stock arrives → the earlier sale gets its real cost.
    await ctx.rpc("post_purchase", { date: "2026-08-02", items: [{ product_id: C, qty: 5, unit_cost: N(30_000) }] });
    p = await ctx.pnl("2026-08-01", "2026-08-01");
    expect(p.status).toBe("complete");
    expect(p.cogs).toBe(N(30_000));
    expect(p.grossProfit).toBe(N(20_000));
    expect((await stock(ctx, C)).on_hand).toBe(4);
  });

  it("11. zero revenue shows — for margins; comparisons use words", async () => {
    const ctx = await setup();
    const p = await ctx.pnl("2026-01-01", "2026-01-31");
    expect(p.revenue).toBe(0);
    expect(p.grossMargin).toBeNull();
    expect(p.netMargin).toBeNull();
    expect(formatPercent(p.grossMargin)).toBe("—");
    expect(comparePeriods(N(100), 0)).toEqual({ kind: "new" });
    expect(comparePeriods(N(500), -N(200), { profitLike: true })).toEqual({ kind: "turned_profit" });
    expect(comparePeriods(-N(50), N(200), { profitLike: true })).toEqual({ kind: "turned_loss" });
    expect(comparePeriods(0, 0)).toEqual({ kind: "none" });
  });

  it("12. loans and owner withdrawals move cash, not profit", async () => {
    const ctx = await setup();
    await ctx.rpc("record_cash_movement", { kind: "loan_received", account_id: ctx.bank, date: "2026-02-01", amount: N(2_000_000) });
    await ctx.rpc("record_cash_movement", { kind: "owner_withdrawal", account_id: ctx.bank, date: "2026-02-02", amount: N(300_000) });
    expect(await cashTotal(ctx)).toBe(N(1_700_000));
    const p = await ctx.pnl("2026-02-01", "2026-02-28");
    expect(p.revenue).toBe(0);
    expect(p.operatingExpenses).toBe(0);
    expect(p.netProfit).toBe(0);
  });

  it("13. voided sale drops out of totals, restores stock, and is audited", async () => {
    const ctx = await setup();
    const { A, sale } = await saleAB(ctx);
    await ctx.as((db) => rpc(db, "void_document", { type: "sale", id: sale, reason: "Entered twice by mistake" }));
    const p = await ctx.pnl("2026-03-02", "2026-03-02");
    expect(p.revenue).toBe(0);
    expect(p.cogs).toBe(0);
    const s = await stock(ctx, A);
    expect(s.on_hand).toBe(2);
    expect(s.value).toBe(N(140_000));
    const audit = await q<{ action: string; reason: string }>(ctx, "select action, reason from audit_log where record_id = $1 and action = 'void'", [sale]);
    expect(audit).toEqual([{ action: "void", reason: "Entered twice by mistake" }]);
    await expect(ctx.as((db) => db.query("delete from sales where id = $1", [sale]))).rejects.toThrow();
  });

  it("14. COGS reconciles: opening stock + additions − closing stock = COGS", async () => {
    const ctx = await setup();
    const raw = await ctx.product("Oranges (kg)", { is_sellable: false, unit: "kg" });
    const J = await ctx.product("Orange juice 1L");
    const Y = await ctx.product("Yoghurt");
    await ctx.rpc("set_opening_stock", { product_id: Y, qty: 7, unit_cost: 123_457, date: "2026-01-31" });
    const pur1 = await ctx.rpc<string>("post_purchase", { date: "2026-02-01", items: [{ product_id: raw, qty: 33.5, unit_cost: 77_777 }],
      costs: [{ kind: "shipping", amount: 100_001 }] });
    await ctx.rpc("post_purchase", { date: "2026-02-02", items: [{ product_id: Y, qty: 11, unit_cost: 99_999 }] });
    const batch = await ctx.rpc<string>("post_production", { product_id: J, date: "2026-02-03", qty: 17, costs: [
      { kind: "materials", consumed_product_id: raw, consumed_qty: 20.25 }, { kind: "labour", amount: 333_333 }] });
    for (const [d, qJ, qY] of [["2026-02-04", 5, 3], ["2026-02-10", 7, 6], ["2026-02-20", 3, 4]] as const) {
      await ctx.rpc("post_sale", { date: d, items: [{ product_id: J, qty: qJ, unit_price: 250_000 }, { product_id: Y, qty: qY, unit_price: 200_000 }] });
    }
    const val = async (d: string) => (await q<{ v: number }>(ctx, "select fin_inventory_value_at($1,$2) as v", [ctx.b, d]))[0].v;
    const opening = await val("2026-01-31");
    const closing = await val("2026-02-28");
    const [{ purchases }] = await q<{ purchases: number }>(ctx, "select coalesce(sum(total),0)::bigint purchases from purchases where business_id=$1 and date between '2026-02-01' and '2026-02-28'", [ctx.b]);
    const [{ labour }] = await q<{ labour: number }>(ctx, "select coalesce(sum(amount),0)::bigint labour from production_costs where batch_id=$1 and consumed_product_id is null", [batch]);
    const p = await ctx.pnl("2026-02-01", "2026-02-28");
    expect(opening).toBe(7 * 123_457);
    expect(opening + purchases + labour - closing).toBe(p.cogs);
    expect(p.status).toBe("complete");
    void pur1;
  });

  it("15. budget vs actual", () => {
    const v = calculateBudgetVariance(N(200_000), N(245_000));
    expect(v.variance).toBe(N(45_000));
    expect(formatPercent(v.ratio, 1, true)).toBe("+22.5%");
    expect(v.over).toBe(true);
  });

  it("16. invoice discount is shared across lines by value", async () => {
    const ctx = await setup();
    const { sale } = await saleAB(ctx, { invoice_discount: N(35_000) });
    const lines = await q<{ discount_amount: number; net_amount: number }>(ctx, "select discount_amount, net_amount from sale_items where sale_id=$1 order by created_at", [sale]);
    expect(lines.map((l) => l.discount_amount)).toEqual([N(20_000), N(15_000)]);
    expect((await ctx.pnl("2026-03-02", "2026-03-02")).revenue).toBe(N(315_000));
  });

  it("17. transfers between your own accounts are not income or expense", async () => {
    const ctx = await setup();
    await ctx.rpc("record_cash_movement", { kind: "capital_injection", account_id: ctx.bank, date: "2026-03-01", amount: N(1_000_000) });
    await ctx.rpc("transfer_cash", { from_account_id: ctx.bank, to_account_id: ctx.cash, date: "2026-03-02", amount: N(500_000) });
    const acc = await q<{ name: string; closing: number }>(ctx, "select * from fin_cash_accounts($1,$2,$3)", [ctx.b, "2026-03-01", "2026-03-31"]);
    expect(acc.find((a) => a.name === "Bank")!.closing).toBe(N(500_000));
    expect(acc.find((a) => a.name === "Cash")!.closing).toBe(N(500_000));
    const kinds = await q<{ kind: string }>(ctx, "select * from fin_cash_by_kind($1,$2,$3)", [ctx.b, "2026-03-01", "2026-03-31"]);
    expect(kinds.map((k) => k.kind)).toEqual(["capital_injection"]);
    const p = await ctx.pnl("2026-03-01", "2026-03-31");
    expect(p.netProfit).toBe(0);
  });

  it("18. two sales racing for the last unit never double-use stock", async () => {
    const ctx = await setup();
    const P = await ctx.product("Last bottle");
    await ctx.rpc("set_opening_stock", { product_id: P, qty: 1, unit_cost: N(1_000), date: "2026-04-01" });
    const attempt = () => withUser(pool, ctx.uid, (db) => rpc(db, "post_sale", { business_id: ctx.b, date: "2026-04-02",
      items: [{ product_id: P, qty: 1, unit_price: N(2_000) }] }));
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failed.reason.hint).toBe("INSUFFICIENT_STOCK");
    const [{ n }] = await q<{ n: number }>(ctx, "select count(*)::int n from cost_allocations ca join cost_layers cl on cl.id = ca.cost_layer_id where cl.product_id = $1", [P]);
    expect(n).toBe(1);
  });
});

describe("Security", () => {
  it("a user can't see or post into another business", async () => {
    const a = await setup();
    const b = await setup();
    const { sale } = await saleAB(a);
    const seen = await q(b, "select * from sales where id = $1", [sale]);
    expect(seen).toHaveLength(0);
    await expect(b.as((db) => rpc(db, "post_sale", { business_id: a.b, items: [] }))).rejects.toThrow(/permission/);
    await expect(b.as((db) => db.query("select fin_pnl($1,'2026-01-01','2026-12-31')", [a.b]))).rejects.toThrow(/permission/);
  });

  it("documents can't be written directly, only through posting functions", async () => {
    const ctx = await setup();
    await expect(ctx.as((db) => db.query(
      "insert into sales (business_id, invoice_no, date, due_date, gross, net, total) values ($1,'X','2026-01-01','2026-01-01',1,1,1)", [ctx.b])))
      .rejects.toThrow();
    await expect(ctx.as((db) => db.query("update inventory_transactions set qty_change = 0"))).rejects.toThrow();
  });
});
