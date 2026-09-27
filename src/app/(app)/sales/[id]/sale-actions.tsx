"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, RotateCcw, Ban, Banknote } from "lucide-react";
import { recordPayment, postReturn, voidDocument, setMissingCost } from "@/app/actions/ledger";
import { Button, Field, Input, Textarea, cn } from "@/components/ui/primitives";
import { Chips, MoneyInput, QtyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney, formatQty, allocate } from "@/lib/finance/money";

interface SaleInfo { id: string; customer_id: string; outstanding: number; paid: number; total: number; date: string; is_walk_in: boolean; invoice_no: string }
interface Item { id: string; name: string; qty: number; returnable: number; unit: string; net_amount: number; vat_amount: number }
type Acc = { id: string; name: string; type: string };

/** Small "Void" link that opens the void sheet — for history rows (returns, payments, cash, adjustments). */
export function VoidInline({ id, type, effect, label = "Void" }: { id: string; type: "sale" | "purchase" | "expense" | "return" | "cash" | "production"; effect: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="tap text-caption text-ink-2 hover:text-negative print:hidden">{label}</button>
      <VoidSheet open={open} onClose={() => setOpen(false)} id={id} type={type} effect={effect} />
    </>
  );
}

export function SaleActions({ sale, items, accounts, today, hasReturns, canVoid, canCollect = true }: { sale: SaleInfo; items: Item[]; accounts: Acc[]; today: string; hasReturns: boolean; canVoid: boolean; canCollect?: boolean }) {
  const [sheet, setSheet] = useState<null | "pay" | "return" | "void">(null);
  const [menu, setMenu] = useState(false);
  return (
    <div className="flex gap-2 relative">
      {sale.outstanding > 0 && canCollect && <Button onClick={() => setSheet("pay")}><Banknote size={16} />Record payment</Button>}
      {canVoid && (
        <>
          <Button variant="secondary" onClick={() => setMenu(!menu)} aria-label="More actions" aria-expanded={menu}><MoreHorizontal size={18} /></Button>
          {menu && (
            <div className="absolute right-0 top-12 z-20 w-56 bg-raised border border-hairline rounded-[12px] shadow-[var(--shadow-sheet)] p-1 animate-[rise_140ms_var(--ease-apple)]" onMouseLeave={() => setMenu(false)}>
              {items.some((i) => i.returnable > 0) && <MenuItem icon={<RotateCcw size={16} />} label="Return items" onClick={() => { setMenu(false); setSheet("return"); }} />}
              <MenuItem icon={<Ban size={16} />} label="Void sale" danger onClick={() => { setMenu(false); setSheet("void"); }} />
            </div>
          )}
        </>
      )}
      <PaymentSheet open={sheet === "pay"} onClose={() => setSheet(null)} sale={sale} accounts={accounts} today={today} />
      <ReturnSheet open={sheet === "return"} onClose={() => setSheet(null)} sale={sale} items={items} accounts={accounts} today={today} />
      <VoidSheet open={sheet === "void"} onClose={() => setSheet(null)} id={sale.id} type="sale" blocked={hasReturns ? "This sale has returns. Void the returns first." : null}
        effect={`This removes ${formatMoney(sale.total, { exact: true })} from your revenue, puts the items back in stock and cancels payments recorded with the sale.`} />
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("w-full flex items-center gap-2.5 h-10 px-3 rounded-[8px] text-body hover:bg-fill", danger && "text-negative")}>{icon}{label}</button>
  );
}

function PaymentSheet({ open, onClose, sale, accounts, today }: { open: boolean; onClose: () => void; sale: SaleInfo; accounts: Acc[]; today: string }) {
  const [amount, setAmount] = useState<number | null>(sale.outstanding);
  const [account, setAccount] = useState(accounts.find((a) => a.type === "bank")?.id ?? accounts[0]?.id);
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Sheet open={open} onClose={onClose} title="Record payment" subtitle={`${sale.invoice_no} · ${formatMoney(sale.outstanding, { exact: true })} left to pay`}
      footer={<Button size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
        if (!amount || !account) return setErr("Enter the amount and choose an account.");
        const r = await recordPayment({ party: "customer", party_id: sale.customer_id, account_id: account, date, amount, allocations: [{ target_id: sale.id, amount }] });
        if (!r.ok) return setErr(r.error);
        onClose(); router.refresh();
      })}>{pending ? "Saving…" : "Save payment"}</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Amount received"><MoneyInput value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="Paid into"><Chips label="Account" value={account ?? null} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
        <Field label="Date" htmlFor="pd"><Input id="pd" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
        {err && <p role="alert" className="text-caption text-negative">{err}</p>}
      </div>
    </Sheet>
  );
}

