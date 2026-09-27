"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { postProduction } from "@/app/actions/ledger";
import { Button, Card, Field, Input, Select, cn } from "@/components/ui/primitives";
import { Combobox, MoneyInput, QtyInput } from "@/components/ui/inputs";
import { formatMoney, formatQty } from "@/lib/finance/money";
import type { FormOptions } from "@/lib/server/queries";

type Kind = "materials" | "labour" | "packaging" | "transport" | "other";
interface Mat { key: number; product_id: string | null; qty: number }
interface Cost { key: number; kind: Kind; description: string; amount: number | null; account_id: string | null }

export function ProductionForm({ opts }: { opts: FormOptions }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [productId, setProductId] = useState<string | null>(null);
  const [qty, setQty] = useState(100);
  const [date, setDate] = useState(opts.today);
  const [batchNo, setBatchNo] = useState("");
  const [mats, setMats] = useState<Mat[]>([{ key: 1, product_id: null, qty: 1 }]);
  const [costs, setCosts] = useState<Cost[]>([{ key: 1, kind: "labour", description: "Labour", amount: null, account_id: opts.accounts.find((a) => a.type === "cash")?.id ?? null }]);
  const [err, setErr] = useState<string | null>(null);
  const byId = useMemo(() => new Map(opts.products.map((p) => [p.id, p])), [opts.products]);

  const calc = useMemo(() => {
    const matRows = mats.map((m) => {
      const p = m.product_id ? byId.get(m.product_id) : undefined;
      const unit = p ? p.avg_cost ?? p.standard_cost : null;
      return { ...m, p, est: unit !== null && p ? Math.round(unit * m.qty) : null, short: p ? m.qty > p.on_hand : false, noCost: p ? p.on_hand <= 0 && p.standard_cost === null : false };
    });
    const matTotal = matRows.reduce((a, m) => a + (m.est ?? 0), 0);
    const costTotal = costs.reduce((a, c) => a + (c.amount ?? 0), 0);
    const total = matTotal + costTotal;
    return { matRows, matTotal, costTotal, total, unit: qty > 0 ? total / qty : 0 };
  }, [mats, costs, qty, byId]);

  const submit = () => start(async () => {
    setErr(null);
    if (!productId) return setErr("Choose the product you made.");
    const r = await postProduction({
      product_id: productId, qty, date, batch_no: batchNo || undefined,
      materials: mats.filter((m) => m.product_id && m.qty > 0).map((m) => ({ product_id: m.product_id!, qty: m.qty })),
      costs: costs.filter((c) => c.amount).map((c) => ({ kind: c.kind, amount: c.amount!, description: c.description || undefined, account_id: c.account_id })),
    });
    if (!r.ok) return setErr(r.error);
    router.push("/inventory/production"); router.refresh();
  });

  const raw = opts.products.filter((p) => p.id !== productId);
  return (
    <div className="flex flex-col gap-4 max-w-3xl pb-8">
      <Card className="p-4 sm:p-5 grid sm:grid-cols-[1fr_150px_160px] gap-4">
        <Field label="What did you make?">
          <Combobox value={productId} onChange={setProductId} placeholder="Choose product" options={opts.products.filter((p) => p.is_sellable).map((p) => ({ value: p.id, label: p.name }))} />
        </Field>
        <Field label="Units made"><QtyInput value={qty} onChange={setQty} /></Field>
        <Field label="Date" htmlFor="bd"><Input id="bd" type="date" value={date} max={opts.today} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Batch number (optional)" htmlFor="bn" hint="Leave blank to number it automatically."><Input id="bn" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="e.g. B-0927-1" /></Field>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-headline font-semibold">Ingredients from stock</h2>
        <p className="text-caption text-ink-2 mt-0.5 mb-3">Fruit, sugar, bottles, labels… These come out of stock at their real (first-in, first-out) cost.</p>
        <div className="flex flex-col gap-3">
          {calc.matRows.map((m) => (
            <div key={m.key} className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[minmax(0,1fr)_140px_44px] gap-2 items-center">
                <div className="min-w-0"><Combobox value={m.product_id} onChange={(id) => setMats(mats.map((x) => x.key === m.key ? { ...x, product_id: id } : x))} placeholder="Choose ingredient"
                  options={raw.map((p) => ({ value: p.id, label: p.name, hint: `${formatQty(p.on_hand, p.unit)} in stock` }))} /></div>
                <QtyInput value={m.qty} onChange={(q) => setMats(mats.map((x) => x.key === m.key ? { ...x, qty: q } : x))} unit={m.p?.unit} />
                <button type="button" onClick={() => setMats(mats.filter((x) => x.key !== m.key))} className="size-11 grid place-items-center rounded-[10px] text-ink-3 hover:text-negative hover:bg-negative-soft" aria-label="Remove ingredient"><Trash2 size={17} /></button>
              </div>
              {m.p && (
                <div className={cn("text-caption flex items-center gap-1.5", m.short ? "text-warning" : "text-ink-2")}>
                  {m.short && <AlertTriangle size={13} />}
                  {m.short ? `Only ${formatQty(m.p.on_hand, m.p.unit)} in stock${m.noCost ? " and no standard cost. Record a purchase first." : ". The rest uses the standard cost."}` : `≈ ${formatMoney(m.est)} at current cost`}
                </div>
              )}
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setMats([...mats, { key: Date.now(), product_id: null, qty: 1 }])}><Plus size={15} />Add ingredient</Button>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="text-headline font-semibold">Other direct costs</h2>
        <p className="text-caption text-ink-2 mt-0.5 mb-3">Labour, transport or anything else spent on this batch. Choose the account if you paid it now.</p>
        <div className="flex flex-col gap-2">
          {costs.map((c) => (
            <div key={c.key} className="grid grid-cols-2 sm:grid-cols-[130px_1fr_140px_150px_auto] gap-2">
              <Select value={c.kind} aria-label="Type" onChange={(e) => setCosts(costs.map((x) => x.key === c.key ? { ...x, kind: e.target.value as Kind } : x))}>
                <option value="labour">Labour</option><option value="materials">Materials</option><option value="packaging">Packaging</option><option value="transport">Transport</option><option value="other">Other</option>
              </Select>
              <Input value={c.description} aria-label="Description" placeholder="Description" onChange={(e) => setCosts(costs.map((x) => x.key === c.key ? { ...x, description: e.target.value } : x))} />
              <MoneyInput value={c.amount} aria-label="Amount" onChange={(v) => setCosts(costs.map((x) => x.key === c.key ? { ...x, amount: v } : x))} />
              <Select value={c.account_id ?? ""} aria-label="Paid from" onChange={(e) => setCosts(costs.map((x) => x.key === c.key ? { ...x, account_id: e.target.value || null } : x))}>
                <option value="">Not paid now</option>
                {opts.accounts.map((a) => <option key={a.id} value={a.id}>Paid from {a.name}</option>)}
              </Select>
              <button type="button" onClick={() => setCosts(costs.filter((x) => x.key !== c.key))} className="size-11 grid place-items-center rounded-[10px] text-ink-3 hover:text-negative hover:bg-negative-soft" aria-label="Remove cost"><Trash2 size={17} /></button>
            </div>
          ))}
        </div>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => setCosts([...costs, { key: Date.now(), kind: "other", description: "", amount: null, account_id: null }])}><Plus size={15} />Add cost</Button>
      </Card>

      <div className="flex items-center justify-between gap-3 bg-surface/95 backdrop-blur-xl border border-hairline rounded-[16px] p-3 sm:p-4 sticky bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-4">
        <dl className="flex gap-6 num min-w-0">
          <div className="hidden sm:block"><dt className="text-caption text-ink-2">Batch cost (est.)</dt><dd className="text-title font-semibold">{formatMoney(calc.total)}</dd></div>
          <div><dt className="text-caption text-ink-2">Cost per unit</dt><dd className="text-title font-semibold">{qty > 0 ? formatMoney(Math.round(calc.unit), { exact: calc.unit < 10_000 }) : "—"}</dd></div>
        </dl>
        <div className="flex flex-col items-end gap-1">
          <Button size="lg" onClick={submit} disabled={pending || !productId || qty <= 0}>{pending ? "Saving…" : "Save batch"}</Button>
          {err && <p role="alert" className="text-caption text-negative max-w-xs text-right">{err}</p>}
        </div>
      </div>
    </div>
  );
}
