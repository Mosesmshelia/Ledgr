// Recipes (migration 0014): saved ingredient lists that fill in a production batch.
import { describe, it, expect, afterAll } from "vitest";
import { pool, setup, q } from "./helpers";

afterAll(() => pool.end());

describe("Recipes", () => {
  it("saves, replaces and deletes a recipe", async () => {
    const ctx = await setup();
    const OJ = await ctx.product("Orange juice 50cl", { price: 150000 });
    const oranges = await ctx.product("Oranges", { unit: "kg", is_sellable: false });
    const bottle = await ctx.product("50cl bottle", { is_sellable: false });

    const id = await ctx.rpc("save_recipe", { product_id: OJ, yield_qty: 40, items: [{ ingredient_id: oranges, qty: 12 }, { ingredient_id: bottle, qty: 40 }] });
    expect(id).toBeTruthy();
    let items = await q<{ ingredient_id: string; qty: string }>(ctx, "select ingredient_id, qty from recipe_items where recipe_id = $1 order by qty", [id]);
    expect(items.map((i) => Number(i.qty))).toEqual([12, 40]);

    // Saving again replaces the list (same recipe row).
    const id2 = await ctx.rpc("save_recipe", { product_id: OJ, yield_qty: 20, items: [{ ingredient_id: oranges, qty: 6.5 }] });
    expect(id2).toBe(id);
    items = await q(ctx, "select ingredient_id, qty from recipe_items where recipe_id = $1", [id]);
    expect(items).toHaveLength(1);
    const [r] = await q<{ yield_qty: string }>(ctx, "select yield_qty from recipes where id = $1", [id]);
    expect(Number(r.yield_qty)).toBe(20);

    // No items → recipe removed.
    expect(await ctx.rpc("save_recipe", { product_id: OJ, yield_qty: 20, items: [] })).toBeNull();
    expect(await q(ctx, "select 1 from recipes where id = $1", [id])).toHaveLength(0);
  });

  it("refuses nonsense", async () => {
    const ctx = await setup();
    const OJ = await ctx.product("Orange juice");
    const sugar = await ctx.product("Sugar", { unit: "kg", is_sellable: false });
    await expect(ctx.rpc("save_recipe", { product_id: OJ, yield_qty: 0, items: [{ ingredient_id: sugar, qty: 1 }] })).rejects.toThrow(/above 0/);
    await expect(ctx.rpc("save_recipe", { product_id: OJ, yield_qty: 10, items: [{ ingredient_id: OJ, qty: 1 }] })).rejects.toThrow(/itself/);
    await expect(ctx.rpc("save_recipe", { product_id: OJ, yield_qty: 10, items: [{ ingredient_id: sugar, qty: 0 }] })).rejects.toThrow(/at least one/);
  });

  it("only owner/admin/accountant can save; nobody can write the tables directly", async () => {
    const ctx = await setup();
    const OJ = await ctx.product("Orange juice");
    const sugar = await ctx.product("Sugar", { is_sellable: false });
    await expect(q(ctx, "insert into recipes (business_id, product_id, yield_qty) values ($1,$2,1)", [ctx.b, OJ])).rejects.toThrow(/permission denied/);
    // A different business can't see it.
    await ctx.rpc("save_recipe", { product_id: OJ, yield_qty: 10, items: [{ ingredient_id: sugar, qty: 1 }] });
    const other = await setup();
    expect(await q(other, "select 1 from recipes where product_id = $1", [OJ])).toHaveLength(0);
  });
});
