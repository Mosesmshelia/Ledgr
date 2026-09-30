// Removing products entered by mistake (migration 0013).
import { describe, it, expect, afterAll } from "vitest";
import { pool, setup, q, N } from "./helpers";

afterAll(() => pool.end());

describe("Remove product", () => {
  it("never used → deleted completely, with an audit record", async () => {
    const ctx = await setup();
    const P = await ctx.product("Typo juice");
    expect((await ctx.rpc<{ mode: string }>("product_removal_check", { product_id: P })).mode).toBe("delete");
    expect(await ctx.rpc("remove_product", { product_id: P })).toBe("deleted");
    expect(await q(ctx, "select 1 from products where id = $1", [P])).toHaveLength(0);
    const [a] = await q<{ action: string; reason: string }>(ctx, "select action, reason from audit_log where record_id = $1 and action = 'remove'", [P]);
    expect(a).toMatchObject({ action: "remove", reason: "Entered by mistake" });
  });

  it("only unsold opening stock → opening stock cancelled (no cost), product archived and hidden", async () => {
    const ctx = await setup();
    const P = await ctx.product("Wrong zobo");
    await ctx.rpc("set_opening_stock", { product_id: P, qty: 40, unit_cost: N(500), date: "2026-09-01" });
    const before = (await q<{ v: number }>(ctx, "select fin_inventory_value_at($1,'2026-09-30') v", [ctx.b]))[0].v;
    expect(before).toBe(N(20_000));
    expect((await ctx.rpc<{ mode: string }>("product_removal_check", { product_id: P })).mode).toBe("void_opening");
    expect(await ctx.rpc("remove_product", { product_id: P })).toBe("archived");
    // Stock value back to zero at every date, and no cost of goods appears.
    expect((await q<{ v: number }>(ctx, "select fin_inventory_value_at($1,'2026-09-30') v", [ctx.b]))[0].v).toBe(0);
    expect((await q<{ v: number }>(ctx, "select fin_inventory_value_at($1,'2026-09-15') v", [ctx.b]))[0].v).toBe(0);
    const p = await ctx.pnl("2026-09-01", "2026-09-30");
    expect(p.cogs).toBe(0);
    // Archived: gone from the product picker used by sale and purchase forms.
    const [prod] = await q<{ is_active: boolean }>(ctx, "select is_active from products where id = $1", [P]);
    expect(prod.is_active).toBe(false);
    // Restore brings it back (without the cancelled stock).
    expect(await ctx.rpc("remove_product", { product_id: P })).toBe("restored");
    expect((await q<{ on_hand: number }>(ctx, "select on_hand from fin_inventory($1) where product_id = $2", [ctx.b, P]))[0].on_hand).toBe(0);
  });

  it("has history and stock → refused with a clear reason; with history and no stock → archived", async () => {
    const ctx = await setup();
    const P = await ctx.product("Orange juice");
    await ctx.rpc("post_purchase", { date: "2026-09-01", items: [{ product_id: P, qty: 5, unit_cost: N(700) }] });
    await ctx.rpc("post_sale", { date: "2026-09-02", items: [{ product_id: P, qty: 2, unit_price: N(1_500) }] });
    const c = await ctx.rpc<{ mode: string; message: string }>("product_removal_check", { product_id: P });
    expect(c.mode).toBe("blocked");
    expect(c.message).toMatch(/still has 3 units in stock/);
    await expect(ctx.rpc("remove_product", { product_id: P })).rejects.toThrow(/still has 3/);
    await ctx.rpc("post_sale", { date: "2026-09-03", items: [{ product_id: P, qty: 3, unit_price: N(1_500) }] });
    expect(await ctx.rpc("remove_product", { product_id: P })).toBe("archived");
    // History intact: the P&L still shows both sales.
    expect((await ctx.pnl("2026-09-01", "2026-09-30")).revenue).toBe(N(7_500));
  });
});
