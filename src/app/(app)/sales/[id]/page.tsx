import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { getSale, saleStatus, formOptions } from "@/lib/server/queries";
import { Badge, Card, Money, cn, invoiceStatus } from "@/components/ui/primitives";
import { formatDate, formatMoney, formatPercent, formatQty } from "@/lib/finance";
import { SaleActions, FixCostButton, VoidInline } from "./sale-actions";
import { can } from "@/lib/permissions";

export const metadata = { title: "Sale" };

const KIND: Record<string, string> = { customer_payment: "Payment", refund: "Refund" };

export default async function SalePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const sp = await searchParams;
  const data = await getSale(ctx, id);
  if (!data) notFound();
  const { sale, items, payments, returns } = data;
  const opts = await formOptions(ctx);
  const st = invoiceStatus[saleStatus(sale, opts.today)];
  const cogs = items.reduce((a, i) => a + (i.cogs ?? 0), 0);
  const missing = items.some((i) => i.cogs === null);
  const profit = sale.net - cogs;
  const canVoid = can(ctx.role, "void");

  return (
    <div className="animate-rise max-w-3xl">
      <Link href="/sales" className="tap inline-flex items-center gap-1 text-body text-accent mb-3"><ChevronLeft size={18} />Sales</Link>

      {sp.new && (
        <div className="flex items-center gap-2 rounded-[12px] bg-positive-soft text-positive px-4 py-3 mb-4 text-body font-medium">
          <CheckCircle2 size={18} /> Sale saved.
          <Link href="/sales/new" className="ml-auto text-accent">New sale</Link>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-title font-semibold">{sale.invoice_no}</h1>
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <p className="text-body text-ink-2 mt-0.5">{sale.customer_name} · {formatDate(sale.date, true)}{!sale.voided_at && sale.outstanding > 0 && <> · due {formatDate(sale.due_date, true)}</>}</p>
        </div>
        {!sale.voided_at && (
          <SaleActions sale={{ id: sale.id, customer_id: sale.customer_id, outstanding: sale.outstanding, paid: sale.paid - sale.refunded, total: sale.total, date: sale.date, is_walk_in: sale.is_walk_in, invoice_no: sale.invoice_no }}
            items={items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, returnable: i.qty - i.returned_qty, unit: i.unit, net_amount: i.net_amount, vat_amount: i.vat_amount }))}
            accounts={opts.accounts} today={opts.today} hasReturns={returns.some((r) => !r.voided_at)} canVoid={canVoid} canCollect={can(ctx.role, "sell")} />
        )}
      </div>

      {sale.voided_at && (
        <div className="rounded-[12px] bg-fill px-4 py-3 mb-4 text-body">
          <span className="font-medium">Voided.</span> <span className="text-ink-2">Reason: {sale.void_reason}. It no longer counts in any totals.</span>
        </div>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-body">
          <thead>
            <tr className="text-caption text-ink-2 text-left"><th className="font-medium py-3 pl-5">Item</th><th className="font-medium text-right">Qty</th><th className="font-medium text-right hidden sm:table-cell">Price</th><th className="font-medium text-right pr-5">Amount</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-t border-hairline align-top">
                <td className="py-3 pl-5">
                  <div>{i.name}</div>
                  {ctx.canSeeCosts && (
                    <div className="text-caption text-ink-2 num mt-0.5">
                      {i.cogs === null ? (
                        <span className="text-warning inline-flex items-center gap-1"><AlertTriangle size={13} />Cost missing — profit unavailable {can(ctx.role, "record") && <FixCostButton itemId={i.id} name={i.name} qty={i.uncovered_qty} />}</span>
                      ) : (
                        <>Cost <Money value={i.cogs} /> · profit <Money value={i.net_amount - i.cogs} /> ({formatPercent(i.net_amount ? (i.net_amount - i.cogs) / i.net_amount : null, 0)}){i.cost_status === "estimated" && <span className="text-ink-3"> · estimated</span>}</>
                      )}
                    </div>
                  )}
                  {i.returned_qty > 0 && <div className="text-caption text-ink-2">{formatQty(i.returned_qty)} returned</div>}
                </td>
                <td className="text-right py-3 pl-3 num whitespace-nowrap">{formatQty(i.qty, i.unit)}</td>
                <td className="text-right py-3 num hidden sm:table-cell"><Money value={i.unit_price} /></td>
                <td className="text-right py-3 pl-4 pr-5 num whitespace-nowrap">
                  <Money value={i.gross_amount} exact={i.gross_amount % 100 !== 0} />
                  {i.discount_amount > 0 && <div className="text-caption text-ink-2">−<Money value={i.discount_amount} exact={i.discount_amount % 100 !== 0} /></div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="border-t border-hairline px-5 py-4 flex flex-col gap-1.5 text-body num">
          {sale.discount_total > 0 && <><Line l="Before discount" v={<Money value={sale.gross} exact />} /><Line l="Discount" v={<>−<Money value={sale.discount_total} exact /></>} /></>}
          {sale.vat_amount > 0 && <><Line l="Revenue (excl. VAT)" v={<Money value={sale.net} exact />} /><Line l={`VAT ${formatPercent(sale.vat_rate_bp / 10000)}`} v={<Money value={sale.vat_amount} exact />} /></>}
          <Line l="Total" v={<Money value={sale.total} exact />} strong />
          {sale.returned > 0 && <Line l="Returned" v={<>−<Money value={sale.returned} exact /></>} />}
          <Line l="Paid" v={<Money value={sale.paid - sale.refunded} exact />} />
          {!sale.voided_at && <Line l="Balance" v={<Money value={sale.outstanding} exact />} strong={sale.outstanding > 0} />}
        </dl>
        {ctx.canSeeCosts && !sale.voided_at && (
          <div className="border-t border-hairline px-5 py-3 text-caption text-ink-2 flex justify-between num bg-surface-2">
            <span>Gross profit on this sale</span>
            <span>{missing ? <span className="text-warning">Unavailable until missing costs are added</span> : <><Money value={profit} /> · {formatPercent(sale.net ? profit / sale.net : null)}</>}</span>
          </div>
        )}
      </Card>

      {(payments.length > 0 || returns.length > 0) && (
        <Card className="mt-4 p-5">
          <h2 className="text-headline font-semibold mb-2">History</h2>
          <ul>
            {payments.map((p) => (
              <li key={p.id + p.kind} className={cn("flex justify-between py-2.5 border-t border-hairline first:border-0 text-body", p.voided_at && "text-ink-3 line-through")}>
                <span>{KIND[p.kind] ?? p.kind} · {p.account} <span className="text-ink-2 num">· {formatDate(p.date)}</span>{p.voided_at && <span className="no-underline"> · voided</span>}</span>
                <span className="flex items-center gap-3">
                  {canVoid && !p.voided_at && !sale.voided_at && p.kind === "customer_payment" && (
                    <VoidInline id={p.id} type="cash" effect={`This cancels the ${formatMoney(p.amount, { exact: true })} payment. The customer will owe it again and it comes out of ${p.account}.`} />
                  )}
                  <span className="num"><Money value={Math.abs(p.allocated)} signed={false} /></span>
                </span>
              </li>
            ))}
            {returns.map((r) => (
              <li key={r.id} className={cn("flex justify-between py-2.5 border-t border-hairline text-body", r.voided_at && "text-ink-3 line-through")}>
                <span>Return{r.reason ? ` — ${r.reason}` : ""} <span className="text-ink-2">· {r.restock ? "back in stock" : "written off"} · {formatDate(r.date)}</span></span>
                <span className="flex items-center gap-3">
                  {canVoid && !r.voided_at && !sale.voided_at && (
                    <VoidInline id={r.id} type="return" effect={`This cancels the return of ${formatMoney(r.total, { exact: true })}: the sale counts in full again${r.restock ? ", the items come back out of stock" : ""}${r.refund_method === "credit" ? "" : " and any refund is reversed"}.`} />
                  )}
                  <span className="num">−<Money value={r.total} /></span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Line({ l, v, strong }: { l: string; v: React.ReactNode; strong?: boolean }) {
  return <div className={cn("flex justify-between", strong && "font-semibold")}><dt className={strong ? "" : "text-ink-2"}>{l}</dt><dd>{v}</dd></div>;
}
