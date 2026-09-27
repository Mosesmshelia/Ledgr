"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { postPurchase, saveSupplier } from "@/app/actions/ledger";
import { Button, Card, Field, Input, Select, cn } from "@/components/ui/primitives";
import { Chips, Combobox, MoneyInput, QtyInput } from "@/components/ui/inputs";
import { formatMoney, formatQty, allocate } from "@/lib/finance/money";
import { addDays } from "@/lib/finance/periods";
import type { FormOptions } from "@/lib/server/queries";

interface Line { key: number; product_id: string | null; qty: number; unit_cost: number | null }
interface Cost { key: number; kind: "shipping" | "customs" | "clearing" | "packaging" | "other"; amount: number | null }

export function PurchaseForm({ opts, terms }: { opts: FormOptions; terms: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [suppliers, setSuppliers] = useState(opts.suppliers);
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [date, setDate] = useState(opts.today);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, product_id: null, qty: 1, unit_cost: null }]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [method, setMethod] = useState<"value" | "quantity">("value");
  const [payMode, setPayMode] = useState<"full" | "part" | "none">("full");
  const [part, setPart] = useState<number | null>(null);
  const [account, setAccount] = useState(opts.accounts.find((a) => a.type === "bank")?.id ?? opts.accounts[0]?.id);
  const [err, setErr] = useState<string | null>(null);
  const byId = useMemo(() => new Map(opts.products.map((p) => [p.id, p])), [opts.products]);

  const calc = useMemo(() => {
    const valid = lines.filter((l) => l.product_id && l.unit_cost !== null && l.qty > 0);
    const sub = valid.reduce((a, l) => a + Math.round(l.qty * l.unit_cost!), 0);
    const dc = costs.reduce((a, c) => a + (c.amount ?? 0), 0);
    const shares = allocate(dc, valid.map((l) => (method === "value" && sub > 0 ? Math.round(l.qty * l.unit_cost!) : l.qty)));
    const landed = new Map(valid.map((l, i) => [l.key, (Math.round(l.qty * l.unit_cost!) + shares[i]) / l.qty]));
    return { sub, dc, total: sub + dc, landed };
  }, [lines, costs, method]);
  const paid = payMode === "full" ? calc.total : payMode === "part" ? part ?? 0 : 0;

  const submit = () => start(async () => {
    setErr(null);
    let sid = supplierId;
    if (addingSupplier && newSupplier.trim()) {
      const r = await saveSupplier({ name: newSupplier.trim() });
      if (!r.ok) return setErr(r.error);
      sid = r.data.id; setSuppliers([...suppliers, r.data]); setSupplierId(sid); setAddingSupplier(false);
    }
    if (paid > 0 && !sid) return setErr("Choose or add a supplier to record what you paid them.");
    if (payMode !== "full" && !sid) return setErr("Choose the supplier you owe.");
    const r = await postPurchase({
      supplier_id: sid, date, supplier_invoice_no: invoiceNo || undefined, allocation_method: method,
      due_date: payMode === "full" ? undefined : addDays(date, terms),
      items: lines.filter((l) => l.product_id).map((l) => ({ product_id: l.product_id!, qty: l.qty, unit_cost: l.unit_cost ?? -1 })),
      costs: costs.filter((c) => c.amount).map((c) => ({ kind: c.kind, amount: c.amount! })),
      payment: paid > 0 && account ? { account_id: account, amount: paid } : undefined,
    });
    if (!r.ok) return setErr(r.error);
    router.push("/inventory/purchases"); router.refresh();
  });

  return (
    <div className="flex flex-col gap-4 max-w-3xl pb-8">
      <Card className="p-4 sm:p-5 grid sm:grid-cols-3 gap-4">
        <Field label="Supplier" className="sm:col-span-1" hint={
          <button type="button" className="tap text-accent" onClick={() => { setAddingSupplier(!addingSupplier); setSupplierId(null); setNewSupplier(""); }}>
            {addingSupplier ? "Choose an existing supplier" : "+ New supplier"}
          </button>}>
          {addingSupplier ? (
            <Input value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="New supplier name" autoFocus />
          ) : (
            <Combobox value={supplierId} onChange={setSupplierId} placeholder="Choose supplier" options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
          )}
        </Field>
        <Field label="Date" htmlFor="pd"><Input id="pd" type="date" value={date} max={opts.today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Their invoice no. (optional)" htmlFor="pi"><Input id="pi" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Field>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-headline font-semibold mb-3">Items</h2>
        <div className="flex flex-col gap-4">
          {lines.map((l, i) => {
            const p = l.product_id ? byId.get(l.product_id) : undefined;
            const landed = calc.landed.get(l.key);
            return (
              <div key={l.key} className={cn("flex flex-col gap-3", i > 0 && "pt-4 border-t border-hairline")}>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <Combobox value={l.product_id} onChange={(id) => setLines(lines.map((x) => x.key === l.key ? { ...x, product_id: id } : x))} placeholder="Choose a product"
                      options={opts.products.map((p) => ({ value: p.id, label: p.name, group: p.is_sellable ? "Products" : "Raw materials", hint: `${formatQty(p.on_hand, p.unit)} in stock${p.avg_cost ? ` · last ≈ ${formatMoney(p.avg_cost)}` : ""}` }))} />
                  </div>
                  {lines.length > 1 && <button type="button" onClick={() => setLines(lines.filter((x) => x.key !== l.key))} className="size-11 grid place-items-center rounded-[10px] text-ink-3 hover:text-negative hover:bg-negative-soft" aria-label="Remove"><Trash2 size={17} /></button>}
                </div>
                {p && (
                  <div className="grid grid-cols-2 sm:grid-cols-[140px_1fr_1fr] gap-3">
                    <Field label={`Quantity${p.unit !== "unit" ? ` (${p.unit})` : ""}`}><QtyInput value={l.qty} onChange={(q) => setLines(lines.map((x) => x.key === l.key ? { ...x, qty: q } : x))} /></Field>
                    <Field label="Cost each"><MoneyInput aria-label="Cost each" value={l.unit_cost} onChange={(v) => setLines(lines.map((x) => x.key === l.key ? { ...x, unit_cost: v } : x))} /></Field>
                    <Field label="Landed cost each" className="col-span-2 sm:col-span-1" hint="Including extra costs below.">
                      <div className="h-11 flex items-center rounded-[10px] px-3 bg-surface-2 border border-hairline num">{landed !== undefined ? formatMoney(Math.round(landed), { exact: landed < 10_000 }) : "—"}</div>
                    </Field>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setLines([...lines, { key: Date.now(), product_id: null, qty: 1, unit_cost: null }])}><Plus size={15} />Add item</Button>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-headline font-semibold">Extra costs</h2>
        <p className="text-caption text-ink-2 mt-0.5 mb-3">Transport, customs, clearing or packaging to get this stock ready to sell. They&apos;re added to the stock&apos;s cost, not to your expenses.</p>
        {costs.map((c) => (
          <div key={c.key} className="grid grid-cols-[1fr_1fr_auto] gap-2 mb-2">
            <Select value={c.kind} onChange={(e) => setCosts(costs.map((x) => x.key === c.key ? { ...x, kind: e.target.value as Cost["kind"] } : x))} aria-label="Cost type">
              <option value="shipping">Transport / shipping</option><option value="customs">Customs duty</option><option value="clearing">Clearing</option><option value="packaging">Packaging</option><option value="other">Other</option>
            </Select>
            <MoneyInput value={c.amount} onChange={(v) => setCosts(costs.map((x) => x.key === c.key ? { ...x, amount: v } : x))} aria-label="Amount" />
            <button type="button" onClick={() => setCosts(costs.filter((x) => x.key !== c.key))} className="size-11 grid place-items-center rounded-[10px] text-ink-3 hover:text-negative hover:bg-negative-soft" aria-label="Remove cost"><Trash2 size={17} /></button>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => setCosts([...costs, { key: Date.now(), kind: "shipping", amount: null }])}><Plus size={15} />Add cost</Button>
          {costs.length > 0 && lines.length > 1 && (
            <Chips label="Share costs by" value={method} onChange={setMethod} options={[{ value: "value", label: "Share by value" }, { value: "quantity", label: "Share by quantity" }]} />
          )}
        </div>
      </Card>

      <Card className="p-4 sm:p-5 flex flex-col gap-4">
        <h2 className="text-headline font-semibold">Payment</h2>
        <Chips label="Payment" value={payMode} onChange={setPayMode} options={[{ value: "full", label: "Paid in full" }, { value: "part", label: "Part paid" }, { value: "none", label: "On credit" }]} />
        {payMode === "part" && <div className="max-w-xs"><Field label="Amount paid now"><MoneyInput aria-label="Amount paid now" value={part} onChange={setPart} /></Field></div>}
        {payMode !== "none" && <Field label="Paid from"><Chips label="Account" value={account ?? null} onChange={setAccount} options={opts.accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>}
        {payMode !== "full" && <p className="text-caption text-ink-2">The balance will show under &ldquo;You owe suppliers&rdquo;, due in {terms} days.</p>}
      </Card>

      <div className="flex items-center justify-between gap-4 bg-surface border border-hairline rounded-[16px] p-4 sticky bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-4">
        <div>
          <div className="text-caption text-ink-2">Total {calc.dc > 0 && <span className="num">(incl. {formatMoney(calc.dc)} extra costs)</span>}</div>
          <div className="text-title font-semibold num">{formatMoney(calc.total, { exact: calc.total % 100 !== 0 })}</div>
          {err && <p role="alert" className="text-caption text-negative mt-1">{err}</p>}
        </div>
        <Button size="lg" onClick={submit} disabled={pending || calc.sub === 0}>{pending ? "Saving…" : "Save purchase"}</Button>
      </div>
    </div>
  );
}
