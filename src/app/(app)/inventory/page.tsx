import Link from "next/link";
import { Package } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, cn } from "@/components/ui/primitives";
import { formatPercent, formatQty } from "@/lib/finance";
import { InventoryTabs } from "./tabs";
import { ProductSheetTrigger, EditProductButton } from "./product-sheet";
import { ListControls, Pager, SortTh } from "@/components/app/list-controls";
import { readListParams, LIST_PAGE_SIZE } from "@/lib/server/list";

export const metadata = { title: "Inventory" };

interface Row {
  id: string; name: string; sku: string | null; unit: string; category: string | null; selling_price: number | null; standard_cost: number | null;
  min_stock: number; is_sellable: boolean; on_hand: number; value: number; avg_cost: number | null; low_stock: boolean; backordered: number;
}

export default async function InventoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const lp = readListParams(sp, { sort: "name", dir: "asc" });
  const rows = await ctx.q<Row>(`
    select p.id, p.name, p.sku, p.unit, pc.name category, p.selling_price, p.standard_cost, p.min_stock, p.is_sellable,
           i.on_hand, i.value, i.avg_cost, i.low_stock, i.backordered
    from products p left join product_categories pc on pc.id = p.category_id join fin_inventory($1) i on i.product_id = p.id
    where p.business_id = $1 order by p.is_sellable desc, pc.name nulls last, p.name`, [ctx.business.id]);
  const categories = [...new Set(rows.map((r) => r.category).filter(Boolean))] as string[];
  const total = rows.reduce((a, r) => a + r.value, 0);
  // Search, filter and sort in memory: every product's stock is already loaded for the totals.
  const q = lp.q?.toLowerCase();
  const marginOf = (r: Row) => { const c = r.avg_cost ?? r.standard_cost; return r.selling_price && c !== null ? (r.selling_price - c) / r.selling_price : null; };
  const KEY: Record<string, (r: Row) => number | string | null> = { name: (r) => r.name.toLowerCase(), stock: (r) => r.on_hand, value: (r) => r.value, margin: marginOf, price: (r) => r.selling_price };
  const key = KEY[lp.sort ?? "name"] ?? KEY.name;
  const dir = lp.dir === "asc" ? 1 : -1;
  const shown = rows
    .filter((r) => !q || [r.name, r.sku, r.category].some((x) => x?.toLowerCase().includes(q)))
    .filter((r) => !lp.stock || (lp.stock === "low" ? r.low_stock && r.on_hand > 0 : lp.stock === "out" ? r.on_hand <= 0 : !r.low_stock && r.on_hand > 0))
    .filter((r) => !lp.kind || (lp.kind === "sell" ? r.is_sellable : !r.is_sellable))
    .filter((r) => !lp.category || r.category === lp.category)
    .sort((a, b) => { const x = key(a), y = key(b); if (x === y) return 0; if (x === null) return 1; if (y === null) return -1; return (x < y ? -1 : 1) * dir; });
  const pageRows = shown.slice((lp.page - 1) * LIST_PAGE_SIZE, lp.page * LIST_PAGE_SIZE);
  const sellable = pageRows.filter((r) => r.is_sellable);
  const rawMaterials = pageRows.filter((r) => !r.is_sellable);

  return (
    <div className="animate-rise">
      <PageHeader title="Inventory" subtitle={<>Stock worth <Money value={total} className="text-ink font-medium" /> at cost (first-in, first-out).</>}
        actions={can(ctx.role, "record") ? <><ButtonLink variant="secondary" href="/inventory/purchases/new">Add purchase</ButtonLink><ProductSheetTrigger open={sp.add === "1"} categories={categories} /></> : undefined} />
      <InventoryTabs active="products" />
      {rows.length > 0 && <ListControls search="Search name, SKU or category" dates={false}
        filters={[
          { param: "stock", label: "Stock level", options: [{ value: "low", label: "Running low" }, { value: "out", label: "Out of stock" }, { value: "ok", label: "In stock" }] },
          { param: "kind", label: "Type", allLabel: "All types", options: [{ value: "sell", label: "Products you sell" }, { value: "raw", label: "Raw materials" }] },
          ...(categories.length > 1 ? [{ param: "category", label: "Category", allLabel: "All categories", options: categories.map((c) => ({ value: c, label: c })) }] : []),
        ]}
        defaultSort="Name A–Z" sorts={[{ value: "stock:asc", label: "Lowest stock" }, { value: "value:desc", label: "Highest value" }, { value: "margin:desc", label: "Best margin" }, { value: "margin:asc", label: "Lowest margin" }]} />}
      {rows.length > 0 && shown.length === 0 ? (
        <Card><EmptyState icon={<Package size={22} />} title="No matching products" body="Try a different search or filter." /></Card>
      ) : rows.length === 0 ? (
        <Card><EmptyState icon={<Package size={22} />} title="No products yet" body="Add what you sell and the raw materials you use. Then record a purchase so Ledgr knows what each one costs."
          action={can(ctx.role, "record") ? <ButtonLink href="/inventory?add=1">Add a product</ButtonLink> : undefined} /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {sellable.length > 0 && <ProductTable title="Products you sell" rows={sellable} categories={categories} canEdit={can(ctx.role, "record")} />}
          {rawMaterials.length > 0 && <ProductTable title="Raw materials & packaging" rows={rawMaterials} categories={categories} raw canEdit={can(ctx.role, "record")} />}
          <Pager page={lp.page} hasMore={shown.length > lp.page * LIST_PAGE_SIZE} shown={pageRows.length} pageSize={LIST_PAGE_SIZE} />
        </div>
      )}
    </div>
  );
}

