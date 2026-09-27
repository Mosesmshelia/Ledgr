import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { Badge, Card, Money, cn } from "@/components/ui/primitives";
import { addDays, formatDate, formatPercent, formatQty, todayIn } from "@/lib/finance";
import { EditProductButton } from "../../product-sheet";
import { AdjustStockButton, VoidAdjustment } from "./adjust-stock";
import { can } from "@/lib/permissions";

export const metadata = { title: "Product" };

const KIND: Record<string, string> = {
  opening: "Opening stock", purchase: "Bought", production: "Made", production_use: "Used in production", sale: "Sold",
  return: "Returned", adjustment: "Adjustment", void_reversal: "Voided (reversed)",
};
const SOURCE: Record<string, string> = { purchase: "Purchase", production: "Production batch", return: "Customer return", opening: "Opening stock", adjustment: "Adjustment" };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  const [p] = await ctx.q<{ id: string; name: string; sku: string | null; unit: string; category: string | null; selling_price: number | null; standard_cost: number | null; min_stock: number; is_sellable: boolean }>(
    "select p.*, pc.name category from products p left join product_categories pc on pc.id = p.category_id where p.id = $1 and p.business_id = $2", [id, b]);
  if (!p) notFound();
  const [inv] = await ctx.q<{ on_hand: number; value: number; avg_cost: number | null; low_stock: boolean; backordered: number }>("select * from fin_inventory($1) where product_id = $2", [b, id]);
  const [perf] = await ctx.q<{ units: number; revenue: number; cogs: number; gross_profit: number; missing_lines: number }>("select * from fin_product_performance($1,$2,$3) where product_id = $4", [b, addDays(today, -29), today, id]);
  const layers = await ctx.q<{ id: string; source_type: string; layer_date: string; qty_in: number; qty_remaining: number; remaining_value: number; unit_cost: number }>("select * from fin_cost_layers($1,$2)", [b, id]);
  const moves = await ctx.q<{ id: string; date: string; kind: string; qty_change: number; cost_change: number; balance: number; ref: string | null; doc_id: string | null; doc_type: string | null; note: string | null }>(
    "select * from fin_stock_movements($1,$2) order by seq desc limit 60", [b, id]);
  const cost = inv?.avg_cost ?? p.standard_cost;
  const margin = p.selling_price && cost !== null ? (p.selling_price - cost) / p.selling_price : null;
  const [cats] = [await ctx.q<{ name: string }>("select name from product_categories where business_id = $1 order by name", [b])];
  const adjustments = await ctx.q<{ id: string; date: string; qty_change: number; cost_effect: number; reason: string; voided_at: string | null; void_reason: string | null }>(
    "select id, date, qty_change, cost_effect, reason, voided_at, void_reason from stock_adjustments where product_id = $1 and business_id = $2 order by date desc, created_at desc limit 30", [id, b]);
  const canRecord = can(ctx.role, "record");

  return (
    <div className="animate-rise max-w-4xl">
      <Link href="/inventory" className="tap inline-flex items-center gap-1 text-body text-accent mb-3"><ChevronLeft size={18} />Inventory</Link>
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-title font-semibold flex items-center gap-2">{p.name}{inv?.low_stock && <Badge tone="warning">Low stock</Badge>}</h1>
          <p className="text-body text-ink-2">{[p.category, p.sku, p.is_sellable ? null : "Raw material"].filter(Boolean).join(" · ")}</p>
        </div>
        {canRecord && (
          <div className="flex items-center gap-2">
            <AdjustStockButton product={{ id: p.id, name: p.name, unit: p.unit }} onHand={Number(inv?.on_hand ?? 0)} avgCost={inv?.avg_cost ?? p.standard_cost} today={today} />
            <EditProductButton product={{ ...p }} categories={cats.map((c) => c.name)} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="In stock" value={formatQty(inv?.on_hand ?? 0, p.unit)} tone={(inv?.on_hand ?? 0) <= 0 ? "negative" : undefined} sub={p.min_stock > 0 ? `Warn below ${formatQty(p.min_stock)}` : undefined} />
        <Stat label="Stock value" value={<Money value={inv?.value ?? 0} />} sub="At cost (FIFO)" />
        <Stat label="Average cost" value={cost !== null ? <Money value={cost} exact={cost < 10_000} /> : "Unknown"} sub={inv?.avg_cost == null && p.standard_cost !== null ? "Standard cost (estimate)" : "Of stock on hand"} />
        {p.is_sellable && <Stat label="Margin at current price" value={formatPercent(margin, 0)} sub={p.selling_price ? <>Price <Money value={p.selling_price} /></> : "No price set"} />}
      </div>

      {p.is_sellable && perf && (
        <Card className="p-5 mt-3">
          <h2 className="text-headline font-semibold mb-3">Last 30 days</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 num">
            <div><dt className="text-caption text-ink-2">Units sold</dt><dd className="text-title font-semibold">{formatQty(perf.units)}</dd></div>
            <div><dt className="text-caption text-ink-2">Revenue</dt><dd className="text-title font-semibold"><Money value={perf.revenue} compact /></dd></div>
            <div><dt className="text-caption text-ink-2">Gross profit</dt><dd className="text-title font-semibold">{perf.missing_lines ? <span className="text-warning text-body">Unavailable</span> : <Money value={perf.gross_profit} compact />}</dd></div>
            <div><dt className="text-caption text-ink-2">Gross margin</dt><dd className="text-title font-semibold">{perf.missing_lines ? "—" : formatPercent(perf.revenue ? perf.gross_profit / perf.revenue : null, 1)}</dd></div>
          </dl>
        </Card>
      )}

      <Card className="mt-3 overflow-hidden">
        <div className="px-5 pt-4 pb-2">
          <h2 className="text-headline font-semibold">Stock on hand, oldest first</h2>
          <p className="text-caption text-ink-2">The top row is sold next. That&apos;s how Ledgr knows exactly what each sale cost you.</p>
        </div>
        {layers.length === 0 ? <p className="px-5 pb-5 text-body text-ink-2">Nothing in stock.</p> : (
          <table className="w-full text-body">
            <thead><tr className="text-caption text-ink-2 text-left"><th className="font-medium py-2 pl-5">From</th><th className="font-medium text-right">Left</th><th className="font-medium text-right">Cost each</th><th className="font-medium text-right pr-5">Value</th></tr></thead>
            <tbody>{layers.map((l, i) => (
              <tr key={l.id} className="border-t border-hairline">
                <td className="py-2.5 pl-5">{SOURCE[l.source_type] ?? l.source_type} <span className="text-ink-2">· {formatDate(l.layer_date, true)}</span>{i === 0 && <Badge tone="accent" className="ml-2">Sold next</Badge>}</td>
                <td className="text-right num">{formatQty(l.qty_remaining)} <span className="text-ink-3">of {formatQty(l.qty_in)}</span></td>
                <td className="text-right num"><Money value={Math.round(l.unit_cost)} exact={l.unit_cost < 10_000} /></td>
                <td className="text-right num pr-5"><Money value={l.remaining_value} /></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Card>

      {adjustments.length > 0 && (
        <Card className="mt-3 overflow-hidden">
          <div className="px-5 pt-4 pb-2">
            <h2 className="text-headline font-semibold">Adjustments</h2>
            <p className="text-caption text-ink-2">Breakages, spoilage and stock-count corrections. Stock lost counts as a cost; stock found lowers it.</p>
          </div>
          <ul>{adjustments.map((a) => (
            <li key={a.id} className={cn("flex items-center gap-3 px-5 py-2.5 border-t border-hairline", a.voided_at && "text-ink-3")}>
              <div className="flex-1 min-w-0">
                <div className={cn("text-body", a.voided_at && "line-through")}>{a.reason}</div>
                <div className="text-caption text-ink-3 num">{formatDate(a.date)}{a.voided_at && ` · voided: ${a.void_reason}`}</div>
              </div>
              <div className="text-right num">
                <div className={cn("text-body font-medium", !a.voided_at && (a.qty_change < 0 ? "text-negative" : "text-positive"))}>{a.qty_change > 0 ? "+" : "−"}{formatQty(Math.abs(Number(a.qty_change)), p.unit)}</div>
                <div className="text-caption text-ink-2">{a.cost_effect > 0 ? "Cost " : "Saves "}<Money value={Math.abs(a.cost_effect)} /></div>
              </div>
              {can(ctx.role, "void") && !a.voided_at && <VoidAdjustment id={a.id} label={a.reason} />}
            </li>
          ))}</ul>
        </Card>
      )}

      <Card className="mt-3 overflow-hidden">
        <h2 className="text-headline font-semibold px-5 pt-4 pb-2">Stock movements</h2>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table (scrolls sideways on small screens)">
          <table className="w-full text-body min-w-[560px]">
            <thead><tr className="text-caption text-ink-2 text-left"><th className="font-medium py-2 pl-5">Date</th><th className="font-medium">What happened</th><th className="font-medium text-right">In / out</th><th className="font-medium text-right pr-5">Balance</th></tr></thead>
            <tbody>{moves.map((m) => {
              const href = m.doc_id && m.doc_type === "sale" ? `/sales/${m.doc_id}` : m.doc_type === "production" ? "/inventory/production" : m.doc_type === "purchase" ? "/inventory/purchases" : null;
              return (
                <tr key={m.id} className="border-t border-hairline">
                  <td className="py-2.5 pl-5 num whitespace-nowrap">{formatDate(m.date)}</td>
                  <td className="py-2.5">{KIND[m.kind] ?? m.kind}{m.ref && <> · {href ? <Link href={href} className="text-accent">{m.ref}</Link> : <span className="text-ink-2">{m.ref}</span>}</>}{m.note && <div className="text-caption text-ink-3">{m.note}</div>}</td>
                  <td className={cn("text-right num", m.qty_change > 0 ? "text-positive" : "text-ink")}>{m.qty_change > 0 ? "+" : "−"}{formatQty(Math.abs(m.qty_change))}</td>
                  <td className={cn("text-right num pr-5", m.balance < 0 && "text-negative")}>{formatQty(m.balance)}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "negative" }) {
  return (
    <div className="bg-surface rounded-[16px] border border-hairline p-4">
      <div className="text-caption font-medium text-ink-2">{label}</div>
      <div className={cn("text-title font-semibold num mt-1", tone === "negative" && "text-negative")}>{value}</div>
      {sub && <div className="text-caption text-ink-3 mt-0.5">{sub}</div>}
    </div>
  );
}
