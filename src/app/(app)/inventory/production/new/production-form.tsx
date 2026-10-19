"use client";
// "Made a batch": choose what you made and how many. If it has a recipe, the ingredients fill in by themselves.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, Check, FlaskConical, Plus, Trash2 } from "lucide-react";
import { postProduction } from "@/app/actions/ledger";
import { Button, Card, Field, Input, Select, cn } from "@/components/ui/primitives";
import { Combobox, MoneyInput, QtyInput } from "@/components/ui/inputs";
import { formatMoney, formatQty } from "@/lib/finance/money";
import type { FormOptions } from "@/lib/server/queries";

type Kind = "materials" | "labour" | "packaging" | "transport" | "other";
interface Mat { key: number; product_id: string | null; qty: number }
interface Cost { key: number; kind: Kind; description: string; amount: number | null; account_id: string | null }
export interface Recipe { product_id: string; yield_qty: number; items: { ingredient_id: string; qty: number }[] }

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function ProductionForm({ opts, recipes, canEditRecipes, initialProduct }: { opts: FormOptions; recipes: Recipe[]; canEditRecipes: boolean; initialProduct?: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const recipeOf = useMemo(() => new Map(recipes.map((r) => [r.product_id, r])), [recipes]);
  const fromRecipe = (pid: string | null, made: number): Mat[] => {
    const r = pid ? recipeOf.get(pid) : undefined;
    if (!r) return [{ key: 1, product_id: null, qty: 1 }];
    return r.items.map((it, i) => ({ key: i + 1, product_id: it.ingredient_id, qty: round3((it.qty * made) / r.yield_qty) }));
  };
  const startQty = initialProduct && recipeOf.get(initialProduct) ? recipeOf.get(initialProduct)!.yield_qty : 40;
  const [productId, setProductId] = useState<string | null>(initialProduct ?? null);
  const [qty, setQty] = useState(startQty);
  const [date, setDate] = useState(opts.today);
  const [batchNo, setBatchNo] = useState("");
  const [mats, setMats] = useState<Mat[]>(() => fromRecipe(initialProduct ?? null, startQty));
  const [followRecipe, setFollowRecipe] = useState(!!(initialProduct && recipeOf.get(initialProduct)));
  const [costs, setCosts] = useState<Cost[]>([]);
  const [remember, setRemember] = useState(true);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const byId = useMemo(() => new Map(opts.products.map((p) => [p.id, p])), [opts.products]);
  const recipe = productId ? recipeOf.get(productId) : undefined;
  const product = productId ? byId.get(productId) : undefined;

  function pickProduct(id: string) {
    setProductId(id);
    const r = recipeOf.get(id);
    if (r) { setQty(r.yield_qty); setMats(fromRecipe(id, r.yield_qty)); setFollowRecipe(true); }
    else { setMats([{ key: 1, product_id: null, qty: 1 }]); setFollowRecipe(false); }
  }
  function changeQty(n: number) {
    setQty(n);
    if (followRecipe && productId) setMats(fromRecipe(productId, n));
  }
  const editMats = (next: Mat[]) => { setMats(next); setFollowRecipe(false); };

  const calc = useMemo(() => {
    const matRows = mats.map((m) => {
      const p = m.product_id ? byId.get(m.product_id) : undefined;
      const unit = p ? p.avg_cost ?? p.standard_cost : null;
      return { ...m, p, est: unit !== null && p ? Math.round(unit * m.qty) : null, short: p ? m.qty > p.on_hand : false, noCost: p ? p.on_hand <= 0 && p.standard_cost === null : false };
    });
    const matTotal = matRows.reduce((a, m) => a + (m.est ?? 0), 0);
    const costTotal = costs.reduce((a, c) => a + (c.amount ?? 0), 0);
    const total = matTotal + costTotal;
    return { matRows, total, unit: qty > 0 ? total / qty : 0 };
  }, [mats, costs, qty, byId]);

  // Does what's on screen differ from the saved recipe (per unit made)?
  const used = mats.filter((m) => m.product_id && m.qty > 0);
  const differs = !recipe || used.length !== recipe.items.length || used.some((m) => {
    const it = recipe.items.find((i) => i.ingredient_id === m.product_id);
    return !it || Math.abs(m.qty / qty - it.qty / recipe.yield_qty) > 0.0005;
  });
  const willSaveRecipe = canEditRecipes && remember && differs && used.length > 0 && qty > 0;

  const submit = () => start(async () => {
    setErr(null);
    if (!productId) return setErr("Choose what you made.");
    const r = await postProduction({
      product_id: productId, qty, date, batch_no: batchNo || undefined,
      materials: used.map((m) => ({ product_id: m.product_id!, qty: m.qty })),
      costs: costs.filter((c) => c.amount).map((c) => ({ kind: c.kind, amount: c.amount!, description: c.description || undefined, account_id: c.account_id })),
      saveRecipe: willSaveRecipe,
    });
    if (!r.ok) return setErr(r.error);
    router.push("/inventory/production?made=1"); router.refresh();
  });

  const raw = opts.products.filter((p) => p.id !== productId);
  const sellable = opts.products.filter((p) => p.is_sellable);
  return (
    <div className="flex flex-col gap-4 max-w-3xl pb-8">
      <Card className="p-5 flex flex-col gap-4">
        <div className="grid sm:grid-cols-[1fr_170px] gap-4">
          <Field label="What did you make?">
            <Combobox value={productId} onChange={pickProduct} placeholder="e.g. Orange juice 50cl"
              options={sellable.map((p) => ({ value: p.id, label: p.name, hint: recipeOf.has(p.id) ? "Has a recipe" : undefined }))} />
          </Field>
          <Field label={`How many?${product && product.unit !== "unit" ? ` (${product.unit})` : ""}`}><QtyInput value={qty} onChange={changeQty} unit={product?.unit} /></Field>
        </div>
        {recipe && (
          <p className={cn("flex items-center gap-2 text-caption rounded-[12px] px-3 py-2.5", followRecipe ? "bg-accent-soft text-accent" : "bg-fill text-ink-2")}>
            <BookOpen size={15} className="shrink-0" />
            {followRecipe
              ? <>Using your recipe: {formatQty(recipe.yield_qty)} per batch. Ingredients adjust when you change “How many”.</>
              : <>You changed the ingredients. <button className="underline font-medium" onClick={() => { setMats(fromRecipe(productId, qty)); setFollowRecipe(true); }}>Use the recipe again</button></>}
          </p>
        )}
        <button type="button" onClick={() => setMore(!more)} className="self-start text-caption text-ink-2 font-medium tap">{more ? "Hide date & batch number" : "Change date or batch number"}</button>
        {more && (
          <div className="grid sm:grid-cols-2 gap-4 animate-rise">
            <Field label="Date" htmlFor="bd"><Input id="bd" type="date" value={date} max={opts.today} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Batch number (optional)" htmlFor="bn" hint="Leave blank to number it automatically."><Input id="bn" value={batchNo} onChange={(e) => setBatchNo(e.target.value)} placeholder="e.g. B-0927-1" /></Field>
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h2 className="text-headline font-semibold">Ingredients used</h2>
        <p className="text-caption text-ink-2 mt-0.5 mb-4">Fruit, sugar, bottles, labels… They come out of stock at what you actually paid for them.</p>
        <div className="flex flex-col gap-3 stagger">
          {calc.matRows.map((m) => (
            <div key={m.key} className="flex flex-col gap-1.5">
              <div className="grid grid-cols-[minmax(0,1fr)_140px_44px] gap-2 items-center">
                <div className="min-w-0"><Combobox value={m.product_id} onChange={(id) => editMats(mats.map((x) => x.key === m.key ? { ...x, product_id: id } : x))} placeholder="Choose ingredient"
                  options={raw.map((p) => ({ value: p.id, label: p.name, hint: `${formatQty(p.on_hand, p.unit)} in stock` }))} /></div>
                <QtyInput value={m.qty} onChange={(q) => editMats(mats.map((x) => x.key === m.key ? { ...x, qty: q } : x))} unit={m.p?.unit} />
                <button type="button" onClick={() => editMats(mats.filter((x) => x.key !== m.key))} className="size-11 grid place-items-center rounded-[12px] text-ink-3 hover:text-negative hover:bg-negative-soft" aria-label="Remove ingredient"><Trash2 size={17} /></button>
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
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => editMats([...mats, { key: Date.now(), product_id: null, qty: 1 }])}><Plus size={15} />Add ingredient</Button>

        {canEditRecipes && productId && used.length > 0 && differs && (
          <label className="mt-4 flex items-start gap-3 rounded-[14px] bg-surface-2 border border-hairline p-3.5 cursor-pointer">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
            <span className={cn("mt-0.5 size-5 rounded-[6px] border-2 grid place-items-center shrink-0 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent", remember ? "bg-accent border-accent text-on-accent" : "border-hairline-strong")} aria-hidden>{remember && <Check size={13} strokeWidth={3} />}</span>
            <span className="text-body">
              <span className="font-medium">{recipe ? "Update the recipe" : "Save as the recipe"} for {product?.name}</span>
              <span className="block text-caption text-ink-2">Next time, just pick the product and type how many. The ingredients fill in by themselves.</span>
            </span>
          </label>
        )}
      </Card>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-headline font-semibold">Labour & other costs <span className="text-ink-3 font-normal">(optional)</span></h2>
            <p className="text-caption text-ink-2 mt-0.5">Money spent on this batch, like a helper&apos;s pay or transport.</p>
          </div>
        </div>
        {costs.length > 0 && (
          <div className="flex flex-col gap-2 mt-4">
            {costs.map((c) => (
              <div key={c.key} className="grid grid-cols-2 sm:grid-cols-[130px_1fr_140px_160px_auto] gap-2">
                <Select value={c.kind} aria-label="Type" onChange={(e) => setCosts(costs.map((x) => x.key === c.key ? { ...x, kind: e.target.value as Kind } : x))}>
                  <option value="labour">Labour</option><option value="materials">Materials</option><option value="packaging">Packaging</option><option value="transport">Transport</option><option value="other">Other</option>
                </Select>
                <Input value={c.description} aria-label="Description" placeholder="Description" onChange={(e) => setCosts(costs.map((x) => x.key === c.key ? { ...x, description: e.target.value } : x))} />
                <MoneyInput value={c.amount} aria-label="Amount" onChange={(v) => setCosts(costs.map((x) => x.key === c.key ? { ...x, amount: v } : x))} />
                <Select value={c.account_id ?? ""} aria-label="Paid from" onChange={(e) => setCosts(costs.map((x) => x.key === c.key ? { ...x, account_id: e.target.value || null } : x))}>
                  <option value="">Not paid yet</option>
                  {opts.accounts.map((a) => <option key={a.id} value={a.id}>Paid from {a.name}</option>)}
                </Select>
                <button type="button" onClick={() => setCosts(costs.filter((x) => x.key !== c.key))} className="size-11 grid place-items-center rounded-[12px] text-ink-3 hover:text-negative hover:bg-negative-soft" aria-label="Remove cost"><Trash2 size={17} /></button>
              </div>
            ))}
          </div>
        )}
        <Button variant="secondary" size="sm" className="mt-4" onClick={() => setCosts([...costs, { key: Date.now(), kind: "labour", description: "", amount: null, account_id: opts.accounts.find((a) => a.type === "cash")?.id ?? null }])}><Plus size={15} />Add a cost</Button>
      </Card>

      <div className="flex items-center justify-between gap-3 bg-surface/95 backdrop-blur-xl border border-hairline rounded-[22px] p-3 sm:p-4 sticky bottom-[calc(80px+env(safe-area-inset-bottom))] lg:bottom-4 shadow-[var(--shadow-lift)]">
        <dl className="flex gap-6 num min-w-0">
          <div className="hidden sm:block"><dt className="text-caption text-ink-2">Batch cost (est.)</dt><dd className="text-title font-semibold">{formatMoney(calc.total)}</dd></div>
          <div><dt className="text-caption text-ink-2">Cost each</dt><dd className="text-title font-semibold">{qty > 0 ? formatMoney(Math.round(calc.unit), { exact: calc.unit < 10_000 }) : "—"}</dd></div>
        </dl>
        <div className="flex flex-col items-end gap-1">
          <Button size="lg" onClick={submit} disabled={pending || !productId || qty <= 0}><FlaskConical size={18} />{pending ? "Saving…" : "Save batch"}</Button>
          {err && <p role="alert" className="text-caption text-negative max-w-xs text-right">{err}</p>}
        </div>
      </div>
    </div>
  );
}
