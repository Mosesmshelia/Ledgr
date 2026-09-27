import Link from "next/link";
import { Factory } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, cn } from "@/components/ui/primitives";
import { formatDate, formatQty } from "@/lib/finance";
import { InventoryTabs } from "../tabs";
import { VoidBatchButton } from "./void-batch";
import { readListParams, Where, orderAndPage, pageOf, like } from "@/lib/server/list";
import { ListControls, Pager, SortTh } from "@/components/app/list-controls";

export const metadata = { title: "Production" };

export default async function ProductionPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const lp = readListParams(await searchParams, { sort: "date" });
  const w = new Where("pb.business_id = ?", ctx.business.id);
  if (lp.q) w.add("(p.name ilike ? or pb.batch_no ilike ?)", like(lp.q), like(lp.q));
  if (lp.from) w.add("pb.date >= ?", lp.from);
  if (lp.to) w.add("pb.date <= ?", lp.to);
  if (lp.state === "active") w.add("pb.voided_at is null");
  if (lp.state === "voided") w.add("pb.voided_at is not null");
  const order = orderAndPage(lp, { date: "pb.date", batch: "pb.batch_no", product: "p.name", qty: "pb.qty_produced", cost: "pb.total_cost", unit: "pb.total_cost / nullif(pb.qty_produced, 0)" }, "date", w, "pb.created_at desc");
  const raw = await ctx.q<{ id: string; batch_no: string; date: string; product_id: string; product: string; unit: string; qty_produced: number; total_cost: number;
    voided_at: string | null; void_reason: string | null; estimated: number; lines: string; remaining: number }>(`
    select pb.id, pb.batch_no, pb.date, pb.product_id, p.name product, p.unit, pb.qty_produced, pb.total_cost, pb.voided_at, pb.void_reason,
      (select count(*) from production_costs pc where pc.batch_id = pb.id and pc.cost_status <> 'actual')::int estimated,
      (select string_agg(coalesce(pc.description, pc.kind), ', ' order by pc.created_at) from production_costs pc where pc.batch_id = pb.id) lines,
      coalesce((select qty_remaining from cost_layers cl where cl.source_type = 'production' and cl.source_id = pb.id), 0) remaining
    from production_batches pb join products p on p.id = pb.product_id
    where ${w.sql} ${order}`, w.params);
  const { rows, hasMore, page, pageSize } = pageOf(raw, lp);
  const filtered = !!(lp.q || lp.from || lp.to || lp.state);
  return (
    <div className="animate-rise">
      <PageHeader title="Inventory" subtitle="What you make. Each batch's total cost ÷ units made = the cost of every unit."
        actions={can(ctx.role, "record") ? <ButtonLink href="/inventory/production/new">New batch</ButtonLink> : undefined} />
      <InventoryTabs active="production" />
      <ListControls search="Search product or batch number"
        filters={[{ param: "state", label: "Batch status", options: [{ value: "active", label: "Active" }, { value: "voided", label: "Voided" }] }]}
        sorts={[{ value: "date:asc", label: "Oldest first" }, { value: "cost:desc", label: "Highest cost" }, { value: "unit:desc", label: "Highest cost per unit" }, { value: "product:asc", label: "Product A–Z" }]} />
      <Card className="overflow-hidden">
        {rows.length === 0 && filtered ? (
          <EmptyState icon={<Factory size={22} />} title="No matching batches" body="Try a different search, date range or filter." />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Factory size={22} />} title="No production batches" body="If you make or bottle your own products, record each batch here so Ledgr knows what every unit cost."
            action={can(ctx.role, "record") ? <ButtonLink href="/inventory/production/new">Record a batch</ButtonLink> : undefined} />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
            <table className="w-full text-body min-w-[680px]">
              <thead><tr className="text-caption text-ink-2 text-left"><SortTh label="Batch" sortKey="date" className="py-2.5 pl-5" /><SortTh label="Product" sortKey="product" /><SortTh label="Made" sortKey="qty" align="right" /><SortTh label="Total cost" sortKey="cost" align="right" /><SortTh label="Per unit" sortKey="unit" align="right" /><th className="font-medium text-right">Left</th><th className="pr-4 w-10" /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={cn("border-t border-hairline align-top", r.voided_at && "text-ink-3")}>
                    <td className="py-3 pl-5"><div className="font-medium num">{r.batch_no}</div><div className="text-caption text-ink-3">{formatDate(r.date, true)}</div></td>
                    <td className="py-3"><Link href={`/inventory/products/${r.product_id}`} className="tap hover:text-accent">{r.product}</Link>
                      <div className="text-caption text-ink-3 truncate max-w-[280px]">{r.lines}</div>
                      {r.voided_at && <div className="text-caption">Voided: {r.void_reason}</div>}
                    </td>
                    <td className="py-3 text-right num">{formatQty(r.qty_produced, r.unit)}</td>
                    <td className={cn("py-3 text-right num", r.voided_at && "line-through")}><Money value={r.total_cost} />{r.estimated > 0 && <div><Badge tone="warning">Estimated</Badge></div>}</td>
                    <td className="py-3 text-right num font-medium"><Money value={Math.round(r.total_cost / r.qty_produced)} exact={r.total_cost / r.qty_produced < 10_000} /></td>
                    <td className="py-3 text-right num text-ink-2">{r.voided_at ? "—" : formatQty(r.remaining)}</td>
                    <td className="py-3 pr-4 text-right">{!r.voided_at && r.remaining === r.qty_produced && can(ctx.role, "void") && <VoidBatchButton id={r.id} cost={r.total_cost} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pager page={page} hasMore={hasMore} shown={rows.length} pageSize={pageSize} />
    </div>
  );
}
