"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2, UserPlus } from "lucide-react";
import { postSale, saveCustomer } from "@/app/actions/ledger";
import { Button, Card, Field, Input, cn } from "@/components/ui/primitives";
import { Chips, Combobox, MoneyInput, QtyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney, formatPercent, formatQty, allocate } from "@/lib/finance/money";
import { addDays } from "@/lib/finance/periods";
import type { FormOptions } from "@/lib/server/queries";

interface Line { key: number; product_id: string | null; qty: number; unit_price: number | null; line_discount: number | null }

export function SaleForm({ opts, vat, canSeeCosts, defaultTerms }: { opts: FormOptions; vat: { rateBp: number; inclusive: boolean } | null; canSeeCosts: boolean; defaultTerms: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customers, setCustomers] = useState(opts.customers);
  const walkIn = customers.find((c) => c.is_walk_in)!;
  const [customerId, setCustomerId] = useState(walkIn.id);
  const [date, setDate] = useState(opts.today);
  const [lines, setLines] = useState<Line[]>([{ key: 1, product_id: null, qty: 1, unit_price: null, line_discount: null }]);
  const [invDisc, setInvDisc] = useState<number | null>(null);
  const [showDisc, setShowDisc] = useState(false);
  const [payMode, setPayMode] = useState<"full" | "part" | "none">("full");
  const [partAmount, setPartAmount] = useState<number | null>(null);
  const [account, setAccount] = useState(opts.accounts.find((a) => a.type === "pos")?.id ?? opts.accounts[0]?.id);
  const [error, setError] = useState<string | null>(null);
  const [stockWarning, setStockWarning] = useState<string | null>(null);
  const [newCustomer, setNewCustomer] = useState(false);

  const products = opts.products.filter((p) => p.is_sellable);
  const productById = useMemo(() => new Map(opts.products.map((p) => [p.id, p])), [opts.products]);
  const customer = customers.find((c) => c.id === customerId)!;

  // Live preview (the server recalculates authoritatively on save).
  const calc = useMemo(() => {
    const rows = lines.map((l) => {
      const p = l.product_id ? productById.get(l.product_id) : undefined;
      const gross = Math.round(l.qty * (l.unit_price ?? 0));
      const base = gross - (l.line_discount ?? 0);
      const unitCost = p ? p.avg_cost ?? p.standard_cost : null;
      const shortBy = p ? Math.max(0, l.qty - Math.max(0, p.on_hand)) : 0;
      return { ...l, p, gross, base, unitCost, shortBy };
    });
    const shares = allocate(Math.min(invDisc ?? 0, rows.reduce((a, r) => a + Math.max(0, r.base), 0)), rows.map((r) => Math.max(0, r.base)));
    const subtotal = rows.reduce((a, r, i) => a + r.base - shares[i], 0);
    const bp = vat?.rateBp ?? 0;
    const vatAmt = !vat ? 0 : vat.inclusive ? Math.round((subtotal * bp) / (10000 + bp)) : Math.round((subtotal * bp) / 10000);
    const total = vat && !vat.inclusive ? subtotal + vatAmt : subtotal;
    const revenue = vat?.inclusive ? subtotal - vatAmt : subtotal;
    const knownCost = rows.every((r) => !r.p || r.unitCost !== null);
    const cost = rows.reduce((a, r) => a + (r.unitCost !== null && r.p ? Math.round(r.qty * r.unitCost) : 0), 0);
    return { rows, subtotal, vatAmt, total, revenue, cost, knownCost, profit: revenue - cost, discount: rows.reduce((a, r) => a + (r.line_discount ?? 0), 0) + (invDisc ?? 0) };
  }, [lines, invDisc, productById, vat]);

  const paid = payMode === "full" ? calc.total : payMode === "part" ? partAmount ?? 0 : 0;
  const ready = lines.some((l) => l.product_id) && lines.every((l) => !l.product_id || (l.qty > 0 && l.unit_price !== null));

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function pickProduct(key: number, id: string) {
    const p = productById.get(id);
    update(key, { product_id: id, unit_price: p?.selling_price ?? null });
  }

  function submit(allowNegative = false) {
    setError(null);
    if (!ready) { setError("Add at least one product with a price."); return; }
    if (payMode === "part" && (!partAmount || partAmount >= calc.total)) { setError("Enter a part-payment that's less than the total."); return; }
    if (payMode !== "none" && !account) { setError("Choose where the money went."); return; }
    if (payMode !== "full" && customer.is_walk_in) { setError("Choose the customer who owes you, so you can follow up. Walk-in sales must be paid in full."); return; }
    start(async () => {
      const res = await postSale({
        customer_id: customerId, date,
        due_date: payMode === "full" ? undefined : addDays(date, customer.payment_terms_days ?? defaultTerms),
        items: lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id!, qty: l.qty, unit_price: l.unit_price!, line_discount: l.line_discount ?? 0 })),
        invoice_discount: invDisc ?? 0,
        payment: paid > 0 && account ? { account_id: account, amount: paid } : undefined,
        allow_negative_stock: allowNegative,
      });
      if (res.ok) { router.push(`/sales/${res.data}?new=1`); router.refresh(); }
      else if (res.code === "INSUFFICIENT_STOCK") setStockWarning(res.error);
      else setError(res.error);
    });
  }

  const productOptions = products.map((p) => ({
    value: p.id, label: p.name, keywords: `${p.sku ?? ""} ${p.category ?? ""}`,
    hint: <span className="num">{p.selling_price !== null ? formatMoney(p.selling_price) : "No price set"} · {p.on_hand > 0 ? `${formatQty(p.on_hand)} in stock` : <span className="text-warning">Out of stock</span>}</span>,
  }));

  return (
    <div className="pb-40 lg:pb-0 lg:grid lg:grid-cols-[1fr_340px] lg:gap-6 lg:items-start">
      <div className="flex flex-col gap-4">
        <Card className="p-4 sm:p-5 grid sm:grid-cols-[1fr_180px] gap-4">
          <Field label="Customer" htmlFor="customer">
            <Combobox id="customer" value={customerId} onChange={setCustomerId} placeholder="Search customers"
              options={customers.map((c) => ({ value: c.id, label: c.name }))}
              footer={<button type="button" onMouseDown={(e) => { e.preventDefault(); setNewCustomer(true); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-body text-accent hover:bg-fill"><UserPlus size={16} />New customer</button>} />
          </Field>
          <Field label="Date" htmlFor="date"><Input id="date" type="date" value={date} max={opts.today} onChange={(e) => setDate(e.target.value)} /></Field>
        </Card>

        <Card className="p-4 sm:p-5">
          <h2 className="text-headline font-semibold mb-3">Items</h2>
          <div className="flex flex-col gap-4">
            {calc.rows.map((l, i) => (
              <div key={l.key} className={cn("flex flex-col gap-3", i > 0 && "pt-4 border-t border-hairline")}>
                <div className="flex gap-2 items-start">
                  <div className="flex-1 min-w-0">
                    <Combobox value={l.product_id} onChange={(id) => pickProduct(l.key, id)} options={productOptions} placeholder="Choose a product" />
                  </div>
                  {lines.length > 1 && (
                    <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="size-11 grid place-items-center rounded-[10px] text-ink-3 hover:text-negative hover:bg-negative-soft" aria-label="Remove item"><Trash2 size={17} /></button>
                  )}
                </div>
                {l.p && (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-[140px_1fr_1fr] gap-3">
                      <Field label={`Quantity${l.p.unit !== "unit" ? ` (${l.p.unit})` : ""}`}><QtyInput value={l.qty} onChange={(q) => update(l.key, { qty: q })} unit={l.p.unit} /></Field>
                      <Field label="Price each"><MoneyInput value={l.unit_price} onChange={(v) => update(l.key, { unit_price: v })} aria-label="Price each" /></Field>
                      <Field label="Line total" className="col-span-2 sm:col-span-1">
                        <div className="h-11 flex items-center justify-between rounded-[10px] px-3 bg-surface-2 border border-hairline num">
                          <span className="font-medium">{formatMoney(l.base, { exact: l.base % 100 !== 0 })}</span>
                          {canSeeCosts && (l.unitCost !== null ? (
                            <span className="text-caption text-ink-2">≈ {formatMoney(l.base - Math.round(l.qty * l.unitCost))} profit</span>
                          ) : <span className="text-caption text-warning">Cost unknown</span>)}
                        </div>
                      </Field>
                    </div>
                    {l.shortBy > 0 && (
                      <p className="text-caption text-warning flex items-center gap-1.5"><AlertTriangle size={14} />Only {formatQty(Math.max(0, l.p.on_hand))} in stock.</p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <Button type="button" variant="secondary" size="sm" onClick={() => setLines([...lines, { key: Date.now(), product_id: null, qty: 1, unit_price: null, line_discount: null }])}><Plus size={15} />Add item</Button>
            {!showDisc && <Button type="button" variant="plain" size="sm" onClick={() => setShowDisc(true)}>Add discount</Button>}
          </div>
          {showDisc && (
            <div className="mt-4 max-w-xs"><Field label="Discount on the whole sale" hint="Shared across items by value."><MoneyInput value={invDisc} onChange={setInvDisc} autoFocus /></Field></div>
          )}
        </Card>

        <Card className="p-4 sm:p-5 flex flex-col gap-4">
          <h2 className="text-headline font-semibold">Payment</h2>
          <Chips label="Payment" value={payMode} onChange={setPayMode}
            options={[{ value: "full", label: "Paid in full" }, { value: "part", label: "Part paid" }, { value: "none", label: "Not paid yet" }]} />
          {payMode === "part" && <div className="max-w-xs"><Field label="Amount paid now"><MoneyInput aria-label="Amount paid now" value={partAmount} onChange={setPartAmount} autoFocus /></Field></div>}
          {payMode !== "none" && (
            <Field label="Paid into"><Chips label="Account" value={account ?? null} onChange={setAccount} options={opts.accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          )}
          {payMode !== "full" && (
            <p className="text-caption text-ink-2">
              {customer.is_walk_in ? "Pick a named customer so you can follow up on what they owe." :
                <>The balance of <span className="num font-medium text-ink">{formatMoney(Math.max(0, calc.total - paid))}</span> will show under &ldquo;Customers owe you&rdquo;, due {customer.payment_terms_days ?? defaultTerms} days after the sale.</>}
            </p>
          )}
        </Card>
      </div>

      {/* Summary: sticky bottom bar on phones, side panel on desktop */}
      <div className="fixed lg:sticky bottom-[calc(64px+env(safe-area-inset-bottom))] lg:bottom-auto lg:top-20 inset-x-0 z-30 lg:z-auto bg-surface/95 lg:bg-surface backdrop-blur-xl border-t lg:border border-hairline lg:rounded-[16px] p-4 lg:p-5">
        <div className="hidden lg:block mb-3">
          <h2 className="text-headline font-semibold">Summary</h2>
        </div>
        <dl className="hidden lg:flex flex-col gap-2 text-body num mb-4">
          <Row l="Subtotal" v={formatMoney(calc.subtotal + (invDisc ?? 0), { exact: (calc.subtotal + (invDisc ?? 0)) % 100 !== 0 })} />
          {calc.discount > 0 && <Row l="Discount" v={"−" + formatMoney(calc.discount, { exact: true })} />}
          {vat && <Row l={`VAT ${formatPercent(vat.rateBp / 10000, 1)}${vat.inclusive ? " (included)" : ""}`} v={formatMoney(calc.vatAmt, { exact: true })} />}
          {canSeeCosts && calc.revenue > 0 && (
            <Row l="Estimated profit" v={calc.knownCost ? `${formatMoney(calc.profit)} · ${formatPercent(calc.profit / calc.revenue, 0)}` : "Cost unknown"} muted />
          )}
          {payMode !== "full" && <Row l="Paid now" v={formatMoney(paid, { exact: true })} />}
        </dl>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-caption text-ink-2">Total</div>
            <div className="text-title font-semibold num">{formatMoney(calc.total, { exact: calc.total % 100 !== 0 })}</div>
          </div>
          <Button size="lg" onClick={() => submit()} disabled={pending || !ready} className="lg:hidden min-w-36">{pending ? "Saving…" : "Save sale"}</Button>
        </div>
        {error && <p role="alert" className="text-caption text-negative mt-2">{error}</p>}
        <Button size="lg" onClick={() => submit()} disabled={pending || !ready} className="hidden lg:flex w-full mt-4">{pending ? "Saving…" : "Save sale"}</Button>
        <p className="hidden lg:block text-caption text-ink-3 mt-2 text-center">Tip: press N anywhere to start a new sale.</p>
      </div>

      <Sheet open={!!stockWarning} onClose={() => setStockWarning(null)} title="Not enough stock"
        footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setStockWarning(null)}>Go back</Button><Button onClick={() => { setStockWarning(null); submit(true); }}>Sell anyway</Button></div>}>
        <p className="text-body">{stockWarning}</p>
        <p className="text-body text-ink-2 mt-2">You can still record the sale. Ledgr will use the product&apos;s standard cost for now (or mark the cost as missing) and fix it automatically when you record new stock.</p>
      </Sheet>

      <NewCustomerSheet open={newCustomer} onClose={() => setNewCustomer(false)} onCreated={(c) => { setCustomers([...customers, { ...c, is_walk_in: false, payment_terms_days: null }]); setCustomerId(c.id); }} />
    </div>
  );
}

function Row({ l, v, muted }: { l: string; v: string; muted?: boolean }) {
  return <div className={cn("flex justify-between gap-3", muted && "text-ink-2")}><dt className="text-ink-2">{l}</dt><dd>{v}</dd></div>;
}

export function NewCustomerSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (c: { id: string; name: string }) => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [terms, setTerms] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Sheet open={open} onClose={onClose} title="New customer"
      footer={<Button className="w-full" size="lg" disabled={pending} onClick={() => start(async () => {
        const r = await saveCustomer({ name, phone, payment_terms_days: terms ? Number(terms) : null });
        if (!r.ok) return setErr(r.error);
        onCreated?.(r.data); setName(""); setPhone(""); setTerms(""); setErr(null); onClose(); router.refresh();
      })}>{pending ? "Saving…" : "Add customer"}</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="cn"><Input id="cn" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Greenleaf Supermarket" /></Field>
        <Field label="Phone (optional)" htmlFor="cp"><Input id="cp" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 000 0000" /></Field>
        <Field label="Days to pay (optional)" htmlFor="ct" hint="Used for due dates on credit sales."><Input id="ct" inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 14" /></Field>
        {err && <p role="alert" className="text-caption text-negative">{err}</p>}
      </div>
    </Sheet>
  );
}
