import { requireCap } from "@/lib/server/session";
import { formOptions } from "@/lib/server/queries";
import { Till, type LastSale } from "./till";

export const metadata = { title: "New sale" };

export default async function NewSale() {
  const ctx = await requireCap("sell", "/sales");
  const opts = await formOptions(ctx);
  const b = ctx.business;
  // "Repeat last": this person's most recent sale that wasn't voided.
  const [last] = await ctx.q<{ id: string; customer_id: string }>(
    "select id, customer_id from sales where business_id = $1 and salesperson_id = $2 and voided_at is null order by created_at desc limit 1", [b.id, ctx.userId]);
  const lastSale: LastSale | null = last ? {
    customer_id: last.customer_id,
    items: await ctx.q<{ product_id: string; qty: number; unit_price: number }>(
      "select product_id, qty::float8 qty, unit_price from v_sale_items_public where sale_id = $1 order by created_at", [last.id]),
  } : null;
  return (
    <Till opts={opts} canSeeCosts={ctx.canSeeCosts} defaultTerms={b.default_payment_terms_days} lastSale={lastSale}
      vat={b.vat_registered ? { rateBp: b.vat_rate_bp, inclusive: b.prices_include_vat } : null} />
  );
}
