import "server-only";
import type { Ctx } from "./session";
import { todayIn } from "@/lib/finance";

export const PAGE_SIZE = 30;

export interface SaleRow {
  id: string; invoice_no: string; date: string; due_date: string; customer_name: string; is_walk_in: boolean; total: number; net: number;
  outstanding: number; paid: number; voided_at: string | null; items: string; missing: number; estimated: number; returned: number;
}

const SALE_SORTS: Record<string, string> = { date: "s.date", total: "s.total", customer: "c.name", owed: "app_sale_outstanding(s.id)", invoice: "s.invoice_no" };

export async function listSales(ctx: Ctx, f: { q?: string; status?: string; cost?: string; page?: number; customer?: string; from?: string; to?: string; sort?: string; dir?: string }) {
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  // People who can't see costs (Sales role) read sale lines from a view with no cost columns.
  const SI = ctx.canSeeCosts ? "sale_items" : "v_sale_items_public";
  const where: string[] = ["s.business_id = $1"];
  const params: unknown[] = [b];
  if (f.q) { params.push(`%${f.q.replace(/[\\%_]/g, (c) => "\\" + c)}%`); where.push(`(s.invoice_no ilike $${params.length} or c.name ilike $${params.length} or exists (select 1 from ${SI} si2 join products p2 on p2.id = si2.product_id where si2.sale_id = s.id and p2.name ilike $${params.length}))`); }
  if (f.customer) { params.push(f.customer); where.push(`s.customer_id = $${params.length}`); }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (f.from && iso.test(f.from)) { params.push(f.from); where.push(`s.date >= $${params.length}`); }
  if (f.to && iso.test(f.to)) { params.push(f.to); where.push(`s.date <= $${params.length}`); }
  if (f.cost === "missing" && ctx.canSeeCosts) where.push(`exists (select 1 from sale_items x where x.sale_id = s.id and x.cost_status = 'missing') and s.voided_at is null`);
  if (f.status === "open") where.push("s.voided_at is null and app_sale_outstanding(s.id) > 0");
  if (f.status === "overdue") { params.push(today); where.push(`s.voided_at is null and app_sale_outstanding(s.id) > 0 and s.due_date < $${params.length}`); }
  if (f.status === "voided") where.push("s.voided_at is not null");
  const page = Math.max(1, f.page ?? 1);
  params.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const rows = await ctx.q<SaleRow>(`
    select s.id, s.invoice_no, s.date, s.due_date, c.name customer_name, c.is_walk_in, s.total, s.net, s.voided_at,
      app_sale_outstanding(s.id) outstanding, app_sale_paid(s.id) paid, app_sale_returned(s.id) returned,
      (select string_agg(p.name || case when si.qty <> 1 then ' ×' || trim(to_char(si.qty, 'FM999999990.###')) else '' end, ', ' order by si.created_at)
         from ${SI} si join products p on p.id = si.product_id where si.sale_id = s.id) items,
      ${ctx.canSeeCosts ? `(select count(*) from sale_items si where si.sale_id = s.id and si.cost_status = 'missing')::int missing,
      (select count(*) from sale_items si where si.sale_id = s.id and si.cost_status = 'estimated')::int estimated` : "0 missing, 0 estimated"}
    from sales s join customers c on c.id = s.customer_id
    where ${where.join(" and ")}
    order by ${SALE_SORTS[f.sort ?? ""] ?? "s.date"} ${f.dir === "asc" ? "asc" : "desc"} nulls last, s.created_at desc
    limit $${params.length - 1} offset $${params.length}`, params);
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, page, today };
}

export function saleStatus(r: { voided_at: string | null; outstanding: number; paid: number; due_date: string; total: number; returned?: number }, today: string) {
  if (r.voided_at) return "voided";
  if (r.outstanding <= 0) return "paid";
  if (r.due_date < today) return "overdue";
  if (r.paid > 0) return "partially_paid";
  return "unpaid";
}

