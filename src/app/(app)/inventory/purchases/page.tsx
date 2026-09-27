import { Truck } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, cn } from "@/components/ui/primitives";
import { formatDate, todayIn } from "@/lib/finance";
import { InventoryTabs } from "../tabs";
import { PurchaseRowActions } from "./row-actions";
import { readListParams, Where, orderAndPage, pageOf, like } from "@/lib/server/list";
import { ListControls, Pager } from "@/components/app/list-controls";

export const metadata = { title: "Purchases" };

export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const today = todayIn(ctx.business.timezone);
  const lp = readListParams(await searchParams, { sort: "date" });
  const w = new Where("p.business_id = ?", ctx.business.id);
  if (lp.q) w.add(`(s.name ilike ? or p.supplier_invoice_no ilike ? or exists (select 1 from purchase_items pi2 join products pr2 on pr2.id = pi2.product_id where pi2.purchase_id = p.id and pr2.name ilike ?))`, like(lp.q), like(lp.q), like(lp.q));
  if (lp.from) w.add("p.date >= ?", lp.from);
  if (lp.to) w.add("p.date <= ?", lp.to);
  const st = lp.status;
  if (st === "unpaid") w.add("p.voided_at is null and app_purchase_outstanding(p.id) > 0");
  if (st === "overdue") w.add("p.voided_at is null and app_purchase_outstanding(p.id) > 0 and p.due_date < ?", today);
  if (st === "paid") w.add("p.voided_at is null and app_purchase_outstanding(p.id) = 0");
  if (st === "voided") w.add("p.voided_at is not null");
  const order = orderAndPage(lp, { date: "p.date", total: "p.total", owed: "app_purchase_outstanding(p.id)", supplier: "s.name" }, "date", w, "p.created_at desc");
  const raw = await ctx.q<{ id: string; date: string; due_date: string; supplier_invoice_no: string | null; supplier: string | null; supplier_id: string | null;
    total: number; outstanding: number; items: string; voided_at: string | null }>(`
    select p.id, p.date, p.due_date, p.supplier_invoice_no, s.name supplier, p.supplier_id, p.total, app_purchase_outstanding(p.id) outstanding, p.voided_at,
      (select string_agg(pr.name, ', ' order by pi.created_at) from purchase_items pi join products pr on pr.id = pi.product_id where pi.purchase_id = p.id) items
    from purchases p left join suppliers s on s.id = p.supplier_id
    where ${w.sql} ${order}`, w.params);
  const { rows, hasMore, page, pageSize } = pageOf(raw, lp);
  const filtered = !!(lp.q || lp.from || lp.to || lp.status);
  const accounts = await ctx.q<{ id: string; name: string; type: string }>("select id, name, type from cash_accounts where business_id=$1 and is_active order by created_at", [ctx.business.id]);

  return (
    <div className="animate-rise">
      <PageHeader title="Inventory" subtitle="Stock you've bought. It becomes a cost only when you sell it."
        actions={can(ctx.role, "record") ? <ButtonLink href="/inventory/purchases/new">Add purchase</ButtonLink> : undefined} />
      <InventoryTabs active="purchases" />
      <ListControls search="Search supplier, invoice or product"
        filters={[{ param: "status", label: "Payment status", options: [{ value: "unpaid", label: "Unpaid" }, { value: "overdue", label: "Overdue" }, { value: "paid", label: "Paid" }, { value: "voided", label: "Voided" }] }]}
        sorts={[{ value: "date:asc", label: "Oldest first" }, { value: "total:desc", label: "Largest first" }, { value: "owed:desc", label: "Most owed" }, { value: "supplier:asc", label: "Supplier A–Z" }]} />
      <Card className="overflow-hidden">
        {rows.length === 0 && filtered ? (
          <EmptyState icon={<Truck size={22} />} title="No matching purchases" body="Try a different search, date range or filter." />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Truck size={22} />} title="No purchases yet" body="Record stock you buy so Ledgr knows what your products cost." action={can(ctx.role, "record") ? <ButtonLink href="/inventory/purchases/new">Add purchase</ButtonLink> : undefined} />
        ) : (
          <ul>
            {rows.map((r, i) => {
              const status = r.voided_at ? { l: "Voided", t: "neutral" as const } : r.outstanding === 0 ? { l: "Paid", t: "positive" as const } :
                r.due_date < today ? { l: "Overdue", t: "negative" as const } : r.outstanding < r.total ? { l: "Part paid", t: "accent" as const } : { l: "Unpaid", t: "neutral" as const };
              return (
                <li key={r.id} className={cn("flex items-center gap-3 px-5 py-3", i > 0 && "border-t border-hairline", r.voided_at && "text-ink-3")}>
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium truncate">{r.supplier ?? "No supplier"}{r.supplier_invoice_no && <span className="text-ink-3 font-normal"> · {r.supplier_invoice_no}</span>}</div>
                    <div className="text-caption text-ink-2 truncate">{r.items}</div>
                    <div className="text-caption text-ink-3 num">{formatDate(r.date, true)}{r.outstanding > 0 && !r.voided_at && <> · due {formatDate(r.due_date)}</>}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={cn("text-body font-medium num", r.voided_at && "line-through")}><Money value={r.total} /></div>
                    <Badge tone={status.t} className="mt-1">{status.l}</Badge>
                    {!r.voided_at && r.outstanding > 0 && r.outstanding < r.total && <div className="text-caption text-ink-2 num"><Money value={r.outstanding} /> left</div>}
                  </div>
                  {!r.voided_at && can(ctx.role, "record") && <PurchaseRowActions id={r.id} supplierId={r.supplier_id} outstanding={r.outstanding} total={r.total} accounts={accounts} today={today} />}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Pager page={page} hasMore={hasMore} shown={rows.length} pageSize={pageSize} />
    </div>
  );
}
