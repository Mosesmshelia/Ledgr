"use client";
// The till: tap products to add them, pick how they paid, Charge. Built for a busy shop counter.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Minus, MessageCircle, Plus, Repeat2, Search, SlidersHorizontal, UserRound, X } from "lucide-react";
import { postSale, saleReceiptInfo } from "@/app/actions/ledger";
import { Button, Field, Input, cn } from "@/components/ui/primitives";
import { MoneyInput, QtyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney, formatQty, allocate } from "@/lib/finance/money";
import { addDays } from "@/lib/finance/periods";
import { whatsappLink } from "@/lib/whatsapp";
import type { FormOptions } from "@/lib/server/queries";
import { NewCustomerSheet } from "@/components/app/customer-sheet";

type Method = "cash" | "transfer" | "pos" | "credit";
interface Line { qty: number; unit_price: number; line_discount: number }
export interface LastSale { customer_id: string; items: { product_id: string; qty: number; unit_price: number }[] }

const METHOD_TYPES: Record<Exclude<Method, "credit">, string[]> = { cash: ["cash"], transfer: ["bank", "mobile_money", "other"], pos: ["pos"] };
const METHOD_LABEL: Record<Method, string> = { cash: "Cash", transfer: "Transfer", pos: "POS", credit: "Owes" };