export async function getSale(ctx: Ctx, id: string) {
  const [sale] = await ctx.q<SaleRow & { customer_id: string; notes: string | null; gross: number; discount_total: number; vat_amount: number; vat_rate_bp: number; void_reason: string | null; created_at: string; refunded: number; customer_phone: string | null }>(`
    select s.*, c.name customer_name, c.is_walk_in, c.phone customer_phone, app_sale_outstanding(s.id) outstanding, app_sale_paid(s.id) paid,
           app_sale_returned(s.id) returned, app_sale_refunded(s.id) refunded
    from sales s join customers c on c.id = s.customer_id where s.id = $1 and s.business_id = $2`, [id, ctx.business.id]);
  if (!sale) return null;
  const items = ctx.canSeeCosts
    ? await ctx.q<{ id: string; product_id: string; name: string; unit: string; qty: number; unit_price: number; gross_amount: number; discount_amount: number; net_amount: number; vat_amount: number; cogs: number | null; cost_status: string; uncovered_qty: number; returned_qty: number }>(`
        select si.*, p.name, p.unit,
          coalesce((select sum(ri.qty) from sale_return_items ri join sale_returns r on r.id = ri.return_id where ri.sale_item_id = si.id and r.voided_at is null), 0) returned_qty
        from sale_items si join products p on p.id = si.product_id where si.sale_id = $1 order by si.created_at`, [id])
    : await ctx.q<{ id: string; product_id: string; name: string; unit: string; qty: number; unit_price: number; gross_amount: number; discount_amount: number; net_amount: number; vat_amount: number; cogs: number | null; cost_status: string; uncovered_qty: number; returned_qty: number }>(`
        select si.*, p.name, p.unit, null::bigint cogs, 'hidden' cost_status, 0 uncovered_qty, 0 returned_qty
        from v_sale_items_public si join products p on p.id = si.product_id where si.sale_id = $1 order by si.created_at`, [id]);
  const payments = await ctx.q<{ id: string; date: string; amount: number; account: string; kind: string; voided_at: string | null; allocated: number }>(`
    select ct.id, ct.date, ct.amount, a.name account, ct.kind, ct.voided_at, pa.amount allocated
    from payment_allocations pa join cash_transactions ct on ct.id = pa.cash_transaction_id join cash_accounts a on a.id = ct.account_id
    where pa.target_type = 'sale' and pa.target_id = $1
    union all
    select ct.id, ct.date, ct.amount, a.name, ct.kind, ct.voided_at, -ct.amount
    from cash_transactions ct join cash_accounts a on a.id = ct.account_id join sale_returns r on ct.source_type = 'sale_return' and ct.source_id = r.id
    where r.sale_id = $1
    order by 2`, [id]);
  const returns = await ctx.q<{ id: string; date: string; reason: string | null; total: number; restock: boolean; refund_method: string; voided_at: string | null }>(
    "select id, date, reason, total, restock, refund_method, voided_at from sale_returns where sale_id = $1 order by date", [id]);
  return { sale, items, payments, returns };
}

export async function formOptions(ctx: Ctx) {
  const b = ctx.business.id;
  const [products, customers, accounts, suppliers] = [
    await ctx.q<{ id: string; name: string; sku: string | null; unit: string; selling_price: number | null; standard_cost: number | null; on_hand: number; avg_cost: number | null; is_sellable: boolean; category: string | null }>(`
      select p.id, p.name, p.sku, p.unit, p.selling_price, p.standard_cost, p.is_sellable, pc.name category, i.on_hand, i.avg_cost
      from products p left join product_categories pc on pc.id = p.category_id
      join fin_inventory($1) i on i.product_id = p.id
      where p.business_id = $1 and p.is_active order by p.is_sellable desc, p.name`, [b]).catch(async () =>
      ctx.q<{ id: string; name: string; sku: string | null; unit: string; selling_price: number | null; standard_cost: number | null; on_hand: number; avg_cost: number | null; is_sellable: boolean; category: string | null }>(
        "select p.id, p.name, p.sku, p.unit, p.selling_price, null::bigint standard_cost, p.is_sellable, null category, 0 on_hand, null::bigint avg_cost from products p where p.business_id=$1 and p.is_active order by p.name", [b])),
    await ctx.q<{ id: string; name: string; is_walk_in: boolean; payment_terms_days: number | null }>(
      "select id, name, is_walk_in, payment_terms_days from customers where business_id = $1 order by is_walk_in desc, name", [b]),
    await ctx.q<{ id: string; name: string; type: string }>("select id, name, type from cash_accounts where business_id = $1 and is_active order by created_at", [b]),
    await ctx.q<{ id: string; name: string }>("select id, name from suppliers where business_id = $1 order by name", [b]),
  ];
  return { products, customers, accounts, suppliers, today: todayIn(ctx.business.timezone) };
}
export type FormOptions = Awaited<ReturnType<typeof formOptions>>;
