import Link from "next/link";
import { AlertTriangle, Search, ShoppingCart } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { listSales, saleStatus, PAGE_SIZE } from "@/lib/server/queries";
import { ListControls, Pager, SortTh } from "@/components/app/list-controls";
import { Badge, ButtonLink, Card, EmptyState, Money, PageHeader, cn, invoiceStatus } from "@/components/ui/primitives";
import { formatDate } from "@/lib/finance";
import { CustomerSheetTrigger } from "./customer-trigger";

export const metadata = { title: "Sales" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "open", label: "Unpaid" },
  { key: "overdue", label: "Overdue" },
  { key: "missing", label: "Missing cost" },
  { key: "voided", label: "Voided" },
];

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  // "Missing cost" lives in the same chip row as payment status; it maps to the cost filter.
  const status = sp.status === "missing" ? undefined : sp.status;
  const cost = sp.status === "missing" || sp.cost === "missing" ? "missing" : undefined;
  const { rows, hasMore, page, today } = await listSales(ctx, { q: sp.q, status, cost, page: Number(sp.page ?? 1),
    customer: sp.customer === "new" ? undefined : sp.customer, from: sp.from, to: sp.to, sort: sp.sort, dir: sp.dir });
  const filtered = !!(sp.q || sp.status || sp.cost || sp.from || sp.to);
  const filters = FILTERS.filter((f) => f.key && (f.key !== "missing" || ctx.canSeeCosts)).map((f) => ({ value: f.key, label: f.label }));

  return (
    <div className="animate-rise">
      <PageHeader title="Sales" subtitle="Every sale, what's been paid and what's still owed."
        actions={can(ctx.role, "sell") ? <><CustomerSheetTrigger open={sp.customer === "new"} /><ButtonLink href="/sales/new">New sale</ButtonLink></> : undefined} />

      <ListControls search="Search invoice, customer or product" filters={[{ param: "status", label: "Status", options: filters }]}
        sorts={[{ value: "date:asc", label: "Oldest first" }, { value: "total:desc", label: "Largest first" }, { value: "owed:desc", label: "Most owed" }, { value: "customer:asc", label: "Customer A–Z" }]} />

      <Card>
        {rows.length === 0 ? (
          filtered ? <EmptyState icon={<Search size={22} />} title="No matching sales" body="Try a different search, date range or filter." /> :
            <EmptyState icon={<ShoppingCart size={22} />} title="No sales yet" body="Once you record your first sale, your revenue and profit will appear here." action={can(ctx.role, "sell") ? <ButtonLink href="/sales/new">Record a sale</ButtonLink> : undefined} />
        ) : (
          <>
            {/* Desktop table */}
            <table className="hidden md:table w-full text-body">
              <thead>
                <tr className="text-caption text-ink-2 text-left">
                  <SortTh label="Date" sortKey="date" className="py-3 pl-5" /><SortTh label="Invoice" sortKey="invoice" /><SortTh label="Customer" sortKey="customer" />
                  <th className="font-medium">Items</th><SortTh label="Total" sortKey="total" align="right" /><SortTh label="Status" sortKey="owed" align="right" className="pr-5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = invoiceStatus[saleStatus(r, today)];
                  return (
                    <tr key={r.id} className={cn("border-t border-hairline hover:bg-surface-2 relative", r.voided_at && "text-ink-3")}>
                      <td className="py-3 pl-5 whitespace-nowrap num">{formatDate(r.date)}</td>
                      <td className="whitespace-nowrap"><Link href={`/sales/${r.id}`} className="after:absolute after:inset-0 font-medium">{r.invoice_no}</Link></td>
                      <td className="max-w-[200px] truncate">{r.customer_name}</td>
                      <td className="max-w-[280px] truncate text-ink-2">
                        {r.missing > 0 && <AlertTriangle size={14} className="inline mr-1 text-warning -mt-0.5" aria-label="Missing cost" />}{r.items}
                      </td>
                      <td className={cn("text-right num font-medium", r.voided_at && "line-through")}><Money value={r.total} /></td>
                      <td className="text-right pr-5">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        {!r.voided_at && r.outstanding > 0 && r.paid > 0 && <div className="text-caption text-ink-2 num mt-0.5"><Money value={r.outstanding} /> left</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Mobile list */}
            <ul className="md:hidden">
              {rows.map((r, i) => {
                const st = invoiceStatus[saleStatus(r, today)];
                return (
                  <li key={r.id} className={cn(i > 0 && "border-t border-hairline")}>
                    <Link href={`/sales/${r.id}`} className="flex items-center gap-3 px-4 py-3 active:bg-fill">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-body"><span className="font-medium truncate">{r.customer_name}</span></div>
                        <div className="text-caption text-ink-2 truncate">{r.missing > 0 && "⚠︎ "}{r.items}</div>
                        <div className="text-caption text-ink-3 num">{formatDate(r.date)} · {r.invoice_no}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className={cn("text-body font-medium num", r.voided_at && "line-through text-ink-3")}><Money value={r.total} /></div>
                        <Badge tone={st.tone} className="mt-1">{st.label}</Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Card>

      <Pager page={page} hasMore={hasMore} shown={rows.length} pageSize={PAGE_SIZE} />
    </div>
  );
}
