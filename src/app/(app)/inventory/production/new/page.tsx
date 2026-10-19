import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireCap } from "@/lib/server/session";
import { formOptions } from "@/lib/server/queries";
import { can } from "@/lib/permissions";
import { ProductionForm, type Recipe } from "./production-form";

export const metadata = { title: "Made a batch" };

export default async function NewBatch({ searchParams }: { searchParams: Promise<{ product?: string }> }) {
  const ctx = await requireCap("record", "/inventory/production");
  const sp = await searchParams;
  const opts = await formOptions(ctx);
  const rows = await ctx.q<{ product_id: string; yield_qty: number; ingredient_id: string; qty: number }>(`
    select r.product_id, r.yield_qty::float8 yield_qty, i.ingredient_id, i.qty::float8 qty
    from recipes r join recipe_items i on i.recipe_id = r.id where r.business_id = $1 order by r.product_id, i.id`, [ctx.business.id]);
  const recipes: Recipe[] = [];
  for (const r of rows) {
    let rec = recipes.find((x) => x.product_id === r.product_id);
    if (!rec) recipes.push(rec = { product_id: r.product_id, yield_qty: r.yield_qty, items: [] });
    rec.items.push({ ingredient_id: r.ingredient_id, qty: r.qty });
  }
  const initial = sp.product && opts.products.some((p) => p.id === sp.product) ? sp.product : null;
  return (
    <div className="animate-rise">
      <Link href="/inventory/production" className="tap inline-flex items-center gap-1 text-body text-accent mb-2"><ChevronLeft size={18} />Production</Link>
      <h1 className="text-title font-bold font-display">Made a batch</h1>
      <p className="text-body text-ink-2 mt-0.5 mb-5">Tell Ledgr what you made. It takes the ingredients out of stock and works out what each one cost you.</p>
      <ProductionForm opts={opts} recipes={recipes} canEditRecipes={can(ctx.role, "record")} initialProduct={initial} />
    </div>
  );
}
