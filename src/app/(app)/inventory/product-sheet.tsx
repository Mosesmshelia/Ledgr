"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus } from "lucide-react";
import { saveProduct } from "@/app/actions/ledger";
import { Button, Field, Input } from "@/components/ui/primitives";
import { Chips, MoneyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";

interface P { id: string; name: string; sku: string | null; unit: string; category: string | null; selling_price: number | null; standard_cost: number | null; min_stock: number; is_sellable: boolean }

export function ProductSheetTrigger({ open: initial, categories }: { open: boolean; categories: string[] }) {
  const [open, setOpen] = useState(initial);
  const router = useRouter();
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus size={16} />Add product</Button>
      <ProductSheet open={open} onClose={() => { setOpen(false); if (initial) router.replace("/inventory"); }} categories={categories} />
    </>
  );
}

export function EditProductButton({ product, categories }: { product: P; categories: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:text-ink hover:bg-fill" aria-label={`Edit ${product.name}`}><Pencil size={15} /></button>
      <ProductSheet open={open} onClose={() => setOpen(false)} categories={categories} product={product} />
    </>
  );
}

function ProductSheet({ open, onClose, categories, product }: { open: boolean; onClose: () => void; categories: string[]; product?: P }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [kind, setKind] = useState<"sell" | "raw">(product && !product.is_sellable ? "raw" : "sell");
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [category, setCategory] = useState(product?.category ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "unit");
  const [price, setPrice] = useState<number | null>(product?.selling_price ?? null);
  const [std, setStd] = useState<number | null>(product?.standard_cost ?? null);
  const [min, setMin] = useState(String(product?.min_stock ?? ""));
  const [openingQty, setOpeningQty] = useState("");
  const [openingCost, setOpeningCost] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const save = () => start(async () => {
    const opening = !product && Number(openingQty) > 0 ? { qty: Number(openingQty), unit_cost: openingCost ?? -1, date: new Date().toISOString().slice(0, 10) } : null;
    if (opening && openingCost === null) return setErr("Enter what each unit in stock cost you.");
    const r = await saveProduct({ id: product?.id, name, sku, category, unit, selling_price: kind === "sell" ? price : null, standard_cost: std, min_stock: Number(min) || 0, is_sellable: kind === "sell", opening });
    if (!r.ok) return setErr(r.error);
    onClose(); router.refresh();
  });

  return (
    <Sheet open={open} onClose={onClose} title={product ? "Edit product" : "Add product"}
      footer={<Button size="lg" className="w-full" onClick={save} disabled={pending}>{pending ? "Saving…" : product ? "Save changes" : "Add product"}</Button>}>
      <div className="flex flex-col gap-4">
        <Chips label="Type" value={kind} onChange={setKind} options={[{ value: "sell", label: "I sell this" }, { value: "raw", label: "Raw material / packaging" }]} />
        <Field label="Name" htmlFor="pn"><Input id="pn" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Orange juice 50cl" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="pc">
            <Input id="pc" list="cats" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Fresh juices" />
            <datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <Field label="Unit" htmlFor="pu" hint="unit, kg, pcs, litre…"><Input id="pu" value={unit} onChange={(e) => setUnit(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {kind === "sell" && <Field label="Selling price"><MoneyInput value={price} onChange={setPrice} /></Field>}
          <Field label="Standard cost (optional)" hint="Only used when real cost is unknown."><MoneyInput value={std} onChange={setStd} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU (optional)" htmlFor="ps"><Input id="ps" value={sku} onChange={(e) => setSku(e.target.value)} /></Field>
          <Field label="Warn me below" htmlFor="pm" hint="Low-stock alert level."><Input id="pm" inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
        </div>
        {!product && (
          <div className="rounded-[12px] bg-surface-2 border border-hairline p-4 flex flex-col gap-3">
            <div className="text-body font-medium">Stock you already have <span className="text-ink-3 font-normal">(optional)</span></div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity" htmlFor="oq"><Input id="oq" inputMode="decimal" value={openingQty} onChange={(e) => setOpeningQty(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0" /></Field>
              <Field label="Cost per unit"><MoneyInput value={openingCost} onChange={setOpeningCost} /></Field>
            </div>
          </div>
        )}
        {err && <p role="alert" className="text-caption text-negative">{err}</p>}
      </div>
    </Sheet>
  );
}