// Each product gets its own soft colour, so staff learn the till by colour as well as name.
const TINTS = ["#c2410c", "#a16207", "#be123c", "#6d28d9", "#15803d", "#0f766e", "#1d4ed8", "#9d174d", "#4d7c0f", "#b45309"];
function tintOf(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function Till({ opts, vat, canSeeCosts, defaultTerms, lastSale }: {
  opts: FormOptions; vat: { rateBp: number; inclusive: boolean } | null; canSeeCosts: boolean; defaultTerms: number; lastSale: LastSale | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customers, setCustomers] = useState(opts.customers);
  const walkIn = customers.find((c) => c.is_walk_in)!;
  const [customerId, setCustomerId] = useState(walkIn.id);
  const [cart, setCart] = useState<Map<string, Line>>(new Map());
  const [order, setOrder] = useState<string[]>([]); // lines in the order they were added
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string | null>(null);
  const methods = (Object.keys(METHOD_TYPES) as Exclude<Method, "credit">[]).filter((m) => opts.accounts.some((a) => METHOD_TYPES[m].includes(a.type)));
  const [method, setMethod] = useState<Method>(methods[0] ?? "credit");
  const [accountPick, setAccountPick] = useState<Record<string, string>>({});
  const [date, setDate] = useState(opts.today);
  const [invDisc, setInvDisc] = useState<number | null>(null);
  const [partPaid, setPartPaid] = useState<number | null>(null);
  const [sheet, setSheet] = useState<null | "customer" | "options" | "newCustomer" | { line: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [stockWarning, setStockWarning] = useState<string | null>(null);
  const [done, setDone] = useState<null | { id: string; total: number; method: Method; lines: { name: string; qty: number; amount: number }[]; customerId: string; paid: number }>(null);
  const [bump, setBump] = useState(0);

  const products = opts.products.filter((p) => p.is_sellable);
  const byId = useMemo(() => new Map(opts.products.map((p) => [p.id, p])), [opts.products]);
  const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))] as string[], [products]);
  const customer = customers.find((c) => c.id === customerId)!;
  const shown = products.filter((p) => (!cat || p.category === cat) && (!q || `${p.name} ${p.sku ?? ""} ${p.category ?? ""}`.toLowerCase().includes(q.toLowerCase())));

  const accountsFor = (m: Method) => m === "credit" ? [] : opts.accounts.filter((a) => METHOD_TYPES[m].includes(a.type));
  const account = method === "credit" ? null : (accountPick[method] ?? accountsFor(method)[0]?.id ?? null);

  // Totals (the server recalculates authoritatively when the sale is saved).
  const calc = useMemo(() => {
    const rows = order.filter((id) => cart.has(id)).map((id) => {
      const l = cart.get(id)!, p = byId.get(id)!;
      const base = Math.round(l.qty * l.unit_price) - l.line_discount;
      const unitCost = p.avg_cost ?? p.standard_cost;
      return { id, p, ...l, base, unitCost };
    });
    const shares = allocate(Math.min(invDisc ?? 0, rows.reduce((a, r) => a + Math.max(0, r.base), 0)), rows.map((r) => Math.max(0, r.base)));
    const subtotal = rows.reduce((a, r, i) => a + r.base - shares[i], 0);
    const bp = vat?.rateBp ?? 0;
    const vatAmt = !vat ? 0 : vat.inclusive ? Math.round((subtotal * bp) / (10000 + bp)) : Math.round((subtotal * bp) / 10000);
    const total = vat && !vat.inclusive ? subtotal + vatAmt : subtotal;
    const revenue = vat?.inclusive ? subtotal - vatAmt : subtotal;
    const knownCost = rows.every((r) => r.unitCost !== null);
    const cost = rows.reduce((a, r) => a + (r.unitCost !== null ? Math.round(r.qty * r.unitCost) : 0), 0);
    const count = rows.reduce((a, r) => a + r.qty, 0);
    return { rows, total, vatAmt, revenue, profit: revenue - cost, knownCost, count };
  }, [order, cart, byId, invDisc, vat]);

  const paid = method === "credit" ? Math.min(partPaid ?? 0, calc.total) : calc.total;

  function setQty(id: string, qty: number) {
    const p = byId.get(id)!;
    setCart((c) => {
      const next = new Map(c);
      if (qty <= 0) next.delete(id);
      else next.set(id, { qty, unit_price: c.get(id)?.unit_price ?? p.selling_price ?? 0, line_discount: c.get(id)?.line_discount ?? 0 });
      return next;
    });
    setOrder((o) => (qty <= 0 ? o.filter((x) => x !== id) : o.includes(id) ? o : [...o, id]));
    setError(null);
  }
  const add = (id: string) => { setQty(id, (cart.get(id)?.qty ?? 0) + 1); setBump((b) => b + 1); };
  const clear = () => { setCart(new Map()); setOrder([]); setInvDisc(null); setPartPaid(null); setError(null); };

  function repeatLast() {
    if (!lastSale) return;
    const next = new Map<string, Line>();
    const ids: string[] = [];
    for (const it of lastSale.items) {
      if (!byId.has(it.product_id)) continue;
      next.set(it.product_id, { qty: it.qty, unit_price: byId.get(it.product_id)!.selling_price ?? it.unit_price, line_discount: 0 });
      ids.push(it.product_id);
    }
    setCart(next); setOrder(ids);
    if (customers.some((c) => c.id === lastSale.customer_id)) setCustomerId(lastSale.customer_id);
  }

  function charge(allowNegative = false) {
    setError(null);
    if (calc.rows.length === 0) return setError("Tap a product to add it.");
    if (calc.rows.some((r) => r.unit_price <= 0 && r.p.selling_price === null)) return setError(`Set a price for ${calc.rows.find((r) => r.unit_price <= 0)!.p.name} (tap it in the list).`);
    if (method === "credit" && customer.is_walk_in) { setSheet("customer"); return setError("Who owes you? Pick the customer so you can follow up."); }
    if (method !== "credit" && !account) return setError("Add a cash, bank or POS account in Settings first.");
    if (method === "credit" && partPaid && partPaid >= calc.total) return setError("Part payment must be less than the total. Choose Cash, Transfer or POS instead.");
    const creditAccount = opts.accounts.find((a) => a.type === "cash")?.id ?? opts.accounts[0]?.id;
    start(async () => {
      const res = await postSale({
        customer_id: customerId, date,
        due_date: method === "credit" ? addDays(date, customer.payment_terms_days ?? defaultTerms) : undefined,
        items: calc.rows.map((r) => ({ product_id: r.id, qty: r.qty, unit_price: r.unit_price, line_discount: r.line_discount })),
        invoice_discount: invDisc ?? 0,
        payment: paid > 0 ? { account_id: (method === "credit" ? creditAccount : account)!, amount: paid } : undefined,
        allow_negative_stock: allowNegative,
      });
      if (res.ok) {
        setDone({ id: res.data, total: calc.total, method, customerId, paid, lines: calc.rows.map((r) => ({ name: r.p.name, qty: r.qty, amount: r.base })) });
        router.refresh();
      } else if (res.code === "INSUFFICIENT_STOCK") setStockWarning(res.error);
      else setError(res.error);
    });
  }

  function nextSale() {
    clear(); setDone(null); setCustomerId(walkIn.id); setMethod(methods[0] ?? "credit"); setDate(opts.today);
  }

  const lineSheet = typeof sheet === "object" && sheet ? sheet.line : null;

  return (
    <div className="max-lg:fixed max-lg:inset-0 max-lg:z-30 max-lg:bg-bg flex flex-col lg:grid lg:grid-cols-[1fr_380px] lg:gap-6 lg:items-start lg:h-[calc(100dvh-96px)]">
      {/* Left: products */}
      <div className="flex flex-col min-h-0 flex-1 lg:h-full">
        <div className="px-4 lg:px-0 pt-[max(12px,env(safe-area-inset-top))] lg:pt-0 pb-3 flex flex-col gap-3">
          <div className="flex items-center gap-2.5">
            <Link href="/dashboard" aria-label="Back" className="lg:hidden size-11 rounded-full bg-surface border border-hairline grid place-items-center shrink-0"><ChevronLeft size={20} /></Link>
            <h1 className="text-title font-bold font-display flex-1">New sale</h1>
            {lastSale && (
              <button onClick={repeatLast} className="press h-10 px-3.5 rounded-full bg-accent-soft text-accent text-caption font-semibold flex items-center gap-1.5">
                <Repeat2 size={16} />Repeat last
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <label className="flex-1 h-11 rounded-[14px] bg-surface border border-hairline flex items-center gap-2 px-3 text-ink-3 focus-within:border-accent">
              <Search size={18} aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products" aria-label="Search products" className="flex-1 min-w-0 bg-transparent outline-none text-body text-ink placeholder:text-ink-3" />
              {q && <button onClick={() => setQ("")} aria-label="Clear search" className="text-ink-3"><X size={16} /></button>}
            </label>
            <button onClick={() => setSheet("customer")} className={cn("press h-11 px-3.5 rounded-[14px] border flex items-center gap-1.5 text-caption font-semibold max-w-[45%]", customer.is_walk_in ? "bg-surface border-hairline" : "bg-accent-soft text-accent border-transparent")}>
              <UserRound size={16} className="shrink-0" /><span className="truncate">{customer.is_walk_in ? "Walk-in" : customer.name}</span>
            </button>
          </div>
          {categories.length > 1 && (
            <div className="flex gap-2 overflow-x-auto -mx-4 px-4 lg:mx-0 lg:px-0 [scrollbar-width:none]" role="group" aria-label="Category">
              {[null, ...categories].map((c) => (
                <button key={c ?? "all"} onClick={() => setCat(c)} aria-pressed={cat === c}
                  className={cn("h-9 px-3.5 rounded-full text-caption font-medium whitespace-nowrap transition-colors", cat === c ? "bg-ink text-bg" : "bg-surface border border-hairline text-ink-2")}>
                  {c ?? "All"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 lg:px-0 pb-4">
          {products.length === 0 ? (
            <div className="text-center py-16 text-ink-2">
              <p className="text-body">No products to sell yet.</p>
              <Link href="/inventory?add=1" className="text-accent font-medium">Add your first product</Link>
            </div>
          ) : shown.length === 0 ? (
            <p className="text-center py-16 text-body text-ink-2">Nothing matches “{q}”.</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-2.5 stagger">
              {shown.map((p) => {
                const inCart = cart.get(p.id)?.qty ?? 0;
                const tint = tintOf(p.name);
                const out = p.on_hand <= 0;
                const low = !out && p.on_hand <= 5;
                return (
                  <button key={p.id} onClick={() => add(p.id)}
                    aria-label={`${p.name}, ${p.selling_price !== null ? formatMoney(p.selling_price) : "no price"}${out ? ", out of stock" : ""}${inCart ? `, ${formatQty(inCart)} in this sale` : ""}`}
                    className={cn("press relative h-[108px] rounded-[18px] bg-surface border-2 p-2.5 flex flex-col items-start justify-between text-left shadow-[var(--shadow-card)]",
                      inCart ? "border-accent" : "border-transparent", out && "bg-surface-2")}>
                    <span className={cn("size-8 rounded-[10px] grid place-items-center text-[14px] font-bold text-white", out && "grayscale")} style={{ background: tint }} aria-hidden>
                      {p.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="flex flex-col gap-0.5 w-full">
                      <span className={cn("text-[13px] font-medium leading-tight line-clamp-2", out && "text-ink-2")}>{p.name}</span>
                      <span className="text-[13px] font-semibold num">{p.selling_price !== null ? formatMoney(p.selling_price) : <span className="text-warning">No price</span>}</span>
                    </span>
                    {inCart > 0 ? (
                      <span key={inCart} className="animate-pop absolute top-2 right-2 min-w-[26px] h-[26px] px-1.5 rounded-full bg-accent text-on-accent text-[13px] font-bold grid place-items-center num">{formatQty(inCart)}</span>
                    ) : (out || low) && (
                      <span className={cn("absolute top-2.5 right-2.5 text-[11px] font-semibold", out ? "text-negative" : "text-warning")}>{out ? "Out" : `${formatQty(p.on_hand)} left`}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Right / bottom: the receipt */}
      <section aria-label="This sale" className="bg-surface max-lg:rounded-t-[26px] lg:rounded-[24px] lg:border lg:border-hairline shadow-[0_-10px_30px_rgba(17,19,24,0.08)] lg:shadow-[var(--shadow-card)] px-4 pt-4 pb-[calc(16px+env(safe-area-inset-bottom))] lg:p-5 flex flex-col gap-3 lg:sticky lg:top-20 lg:max-h-full">
        <div className="flex items-center justify-between">
          <h2 className="text-headline font-semibold">{calc.count ? `${formatQty(calc.count)} item${calc.count === 1 ? "" : "s"}` : "This sale"}</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setSheet("options")} className="tap h-9 px-2.5 rounded-full text-caption font-medium text-ink-2 hover:bg-fill flex items-center gap-1"><SlidersHorizontal size={15} />Options</button>
            {calc.rows.length > 0 && <button onClick={clear} className="tap h-9 px-2.5 rounded-full text-caption font-medium text-ink-2 hover:bg-fill">Clear</button>}
          </div>
        </div>

        <ul className="flex flex-col gap-1 max-h-[132px] lg:max-h-[40vh] overflow-y-auto -mx-1 px-1">
          {calc.rows.length === 0 && <li className="text-body text-ink-2 py-2">Tap products to add them.</li>}
          {calc.rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 animate-rise">
              <button onClick={() => setSheet({ line: r.id })} className="flex-1 min-w-0 text-left py-1.5 group">
                <span className="block text-body truncate group-hover:text-accent">{r.p.name}</span>
                <span className="block text-caption text-ink-3 num">{formatMoney(r.unit_price, { exact: r.unit_price % 100 !== 0 })} each{r.line_discount ? ` · −${formatMoney(r.line_discount)}` : ""}</span>
              </button>
              <div className="flex items-center gap-1">
                <button onClick={() => setQty(r.id, r.qty - 1)} aria-label={`One less ${r.p.name}`} className="press size-9 rounded-full bg-fill grid place-items-center"><Minus size={16} /></button>
                <span className="w-8 text-center font-semibold num">{formatQty(r.qty)}</span>
                <button onClick={() => add(r.id)} aria-label={`One more ${r.p.name}`} className="press size-9 rounded-full bg-fill grid place-items-center"><Plus size={16} /></button>
              </div>
              <span className="w-[76px] text-right font-semibold num">{formatMoney(r.base, { exact: r.base % 100 !== 0 })}</span>
            </li>
          ))}
        </ul>

        {canSeeCosts && calc.revenue > 0 && (
          <p className="hidden lg:block text-caption text-ink-2 num">{calc.knownCost ? <>About <b className="text-ink">{formatMoney(calc.profit)}</b> profit on this sale</> : "Profit unknown: some costs are missing"}</p>
        )}

        <div role="radiogroup" aria-label="How did they pay?" className="grid gap-1 p-1 rounded-[14px] bg-fill" style={{ gridTemplateColumns: `repeat(${methods.length + 1}, minmax(0, 1fr))` }}>
          {[...methods, "credit" as const].map((m) => (
            <button key={m} role="radio" aria-checked={method === m} onClick={() => { setMethod(m); setError(null); }}
              className={cn("h-10 rounded-[11px] text-caption transition-all", method === m ? "bg-surface font-semibold text-ink shadow-[0_1px_3px_rgba(17,19,24,0.14)]" : "text-ink-2 font-medium")}>
              {METHOD_LABEL[m]}
            </button>
          ))}
        </div>
        {method !== "credit" && accountsFor(method).length > 1 && (
          <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]" role="group" aria-label="Paid into">
            {accountsFor(method).map((a) => (
              <button key={a.id} onClick={() => setAccountPick({ ...accountPick, [method]: a.id })} aria-pressed={account === a.id}
                className={cn("h-8 px-3 rounded-full text-caption whitespace-nowrap", account === a.id ? "bg-accent-soft text-accent font-semibold" : "bg-fill text-ink-2")}>{a.name}</button>
            ))}
          </div>
        )}
        {method === "credit" && (
          <p className="text-caption text-ink-2">
            {customer.is_walk_in ? <>Tap <b>Walk-in</b> above to pick who owes you.</> : <>{customer.name} will owe <b className="num text-ink">{formatMoney(calc.total - paid)}</b>{paid > 0 ? <> after paying <span className="num">{formatMoney(paid)}</span> now</> : null}. Due in {customer.payment_terms_days ?? defaultTerms} days.</>}
          </p>
        )}

        {error && <p role="alert" className="text-caption text-negative flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</p>}

        <button onClick={() => charge()} disabled={pending || calc.rows.length === 0} key={bump}
          className={cn("press h-[58px] rounded-[18px] bg-accent text-on-accent text-headline font-semibold flex items-center justify-between px-5 disabled:opacity-50 shadow-[0_8px_20px_rgba(47,91,234,0.28)]", bump > 0 && "animate-bump")}>
          <span>{pending ? "Saving…" : method === "credit" ? "Save as owed" : "Charge"}</span>
          <span className="num text-[1.25rem] font-bold">{formatMoney(calc.total, { exact: calc.total % 100 !== 0 })}</span>
        </button>
      </section>

      {/* Customer picker */}
      <Sheet open={sheet === "customer"} onClose={() => setSheet((x) => (x === "customer" ? null : x))} title="Who is buying?">
        <CustomerPicker customers={customers} value={customerId} onPick={(id) => { setCustomerId(id); setSheet(null); setError(null); }} onNew={() => setSheet("newCustomer")} />
      </Sheet>
      <NewCustomerSheet open={sheet === "newCustomer"} onClose={() => setSheet((x) => (x === "newCustomer" ? null : x))}
        onCreated={(c) => { setCustomers([...customers, { ...c, is_walk_in: false, payment_terms_days: null, phone: null }]); setCustomerId(c.id); }} />

      {/* Options: date, discount, part payment */}
      <Sheet open={sheet === "options"} onClose={() => setSheet((x) => (x === "options" ? null : x))} title="Sale options" footer={<Button size="lg" className="w-full" onClick={() => setSheet(null)}>Done</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Date of sale" htmlFor="tdate"><Input id="tdate" type="date" value={date} max={opts.today} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Discount on the whole sale" htmlFor="tdisc" hint="Taken off the total."><MoneyInput id="tdisc" value={invDisc} onChange={setInvDisc} /></Field>
          <Field label="Paid now, if they'll owe the rest" htmlFor="tpart" hint="Used when you choose “Owes”."><MoneyInput id="tpart" value={partPaid} onChange={setPartPaid} /></Field>
        </div>
      </Sheet>

      {/* Edit one line */}
      {lineSheet && cart.has(lineSheet) && (
        <LineSheet name={byId.get(lineSheet)!.name} unit={byId.get(lineSheet)!.unit} line={cart.get(lineSheet)!} onClose={() => setSheet(null)}
          onSave={(l) => { setCart(new Map(cart).set(lineSheet, l)); setSheet(null); }}
          onRemove={() => { setQty(lineSheet, 0); setSheet(null); }} />
      )}

      <Sheet open={!!stockWarning} onClose={() => setStockWarning(null)} title="Not enough stock"
        footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={() => setStockWarning(null)}>Go back</Button><Button onClick={() => { setStockWarning(null); charge(true); }}>Sell anyway</Button></div>}>
        <p className="text-body">{stockWarning}</p>
        <p className="text-body text-ink-2 mt-2">You can still record it. Ledgr will fix the cost automatically when you record new stock.</p>
      </Sheet>

      {done && <SaleDone done={done} customers={customers} onNext={nextSale} />}
    </div>
  );
}

function CustomerPicker({ customers, value, onPick, onNew }: { customers: FormOptions["customers"]; value: string; onPick: (id: string) => void; onNew: () => void }) {
  const [q, setQ] = useState("");
  const list = customers.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="flex flex-col gap-3">
      <Input autoFocus placeholder="Search customers" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
      <button onClick={onNew} className="flex items-center gap-3 h-12 px-3 rounded-[12px] bg-accent-soft text-accent font-medium"><Plus size={18} />New customer</button>
      <ul className="flex flex-col max-h-[45dvh] overflow-y-auto">
        {list.map((c) => (
          <li key={c.id}>
            <button onClick={() => onPick(c.id)} className={cn("w-full flex items-center gap-3 h-12 px-3 rounded-[12px] text-left hover:bg-fill", c.id === value && "bg-fill font-semibold")}>
              <span className="size-8 rounded-full bg-fill grid place-items-center text-caption font-semibold text-ink-2">{c.is_walk_in ? <UserRound size={15} /> : c.name.charAt(0).toUpperCase()}</span>
              <span className="flex-1 truncate">{c.is_walk_in ? "Walk-in customer" : c.name}</span>
              {c.id === value && <span className="text-caption text-accent">Selected</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineSheet({ name, unit, line, onClose, onSave, onRemove }: { name: string; unit: string; line: Line; onClose: () => void; onSave: (l: Line) => void; onRemove: () => void }) {
  const [qty, setQty] = useState(line.qty);
  const [price, setPrice] = useState<number | null>(line.unit_price);
  const [disc, setDisc] = useState<number | null>(line.line_discount || null);
  return (
    <Sheet open onClose={onClose} title={name}
      footer={<div className="flex gap-2"><Button variant="destructive" onClick={onRemove}>Remove</Button><Button className="flex-1" onClick={() => onSave({ qty, unit_price: price ?? 0, line_discount: disc ?? 0 })} disabled={qty <= 0}>Save</Button></div>}>
      <div className="flex flex-col gap-4">
        <Field label={`Quantity${unit !== "unit" ? ` (${unit})` : ""}`}><QtyInput value={qty} onChange={setQty} unit={unit} /></Field>
        <Field label="Price each" htmlFor="lp"><MoneyInput id="lp" value={price} onChange={setPrice} /></Field>
        <Field label="Discount on this line" htmlFor="ld"><MoneyInput id="ld" value={disc} onChange={setDisc} /></Field>
      </div>
    </Sheet>
  );
}

function SaleDone({ done, customers, onNext }: { done: { id: string; total: number; method: Method; lines: { name: string; qty: number; amount: number }[]; customerId: string; paid: number }; customers: FormOptions["customers"]; onNext: () => void }) {
  const [info, setInfo] = useState<Awaited<ReturnType<typeof saleReceiptInfo>> | undefined>(undefined);
  const c = customers.find((x) => x.id === done.customerId);
  useEffect(() => { saleReceiptInfo(done.id).then(setInfo).catch(() => setInfo(null)); }, [done.id]);
  const how = done.method === "credit" ? (done.paid > 0 ? `${formatMoney(done.paid)} paid, ${formatMoney(done.total - done.paid)} to pay later` : "To pay later") : `Paid by ${METHOD_LABEL[done.method].toLowerCase()}`;
  const text = [
    `*${info?.business ?? "Receipt"}*${info?.invoice_no ? ` · ${info.invoice_no}` : ""}`,
    "",
    ...done.lines.map((l) => `${formatQty(l.qty)} × ${l.name} — ${formatMoney(l.amount, { exact: l.amount % 100 !== 0 })}`),
    "",
    `*Total: ${formatMoney(done.total, { exact: done.total % 100 !== 0 })}*`,
    how + ".",
    "Thank you!",
  ].join("\n");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="done-title">
      <div className="absolute inset-0 bg-black/35 animate-[fade-in_150ms]" aria-hidden />
      <div className="relative bg-raised w-full sm:w-[420px] rounded-t-[28px] sm:rounded-[28px] px-6 pt-8 pb-[calc(24px+env(safe-area-inset-bottom))] flex flex-col items-center text-center gap-2 shadow-[var(--shadow-sheet)] animate-[sheet-in_260ms_var(--ease-apple)]">
        <span className="size-[72px] rounded-full bg-positive-soft text-positive grid place-items-center animate-pop animate-ring">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path className="animate-draw" d="M5 12.5 10 17l9-10" /></svg>
        </span>
        <h2 id="done-title" className="text-title font-bold font-display mt-2">Sale saved</h2>
        <p className="text-[2rem] font-bold num tracking-tight">{formatMoney(done.total, { exact: done.total % 100 !== 0 })}</p>
        <p className="text-body text-ink-2">{how}. Stock updated.</p>
        <div className="grid grid-cols-2 gap-2.5 w-full mt-5">
          <a href={whatsappLink(text, c?.is_walk_in ? null : (info?.phone ?? c?.phone))} target="_blank" rel="noreferrer"
            className="press h-[52px] rounded-[16px] bg-[#e7f7ec] dark:bg-positive-soft text-[#146c3a] dark:text-positive font-semibold flex items-center justify-center gap-2">
            <MessageCircle size={18} />WhatsApp receipt
          </a>
          <button onClick={onNext} autoFocus className="press h-[52px] rounded-[16px] bg-accent text-on-accent font-semibold">Next sale</button>
        </div>
        <Link href={`/sales/${done.id}`} className="tap text-caption text-accent font-medium mt-2">View full receipt<ChevronRight size={14} /></Link>
      </div>
    </div>
  );
}