function ProductTable({ title, rows, categories, raw , canEdit }: { title: string; rows: Row[]; categories: string[]; raw?: boolean ; canEdit: boolean }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 pt-4 pb-2 flex justify-between items-baseline">
        <h2 className="text-headline font-semibold">{title}</h2>
        <span className="text-caption text-ink-2 num"><Money value={rows.reduce((a, r) => a + r.value, 0)} /></span>
      </div>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
        <table className="w-full text-body min-w-[640px]">
          <thead>
            <tr className="text-caption text-ink-2 text-left">
              <SortTh label="Product" sortKey="name" className="py-2.5 pl-5" /><SortTh label="In stock" sortKey="stock" align="right" /><SortTh label="Value" sortKey="value" align="right" />
              <th className="font-medium text-right">Avg cost</th>{!raw && <><SortTh label="Price" sortKey="price" align="right" /><SortTh label="Margin" sortKey="margin" align="right" /></>}<th className="w-12 pr-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const cost = r.avg_cost ?? r.standard_cost;
              const margin = r.selling_price && cost !== null ? (r.selling_price - cost) / r.selling_price : null;
              return (
                <tr key={r.id} className="border-t border-hairline">
                  <td className="py-3 pl-5">
                    <div className="flex items-center gap-2"><Link href={`/inventory/products/${r.id}`} className="tap hover:text-accent">{r.name}</Link>{r.low_stock && <Badge tone="warning">Low</Badge>}{r.on_hand < 0 && <Badge tone="negative">Oversold</Badge>}</div>
                    <div className="text-caption text-ink-3">{[r.category, r.sku].filter(Boolean).join(" · ")}</div>
                  </td>
                  <td className={cn("text-right num", r.on_hand <= 0 && "text-negative")}>{formatQty(r.on_hand, r.unit)}</td>
                  <td className="text-right num"><Money value={r.value} /></td>
                  <td className="text-right num text-ink-2">{r.avg_cost !== null ? <Money value={r.avg_cost} exact={r.avg_cost < 10_000} /> : r.standard_cost !== null ? <span title="Standard cost (estimate)"><Money value={r.standard_cost} /> est.</span> : <span className="text-warning">Unknown</span>}</td>
                  {!raw && <>
                    <td className="text-right num">{r.selling_price !== null ? <Money value={r.selling_price} /> : "—"}</td>
                    <td className="text-right num text-ink-2">{formatPercent(margin, 0)}</td>
                  </>}
                  <td className="pr-3 text-right">{canEdit && <EditProductButton product={r} categories={categories} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
