"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Plus } from "lucide-react";
import { createExpense, recordRecurringPayment, saveRecurringExpense } from "@/app/actions/ledger";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { Chips, MoneyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { VoidSheet } from "@/app/(app)/sales/[id]/sale-actions";
import { equivalents, formatMoney } from "@/lib/finance";

type Cat = { id: string; name: string; kind: string };
type Acc = { id: string; name: string; type: string };
const QUICK = ["Generator & fuel", "Transport", "Logistics & delivery", "Marketing", "Repairs & maintenance", "Office supplies"];

export function AddExpenseTrigger({ open: initial, categories, accounts, today }: { open: boolean; categories: Cat[]; accounts: Acc[]; today: string }) {
  const [open, setOpen] = useState(initial);
  const router = useRouter();
  const [cat, setCat] = useState<string | null>(null);
  const [amount, setAmount] = useState<number | null>(null);
  const [account, setAccount] = useState(accounts.find((a) => a.type === "cash")?.id ?? accounts[0]?.id);
  const [name, setName] = useState("");
  const [vendor, setVendor] = useState("");
  const [date, setDate] = useState(today);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const quick = QUICK.map((n) => categories.find((c) => c.name === n)).filter(Boolean) as Cat[];
  const close = () => { setOpen(false); if (initial) router.replace("/expenses"); };
  const save = () => start(async () => {
    if (!cat) return setErr("Choose a category.");
    if (!amount) return setErr("Expense amount must be greater than ₦0.");
    if (!account) return setErr("Choose where the money came from.");
    const r = await createExpense({ date, category_id: cat, amount, account_id: account, name: name || undefined, vendor: vendor || undefined });
    if (!r.ok) return setErr(r.error);
    setAmount(null); setName(""); setVendor(""); setCat(null); setErr(null); close(); router.refresh();
  });
  return (
    <>
      <Button onClick={() => setOpen(true)}><Plus size={16} />Add expense</Button>
      <Sheet open={open} onClose={close} title="Add expense"
        footer={<Button size="lg" className="w-full" onClick={save} disabled={pending}>{pending ? "Saving…" : amount ? `Save ${formatMoney(amount)}` : "Save expense"}</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="What was it for?">
            <div className="flex flex-col gap-2">
              <Chips label="Category" value={cat} onChange={(v) => (v === "__more" ? setMore(true) : setCat(v))} options={[...quick.map((c) => ({ value: c.id, label: c.name })), ...(more ? [] : [{ value: "__more", label: "Other…" }])]} />
              {(more || (cat && !quick.some((q) => q.id === cat))) && (
                <Select value={cat ?? ""} onChange={(e) => setCat(e.target.value)} aria-label="All categories">
                  <option value="" disabled>All categories</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              )}
            </div>
          </Field>
          <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} autoFocus={false} /></Field>
          <Field label="Paid from"><Chips label="Account" value={account ?? null} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Description (optional)" htmlFor="en"><Input id="en" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diesel 50L" /></Field>
            <Field label="Date" htmlFor="ed"><Input id="ed" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <Field label="Paid to (optional)" htmlFor="ev"><Input id="ev" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor or person" /></Field>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}

export function ExpenseRowMenu({ id, amount }: { id: string; amount: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:bg-fill hover:text-ink" aria-label="Void expense"><MoreHorizontal size={16} /></button>
      <VoidSheet open={open} onClose={() => setOpen(false)} id={id} type="expense" effect={`This removes ${formatMoney(amount, { exact: true })} from your expenses and puts the money back in the account it came from.`} />
    </>
  );
}

export function AddRecurringButton({ categories, accounts, today }: { categories: Cat[]; accounts: Acc[]; today: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [name, setName] = useState("");
  const [cat, setCat] = useState(categories.find((c) => c.name === "Rent")?.id ?? "");
  const [amount, setAmount] = useState<number | null>(null);
  const [freq, setFreq] = useState<"daily" | "weekly" | "monthly" | "quarterly" | "annual" | null>(null);
  const [start, setStart] = useState(today.slice(0, 8) + "01");
  const [account, setAccount] = useState<string | null>(accounts[0]?.id ?? null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, startT] = useTransition();
  const eq = amount && freq ? equivalents({ amount, frequency: freq }) : null;
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}><Plus size={15} />Add recurring</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add recurring expense"
        footer={<Button size="lg" className="w-full" disabled={pending} onClick={() => startT(async () => {
          if (!freq) return setErr("Choose how often you pay it.");
          const r = await saveRecurringExpense({ name, category_id: cat, amount: amount ?? 0, frequency: freq, start_date: start, cash_account_id: account });
          if (!r.ok) return setErr(r.error);
          setOpen(false); router.refresh();
        })}>{pending ? "Saving…" : "Add recurring expense"}</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="rn"><Input id="rn" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Shop rent" autoFocus /></Field>
          <Field label="Category" htmlFor="rc"><Select id="rc" value={cat} onChange={(e) => setCat(e.target.value)}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="How often?">
            <Chips label="Frequency" value={freq} onChange={setFreq} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "quarterly", label: "Quarterly" }, { value: "annual", label: "Yearly" }]} />
          </Field>
          {eq && <p className="text-caption text-ink-2 num -mt-2">That&apos;s about <span className="text-ink font-medium">{formatMoney(eq.monthly)}</span> a month, or <span className="text-ink font-medium">{formatMoney(eq.weekly)}</span> a week.</p>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts" htmlFor="rs"><Input id="rs" type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field label="Usually paid from" htmlFor="ra"><Select id="ra" value={account ?? ""} onChange={(e) => setAccount(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          </div>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}

export function RecurringActions({ r, accounts, today }: { r: { id: string; name: string; amount: number; owed: number }; accounts: Acc[]; today: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(r.owed > 0 ? r.owed : r.amount);
  const [account, setAccount] = useState(accounts[0]?.id);
  const [date, setDate] = useState(today);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>Record payment</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Pay ${r.name}`} subtitle="This records the money leaving your account. It doesn't add a second expense."
        footer={<Button size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
          if (!amount || !account) return setErr("Enter the amount and choose an account.");
          const res = await recordRecurringPayment({ recurring_expense_id: r.id, account_id: account, date, amount });
          if (!res.ok) return setErr(res.error);
          setOpen(false); router.refresh();
        })}>{pending ? "Saving…" : "Save payment"}</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Amount paid"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Paid from"><Chips label="Account" value={account ?? null} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <Field label="Date" htmlFor="rpd"><Input id="rpd" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}
