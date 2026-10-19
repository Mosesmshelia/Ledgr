"use client";
// Shopping list: what's running low, how much to get, and one tap to send it to a supplier on WhatsApp.
// Ticks and quantity changes are kept on this device only (they're a working list, not records).
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, FlaskConical, MessageCircle, Plus, RotateCcw, ShoppingBasket, Truck, X } from "lucide-react";
import { Card, EmptyState, PageHeader, cn } from "@/components/ui/primitives";
import { InventoryTabs } from "../inventory/tabs";
import { QtyInput } from "@/components/ui/inputs";
import { formatMoney, formatQty } from "@/lib/finance/money";
import { whatsappLink } from "@/lib/whatsapp";

export interface ShopItem {
  id: string; name: string; unit: string; onHand: number; minStock: number; suggest: number; make: boolean;
  supplierId: string | null; supplier: string | null; supplierPhone: string | null; lastCost: number | null;
}
interface Saved { qty: Record<string, number>; done: string[]; skip: string[]; extra: { id: string; name: string }[] }
const EMPTY: Saved = { qty: {}, done: [], skip: [], extra: [] };

export function ShoppingList({ businessId, businessName, items, suppliers, canRecord }: {
  businessId: string; businessName: string; items: ShopItem[]; suppliers: { id: string; name: string; phone: string | null }[]; canRecord: boolean;
}) {
  const key = `ledgr.shopping.${businessId}`;
  const [s, setS] = useState<Saved>(EMPTY);
  const [extra, setExtra] = useState("");
  useEffect(() => {
    try { const raw = localStorage.getItem(key); if (raw) setS({ ...EMPTY, ...JSON.parse(raw) }); } catch { /* private mode: start fresh */ }
  }, [key]);
  const save = (next: Saved) => { setS(next); try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* ignore */ } };

  const toBuy = items.filter((i) => !i.make && !s.skip.includes(i.id));
  const toMake = items.filter((i) => i.make && !s.skip.includes(i.id));
  const qtyOf = (i: ShopItem) => s.qty[i.id] ?? i.suggest;
  const open = toBuy.filter((i) => !s.done.includes(i.id));
  const estimate = open.reduce((a, i) => a + (i.lastCost !== null ? Math.round(i.lastCost * qtyOf(i)) : 0), 0);
  const unknown = open.some((i) => i.lastCost === null);

  // Group what's still to buy by the supplier it last came from, so each can get their own message.
  const groups = useMemo(() => {
    const m = new Map<string, { name: string; phone: string | null; items: ShopItem[] }>();
    for (const i of open) {
      const k = i.supplierId ?? "none";
      if (!m.has(k)) m.set(k, { name: i.supplier ?? "Any supplier", phone: i.supplierPhone, items: [] });
      m.get(k)!.items.push(i);
    }
    return [...m.entries()];
  }, [open]);

  const lineText = (i: ShopItem) => `• ${i.name}: ${formatQty(qtyOf(i))}${i.unit !== "unit" ? ` ${i.unit}` : ""}`;
  const message = (list: ShopItem[], to?: string) => [
    `Hello${to && to !== "Any supplier" ? ` ${to}` : ""}, this is ${businessName}. Please can I get:`, "",
    ...list.map(lineText), ...(to ? [] : s.extra.map((e) => `• ${e.name}`)), "", "Thank you!",
  ].join("\n");
  const allText = [`*${businessName} — shopping list*`, "", ...open.map(lineText), ...s.extra.map((e) => `• ${e.name}`)].join("\n");

  const toggle = (id: string) => save({ ...s, done: s.done.includes(id) ? s.done.filter((x) => x !== id) : [...s.done, id] });
  const nothing = toBuy.length === 0 && toMake.length === 0 && s.extra.length === 0;

  return (
    <div className="animate-rise max-w-3xl">
      <PageHeader title="Stock" subtitle="Built from what's running low. Change any amount, tick things off as you buy them." />
      <InventoryTabs active="shopping" />

      {nothing ? (
        <Card><EmptyState icon={<ShoppingBasket size={24} />} title="Nothing to buy right now" body="Everything is above its warning level. Set a “Warn me below” level on a product to have it appear here when it runs low." /></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {open.length > 0 && (
            <Card className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div>
                <div className="text-caption text-ink-2">{open.length} thing{open.length === 1 ? "" : "s"} to buy</div>
                {estimate > 0 && <div className="text-title font-bold num">About {formatMoney(estimate)}</div>}
                {estimate > 0 && unknown && <div className="text-caption text-ink-3">plus items with no past price</div>}
              </div>
              <a href={whatsappLink(allText)} target="_blank" rel="noreferrer" className="press h-12 px-5 rounded-[14px] bg-[#e7f7ec] dark:bg-positive-soft text-[#146c3a] dark:text-positive font-semibold flex items-center justify-center gap-2">
                <MessageCircle size={18} />Share list on WhatsApp
              </a>
            </Card>
          )}

          {toBuy.length > 0 && (
            <Card className="overflow-hidden">
              <h2 className="text-headline font-semibold px-5 pt-4 pb-2 flex items-center gap-2"><Truck size={18} className="text-accent" />To buy</h2>
              <ul className="stagger">
                {toBuy.map((i) => {
                  const done = s.done.includes(i.id);
                  return (
                    <li key={i.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_150px_auto] items-center gap-x-3 gap-y-2 px-5 py-3.5 border-t border-hairline">
                      <button onClick={() => toggle(i.id)} role="checkbox" aria-checked={done} aria-label={`Bought ${i.name}`}
                        className="press size-11 -m-2 grid place-items-center shrink-0">
                        <span className={cn("size-7 rounded-full border-2 grid place-items-center transition-colors", done ? "bg-positive border-positive text-white" : "border-hairline-strong")}>
                          {done && <Check size={15} strokeWidth={3} className="animate-pop" />}
                        </span>
                      </button>
                      <div className={cn("min-w-0", done && "opacity-50")}>
                        <div className={cn("text-body font-medium", done && "line-through")}>{i.name}</div>
                        <div className="text-caption text-ink-2 num">
                          <span className={i.onHand <= 0 ? "text-negative" : "text-warning"}>{i.onHand <= 0 ? "Out of stock" : `${formatQty(i.onHand, i.unit)} left`}</span>
                          {i.supplier && <> · from {i.supplier}</>}
                          {i.lastCost !== null && <> · {formatMoney(i.lastCost, { exact: i.lastCost < 10_000 })} each last time</>}
                        </div>
                      </div>
                      <div className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1 max-w-[180px]"><QtyInput value={qtyOf(i)} onChange={(n) => save({ ...s, qty: { ...s.qty, [i.id]: n } })} unit={i.unit} /></div>
                      <button onClick={() => save({ ...s, skip: [...s.skip, i.id] })} aria-label={`Remove ${i.name} from the list`} className="col-start-3 row-start-1 sm:col-start-4 size-11 grid place-items-center rounded-full text-ink-3 hover:bg-fill"><X size={16} /></button>
                    </li>
                  );
                })}
              </ul>
              {groups.some(([k, g]) => k !== "none" && g.items.length > 0) && (
                <div className="px-5 py-4 border-t border-hairline bg-surface-2 flex flex-wrap gap-2">
                  {groups.filter(([k]) => k !== "none").map(([k, g]) => (
                    <a key={k} href={whatsappLink(message(g.items, g.name), g.phone)} target="_blank" rel="noreferrer"
                      className="press h-11 px-4 rounded-full bg-surface border border-hairline text-caption font-semibold flex items-center gap-1.5">
                      <MessageCircle size={15} className="text-positive" />Send {g.items.length} to {g.name}{!g.phone && <span className="text-ink-3 font-normal"> (no number)</span>}
                    </a>
                  ))}
                </div>
              )}
            </Card>
          )}

          {toMake.length > 0 && (
            <Card className="overflow-hidden">
              <h2 className="text-headline font-semibold px-5 pt-4 pb-2 flex items-center gap-2"><FlaskConical size={18} className="text-accent" />To make</h2>
              <ul>
                {toMake.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-3 border-t border-hairline">
                    <div className="flex-1 min-w-0">
                      <div className="text-body font-medium truncate">{i.name}</div>
                      <div className="text-caption num"><span className={i.onHand <= 0 ? "text-negative" : "text-warning"}>{i.onHand <= 0 ? "Sold out" : `${formatQty(i.onHand, i.unit)} left`}</span></div>
                    </div>
                    {canRecord && <Link href={`/inventory/production/new?product=${i.id}`} className="press h-11 px-4 rounded-full bg-accent-soft text-accent text-caption font-semibold flex items-center gap-1.5"><FlaskConical size={15} />Make a batch</Link>}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <h2 className="text-headline font-semibold mb-3">Anything else?</h2>
            {s.extra.length > 0 && (
              <ul className="flex flex-col gap-1 mb-3">
                {s.extra.map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-body">
                    <span className="flex-1">• {e.name}</span>
                    <button onClick={() => save({ ...s, extra: s.extra.filter((x) => x.id !== e.id) })} aria-label={`Remove ${e.name}`} className="size-11 grid place-items-center rounded-full text-ink-3 hover:bg-fill"><X size={16} /></button>
                  </li>
                ))}
              </ul>
            )}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (!extra.trim()) return; save({ ...s, extra: [...s.extra, { id: String(Date.now()), name: extra.trim() }] }); setExtra(""); }}>
              <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="e.g. Ice, 2 bags" aria-label="Add something else to the list"
                className="h-12 flex-1 rounded-[12px] bg-fill px-3 text-body outline-none border border-transparent focus:border-accent focus:bg-surface" />
              <button className="press h-12 px-4 rounded-[12px] bg-accent text-on-accent font-semibold flex items-center gap-1.5"><Plus size={17} />Add</button>
            </form>
          </Card>

          {(s.done.length > 0 || s.skip.length > 0 || Object.keys(s.qty).length > 0) && (
            <button onClick={() => save({ ...EMPTY, extra: s.extra })} className="self-center tap text-caption text-ink-2 font-medium flex items-center gap-1.5"><RotateCcw size={14} />Start the list fresh</button>
          )}
          {suppliers.length === 0 && <p className="text-caption text-ink-3 text-center">Tip: add your suppliers&apos; phone numbers and record purchases from them, and each one gets a “Send” button here.</p>}
        </div>
      )}
    </div>
  );
}
