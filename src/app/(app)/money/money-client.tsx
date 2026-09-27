"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Banknote, Plus } from "lucide-react";
import { recordCashMovement, recordPayment, saveCashAccount, transferCash } from "@/app/actions/ledger";
import { Button, Field, Input, Select } from "@/components/ui/primitives";
import { Chips, Combobox, MoneyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { formatMoney } from "@/lib/finance/money";

type Acc = { id: string; name: string; type?: string };

const MOVES = [
  { value: "transfer", label: "Move between my accounts", hint: "Not income or expense" },
  { value: "capital_injection", label: "Money I put into the business", hint: "Not revenue" },
  { value: "owner_withdrawal", label: "Money I took out for myself", hint: "Not an expense" },
  { value: "loan_received", label: "Loan received", hint: "Not revenue" },
  { value: "loan_repayment", label: "Loan repayment (principal)", hint: "Record interest as an expense" },
  { value: "other_income", label: "Other income", hint: "e.g. interest, a refund you received" },
  { value: "tax_payment", label: "Tax payment", hint: "VAT or tax paid to the government" },
] as const;

export function MoveMoneyButton({ accounts, today }: { accounts: Acc[]; today: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<(typeof MOVES)[number]["value"]>("transfer");
  const [from, setFrom] = useState(accounts[0]?.id);
  const [to, setTo] = useState(accounts[1]?.id ?? accounts[0]?.id);
  const [amount, setAmount] = useState<number | null>(null);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const inflow = ["capital_injection", "loan_received", "other_income"].includes(kind);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}><ArrowLeftRight size={16} />Move money</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Record money in or out"
        footer={<Button size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
          if (!amount) return setErr("Enter an amount.");
          const r = kind === "transfer"
            ? await transferCash({ from_account_id: from!, to_account_id: to!, date, amount, description: note || undefined })
            : await recordCashMovement({ kind, account_id: from!, date, amount, description: note || undefined });
          if (!r.ok) return setErr(r.error);
          setOpen(false); setAmount(null); setNote(""); router.refresh();
        })}>{pending ? "Saving…" : "Save"}</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="What happened?" htmlFor="mk" hint={MOVES.find((m) => m.value === kind)?.hint}>
            <Select id="mk" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>{MOVES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</Select>
          </Field>
          <Field label="Amount"><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label={kind === "transfer" ? "From" : inflow ? "Into" : "From"}><Chips label="Account" value={from ?? null} onChange={setFrom} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          {kind === "transfer" && <Field label="To"><Chips label="To account" value={to ?? null} onChange={setTo} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date" htmlFor="md"><Input id="md" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Note (optional)" htmlFor="mn"><Input id="mn" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}

export function CustomerPaymentTrigger({ open: initial, customers, accounts, today }: { open: boolean; customers: { id: string; name: string; owed: number }[]; accounts: Acc[]; today: string }) {
  const [open, setOpen] = useState(initial);
  const [customer, setCustomer] = useState<string | null>(customers.find((c) => c.owed > 0)?.id ?? null);
  const [amount, setAmount] = useState<number | null>(null);
  const [account, setAccount] = useState(accounts.find((a) => a.type === "bank")?.id ?? accounts[0]?.id);
  const [date, setDate] = useState(today);
  const [credit, setCredit] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const owed = customers.find((c) => c.id === customer)?.owed ?? 0;
  return (
    <>
      <Button onClick={() => setOpen(true)}><Banknote size={16} />Record payment</Button>
      <Sheet open={open} onClose={() => { setOpen(false); if (initial) router.replace("/money"); }} title="Customer payment" subtitle="Money a customer paid towards what they owe."
        footer={<Button size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
          if (!customer || !amount || !account) return setErr("Choose the customer, amount and account.");
          const r = await recordPayment({ party: "customer", party_id: customer, account_id: account, date, amount, allow_credit: credit });
          if (!r.ok) return setErr(r.error);
          setOpen(false); setAmount(null); router.refresh();
        })}>{pending ? "Saving…" : "Save payment"}</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Customer">
            <Combobox value={customer} onChange={(v) => { setCustomer(v); setAmount(customers.find((c) => c.id === v)?.owed || null); }}
              options={customers.map((c) => ({ value: c.id, label: c.name, hint: c.owed > 0 ? `Owes ${formatMoney(c.owed)}` : "Owes nothing" }))} placeholder="Choose customer" />
          </Field>
          <Field label="Amount received" hint={owed > 0 ? `They owe ${formatMoney(owed, { exact: true })}. Oldest invoices are settled first.` : undefined}><MoneyInput value={amount} onChange={setAmount} /></Field>
          <Field label="Paid into"><Chips label="Account" value={account ?? null} onChange={setAccount} options={accounts.map((a) => ({ value: a.id, label: a.name }))} /></Field>
          <Field label="Date" htmlFor="cpd"><Input id="cpd" type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></Field>
          {amount !== null && amount > owed && (
            <label className="flex items-center gap-2 text-body"><input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} className="size-4 accent-[var(--accent)]" />Keep the extra {formatMoney(amount - owed)} as credit for this customer</label>
          )}
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}

export function AddAccountButton() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"cash" | "bank" | "pos" | "mobile_money" | "other">("bank");
  const [opening, setOpening] = useState<number | null>(0);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-[16px] border border-dashed border-hairline-strong p-5 text-body text-ink-2 hover:text-ink hover:bg-surface flex items-center justify-center gap-2 min-h-[104px]"><Plus size={17} />Add account</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add account"
        footer={<Button size="lg" className="w-full" disabled={pending} onClick={() => start(async () => {
          const r = await saveCashAccount({ name, type, opening_balance: opening ?? 0, opening_date: new Date().toISOString().slice(0, 10) });
          if (!r.ok) return setErr(r.error);
          setOpen(false); router.refresh();
        })}>{pending ? "Saving…" : "Add account"}</Button>}>
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="an"><Input id="an" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Access Bank" autoFocus /></Field>
          <Field label="Type"><Chips label="Type" value={type} onChange={setType} options={[{ value: "cash", label: "Cash" }, { value: "bank", label: "Bank" }, { value: "pos", label: "POS" }, { value: "mobile_money", label: "Mobile money" }]} /></Field>
          <Field label="Balance today"><MoneyInput value={opening} onChange={setOpening} /></Field>
          {err && <p role="alert" className="text-caption text-negative">{err}</p>}
        </div>
      </Sheet>
    </>
  );
}