function ReturnSheet({ open, onClose, sale, items, accounts, today }: { open: boolean; onClose: () => void; sale: SaleInfo; items: Item[]; accounts: Acc[]; today: string }) {
  const [qty, setQty] = useState<Record<string, number>>({});
  const [restock, setRestock] = useState<"yes" | "no">("yes");
  const [method, setMethod] = useState<"credit" | "cash">(sale.outstanding > 0 ? "credit" : "cash");
  const [account, setAccount] = useState(accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const value = items.reduce((a, i) => {
    const q = qty[i.id] ?? 0;
    if (!q) return a;
    const share = allocate(i.net_amount + i.vat_amount, [q, i.qty - q])[0];
    return a + share;
  }, 0);
  return (
    <Sheet open={open} onClose={onClose} title="Return items" subtitle={sale.invoice_no}
      footer={<Button size="lg" className="w-full" disabled={pending || value === 0} onClick={() => start(async () => {
        const r = await postReturn({ sale_id: sale.id, date: today, reason, restock: restock === "yes", refund_method: method, account_id: method === "cash" ? account : undefined,
          items: Object.entries(qty).map(([sale_item_id, q]) => ({ sale_item_id, qty: q })) });
        if (!r.ok) return setErr(r.error);
        onClose(); router.refresh();
      })}>{pending ? "Saving…" : `Return ${formatMoney(value)}`}</Button>}>
      <div className="flex flex-col gap-4">
        {items.filter((i) => i.returnable > 0).map((i) => (
          <div key={i.id} className="flex items-center gap-3">
            <div className="flex-1 min-w-0"><div className="text-body truncate">{i.name}</div><div className="text-caption text-ink-2">Up to {formatQty(i.returnable, i.unit)}</div></div>
            <QtyInput className="w-36" value={qty[i.id] ?? 0} onChange={(q) => setQty({ ...qty, [i.id]: Math.min(q, i.returnable) })} />
          </div>
        ))}
        <Field label="Can the items be sold again?"><Chips label="Restock" value={restock} onChange={setRestock} options={[{ value: "yes", label: "Yes, back to stock" }, { value: "no", label: "No, damaged or expired" }]} /></Field>
        <Field label="How is the customer refunded?">
          <Chips label="Refund" value={method} onChange={setMethod} options={[{ value: "credit", label: "Reduce what they owe" }, { value: "cash", label: "Give money back" }]} />
        </Field>
        {method === "cash" && <Field label="Refund from"><Chips label="Account" value={account ?? null} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>}
        <Field label="Reason (optional)" htmlFor="rr"><Input id="rr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Past best-before date" /></Field>
        {err && <p role="alert" className="text-caption text-negative">{err}</p>}
      </div>
    </Sheet>
  );
}

export function VoidSheet({ open, onClose, id, type, effect, blocked }: { open: boolean; onClose: () => void; id: string; type: "sale" | "purchase" | "expense" | "return" | "cash" | "production"; effect: string; blocked?: string | null }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const noun = { sale: "sale", purchase: "purchase", expense: "expense", return: "return", cash: "transaction", production: "batch" }[type];
  return (
    <Sheet open={open} onClose={onClose} title={`Void ${noun}?`}
      footer={<div className="flex gap-2 justify-end"><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={pending || !!blocked || reason.trim().length < 3} onClick={() => start(async () => {
          const r = await voidDocument({ type, id, reason });
          if (!r.ok) return setErr(r.error);
          onClose(); router.refresh();
        })}>{pending ? "Voiding…" : `Void ${noun}`}</Button></div>}>
      {blocked ? <p className="text-body">{blocked}</p> : (
        <div className="flex flex-col gap-4">
          <p className="text-body">{effect}</p>
          <p className="text-caption text-ink-2">Nothing is deleted. The {noun} stays in your records, marked as voided, with your reason.</p>
          <Field label="Reason" htmlFor="vr"><Textarea id="vr" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice by mistake" autoFocus /></Field>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      )}
    </Sheet>
  );
}

export function FixCostButton({ itemId, name, qty }: { itemId: string; name: string; qty: number }) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="text-accent font-medium ml-1">Add cost</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add missing cost" subtitle={name}
        footer={<Button size="lg" className="w-full" disabled={pending || cost === null} onClick={() => start(async () => {
          const r = await setMissingCost({ sale_item_id: itemId, unit_cost: cost! });
          if (!r.ok) return setErr(r.error);
          setOpen(false); router.refresh();
        })}>{pending ? "Saving…" : "Save cost"}</Button>}>
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink-2">{formatQty(qty)} unit{qty === 1 ? " was" : "s were"} sold without a recorded cost. What did each one cost you to buy or make?</p>
          <Field label="Cost per unit"><MoneyInput value={cost} onChange={setCost} autoFocus /></Field>
          <p className="text-caption text-ink-3">If you record a purchase of this product later, Ledgr replaces this with the real cost automatically.</p>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}
