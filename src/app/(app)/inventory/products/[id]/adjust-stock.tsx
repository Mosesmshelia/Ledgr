"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlidersHorizontal } from "lucide-react";
import { postStockAdjustment, voidStockAdjustment } from "@/app/actions/control";
import { Button, Field, Input, Textarea } from "@/components/ui/primitives";
import { Chips, MoneyInput, QtyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney, formatQty } from "@/lib/finance/money";

const REASONS_OUT = ["Broken", "Expired or spoiled", "Stock count was lower", "Used by staff", "Given away free"];
const REASONS_IN = ["Stock count was higher", "Found in store", "Returned by staff"];

export function AdjustStockButton({ product, onHand, avgCost, today }: {
  product: { id: string; name: string; unit: string }; onHand: number; avgCost: number | null; today: string;
}) {
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<"out" | "in">("out");
  const [qty, setQty] = useState(1);
  const [unitCost, setUnitCost] = useState<number | null>(avgCost);
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const presets = dir === "out" ? REASONS_OUT : REASONS_IN;
  const after = dir === "out" ? onHand - qty : onHand + qty;
  const effect = dir === "out"
    ? `Removes ${formatQty(qty, product.unit)} at their FIFO cost. That cost counts as a business cost (cost of goods) for ${date === today ? "today" : "that day"}.`
    : unitCost !== null ? `Adds ${formatQty(qty, product.unit)} worth ${formatMoney(Math.round(qty * unitCost), { exact: true })}. That lowers your cost of goods by the same amount.` : "";

  const submit = () => start(async () => {
    setErr(null);
    const r = await postStockAdjustment({
      product_id: product.id, date, reason: reason.trim(),
      qty_change: dir === "out" ? -qty : qty,
      unit_cost: dir === "in" ? unitCost ?? undefined : undefined,
    });
    if (!r.ok) return setErr(r.error);
    setOpen(false); setReason(""); setQty(1); router.refresh();
  });

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><SlidersHorizontal size={16} />Adjust stock</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Adjust stock" subtitle={`${product.name} · ${formatQty(onHand, product.unit)} in stock now`}
        footer={<Button size="lg" className="w-full" onClick={submit}
          disabled={pending || qty <= 0 || reason.trim().length < 3 || (dir === "in" && unitCost === null) || (dir === "out" && qty > onHand)}>
          {pending ? "Saving…" : dir === "out" ? `Remove ${formatQty(qty, product.unit)}` : `Add ${formatQty(qty, product.unit)}`}
        </Button>}>
        <div className="flex flex-col gap-4">
          <Chips label="Direction" value={dir} onChange={(v) => { setDir(v); setReason(""); }}
            options={[{ value: "out", label: "Remove (lost, broken, expired)" }, { value: "in", label: "Add (found, recount)" }]} />
          <Field label="How many" htmlFor="adj-qty" hint={`After this: ${formatQty(after, product.unit)}`}>
            <QtyInput id="adj-qty" value={qty} onChange={setQty} unit={product.unit} />
          </Field>
          {dir === "out" && qty > onHand && <p className="text-caption text-negative -mt-2">You only have {formatQty(onHand, product.unit)}.</p>}
          {dir === "in" && (
            <Field label="Cost of each" htmlFor="adj-cost" hint={avgCost !== null ? "Pre-filled with the current average cost." : "What each one cost you."}>
              <MoneyInput id="adj-cost" value={unitCost} onChange={setUnitCost} />
            </Field>
          )}
          <Field label="Reason" htmlFor="adj-reason">
            <div className="flex flex-wrap gap-1.5 mb-2">
              {presets.map((p) => (
                <button key={p} type="button" onClick={() => setReason(p)}
                  className="h-8 px-3 rounded-full text-caption border border-hairline-strong hover:bg-fill">{p}</button>
              ))}
            </div>
            <Textarea id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder='e.g. "3 bottles broke during delivery"' />
          </Field>
          <Field label="Date" htmlFor="adj-date"><Input id="adj-date" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          {effect && <p className="text-caption text-ink-2">{effect}</p>}
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}

export function VoidAdjustment({ id, label }: { id: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="tap text-caption text-ink-2 hover:text-negative">Void</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Void adjustment?"
        footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={pending || reason.trim().length < 3} onClick={() => start(async () => {
            const r = await voidStockAdjustment({ id, reason });
            if (!r.ok) return setErr(r.error);
            setOpen(false); router.refresh();
          })}>{pending ? "Voiding…" : "Void adjustment"}</Button></div>}>
        <div className="flex flex-col gap-4">
          <p className="text-body">This reverses “{label}”: stock goes back to what it was and the cost is removed.</p>
          <p className="text-caption text-ink-2">Nothing is deleted. It stays in your records, marked as voided, with your reason.</p>
          <Field label="Reason" htmlFor="va-r"><Textarea id="va-r" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Counted again, they were fine" autoFocus /></Field>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}
