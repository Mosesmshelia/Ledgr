import { requireCap } from "@/lib/server/session";
import { ShoppingList, type ShopItem } from "./shopping-list";

export const metadata = { title: "Shopping list" };

export default async function ShoppingPage() {
  const ctx = await requireCap("reports", "/dashboard");
  const b = ctx.business.id;
  // Everything running low, plus things that ran out after being stocked before. Last supplier and price come from the latest purchase.
  const rows = await ctx.q<{ product_id: string; name: string; unit: string; is_sellable: boolean; on_hand: number; min_stock: number;
    low_stock: boolean; supplier_id: string | null; supplier: string | null; supplier_phone: string | null; last_qty: number | null; last_cost: number | null }>(`
    select i.product_id, p.name, p.unit, p.is_sellable, i.on_hand::float8 on_hand, p.min_stock::float8 min_stock, i.low_stock,
      lp.supplier_id, lp.supplier, lp.supplier_phone, lp.qty::float8 last_qty, ${ctx.canSeeCosts ? "lp.unit_cost" : "null::bigint"} last_cost
    from fin_inventory($1) i join products p on p.id = i.product_id
    left join lateral (
      select pu.supplier_id, s.name supplier, s.phone supplier_phone, pi.qty, pi.unit_cost
      from purchase_items pi join purchases pu on pu.id = pi.purchase_id left join suppliers s on s.id = pu.supplier_id
      where pi.product_id = p.id and pu.voided_at is null order by pu.date desc, pu.created_at desc limit 1
    ) lp on true
    where p.business_id = $1 and p.is_active
      and (i.low_stock or (i.on_hand <= 0 and exists (select 1 from inventory_transactions t where t.product_id = p.id and t.kind <> 'void_reversal')))
    order by p.is_sellable, p.name`, [b]);
  // Products with a recipe go under "To make" (empty until database update 0014 is applied).
  const withRecipe = new Set((await ctx.q<{ product_id: string }>("select product_id from recipes where business_id = $1", [b]).catch(() => [])).map((r) => r.product_id));
  const suppliers = await ctx.q<{ id: string; name: string; phone: string | null }>("select id, name, phone from suppliers where business_id = $1 order by name", [b]);

  const items: ShopItem[] = rows.map((r) => {
    // Suggest topping up to twice the warning level, or repeating the last purchase when no level is set.
    const target = r.min_stock > 0 ? r.min_stock * 2 : (r.last_qty ?? 1);
    const suggest = Math.max(r.min_stock > 0 ? r.min_stock : 1, Math.ceil(target - Math.max(0, r.on_hand)));
    return {
      id: r.product_id, name: r.name, unit: r.unit, onHand: r.on_hand, minStock: r.min_stock, suggest,
      make: r.is_sellable && withRecipe.has(r.product_id), supplierId: r.supplier_id, supplier: r.supplier, supplierPhone: r.supplier_phone, lastCost: r.last_cost,
    };
  });
  return <ShoppingList businessId={b} businessName={ctx.business.name} items={items} suppliers={suppliers} canRecord={ctx.role !== "viewer"} />;
}
