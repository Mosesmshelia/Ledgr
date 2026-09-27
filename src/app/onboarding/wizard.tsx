"use client";
import { useState, useTransition } from "react";
import { Check, ChevronLeft, Plus, Trash2 } from "lucide-react";
import { completeOnboarding } from "@/app/actions/onboarding";
import { Button, Field, Input, Select, cn } from "@/components/ui/primitives";
import { Chips, MoneyInput } from "@/components/ui/inputs";
import { equivalents, formatMoney } from "@/lib/finance";

type Freq = "daily" | "weekly" | "monthly" | "quarterly" | "annual";
const STEPS = ["Business", "Money", "Expenses", "Products", "Targets"];
const COMMON: { name: string; category: string; frequency: Freq }[] = [
  { name: "Shop rent", category: "Rent", frequency: "annual" },
  { name: "Staff salaries", category: "Salaries", frequency: "monthly" },
  { name: "Generator diesel", category: "Generator & fuel", frequency: "weekly" },
  { name: "Electricity", category: "Electricity", frequency: "monthly" },
  { name: "Internet", category: "Internet", frequency: "monthly" },
  { name: "Security", category: "Security", frequency: "monthly" },
];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function Wizard({ today, ownerName }: { today: string; ownerName: string }) {
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [biz, setBiz] = useState({ name: "", business_type: "", owner_name: ownerName, phone: "", fy_start_month: 1, vat_registered: false });
  const [accounts, setAccounts] = useState([
    { name: "Cash", type: "cash" as const, opening_balance: 0 as number | null },
    { name: "Bank", type: "bank" as const, opening_balance: 0 as number | null },
  ] as { name: string; type: "cash" | "bank" | "pos" | "mobile_money" | "other"; opening_balance: number | null }[]);
  const [recurring, setRecurring] = useState(COMMON.map((c) => ({ ...c, amount: null as number | null, on: false })));
  const [products, setProducts] = useState([{ name: "", selling_price: null as number | null, unit_cost: null as number | null, qty: "" }]);
  const [targets, setTargets] = useState({ weekly_sales: null as number | null, monthly_sales: null as number | null, monthly_profit: null as number | null });

  const next = () => {
    setErr(null);
    if (step === 0 && !biz.name.trim()) return setErr("Enter your business name.");
    if (step < STEPS.length - 1) setStep(step + 1);
    else finish();
  };
  const finish = () => start(async () => {
    const r = await completeOnboarding({
      business: biz,
      accounts: accounts.filter((a) => a.name.trim()).map((a) => ({ ...a, opening_balance: a.opening_balance ?? 0 })),
      recurring: recurring.filter((r) => r.on && r.amount).map((r) => ({ name: r.name, category: r.category, amount: r.amount!, frequency: r.frequency })),
      products: products.filter((p) => p.name.trim()).map((p) => ({ name: p.name, selling_price: p.selling_price, unit_cost: p.unit_cost, qty: Number(p.qty) || 0 })),
      targets, today,
    });
    if (r?.error) setErr(r.error);
  });

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="px-4 sm:px-8 h-16 flex items-center justify-between max-w-3xl w-full mx-auto">
        <span className="flex items-center gap-2"><span className="size-8 rounded-[9px] bg-accent text-on-accent grid place-items-center font-semibold">L</span><span className="font-semibold">Ledgr</span></span>
        <span className="text-caption text-ink-2 num">Step {step + 1} of {STEPS.length}</span>
      </header>
      <div className="max-w-3xl w-full mx-auto px-4 sm:px-8">
        <ol className="flex gap-1.5" aria-label="Progress">
          {STEPS.map((s, i) => <li key={s} className={cn("h-1 flex-1 rounded-full transition-colors", i <= step ? "bg-accent" : "bg-fill")} aria-current={i === step ? "step" : undefined}><span className="sr-only">{s}</span></li>)}
        </ol>
      </div>

      <main className="flex-1 max-w-xl w-full mx-auto px-4 sm:px-8 py-8 animate-rise" key={step}>
        {step === 0 && (
          <Step title="Tell us about your business" body="This appears on your invoices and reports.">
            <Field label="Business name" htmlFor="bn"><Input id="bn" value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} autoFocus placeholder="e.g. Tropic Press Juices" /></Field>
            <Field label="What do you sell?" htmlFor="bt"><Input id="bt" value={biz.business_type} onChange={(e) => setBiz({ ...biz, business_type: e.target.value })} placeholder="e.g. Fresh juices, auto parts, phones" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Your name" htmlFor="on"><Input id="on" value={biz.owner_name} onChange={(e) => setBiz({ ...biz, owner_name: e.target.value })} /></Field>
              <Field label="Phone" htmlFor="ph"><Input id="ph" type="tel" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} placeholder="0803 000 0000" /></Field>
            </div>
            <Field label="Your financial year starts in" htmlFor="fy">
              <Select id="fy" value={biz.fy_start_month} onChange={(e) => setBiz({ ...biz, fy_start_month: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
            </Field>
            <Field label="Are you registered for VAT?" hint="Most small traders aren't. You can change this later.">
              <Chips label="VAT" value={biz.vat_registered ? "yes" : "no"} onChange={(v) => setBiz({ ...biz, vat_registered: v === "yes" })} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes, 7.5%" }]} />
            </Field>
          </Step>
        )}

        {step === 1 && (
          <Step title="Where does your money sit?" body="Add your cash, bank and POS accounts with today's balance. This is how Ledgr tracks the cash you actually have.">
            {accounts.map((a, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_1fr_auto] gap-2 items-end">
                <Field label={i === 0 ? "Name" : ""}><Input value={a.name} onChange={(e) => setAccounts(accounts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} aria-label="Account name" /></Field>
                <Field label={i === 0 ? "Type" : ""}>
                  <Select value={a.type} aria-label="Account type" onChange={(e) => setAccounts(accounts.map((x, j) => j === i ? { ...x, type: e.target.value as typeof a.type } : x))}>
                    <option value="cash">Cash</option><option value="bank">Bank</option><option value="pos">POS</option><option value="mobile_money">Mobile money</option>
                  </Select>
                </Field>
                <Field label={i === 0 ? "Balance today" : ""}><MoneyInput value={a.opening_balance} onChange={(v) => setAccounts(accounts.map((x, j) => j === i ? { ...x, opening_balance: v } : x))} aria-label="Balance today" /></Field>
                <button type="button" onClick={() => setAccounts(accounts.filter((_, j) => j !== i))} disabled={accounts.length === 1} className="size-11 grid place-items-center rounded-[10px] text-ink-3 hover:text-negative disabled:opacity-30" aria-label="Remove account"><Trash2 size={17} /></button>
              </div>
            ))}
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setAccounts([...accounts, { name: "POS", type: "pos", opening_balance: 0 }])}><Plus size={15} />Add account</Button>
          </Step>
        )}

        {step === 2 && (
          <Step title="Your regular costs" body="Tick the ones you pay and enter the amount. Ledgr spreads them over time, so a year's rent shows as a fair share each week and month.">
            {recurring.map((r, i) => {
              const eq = r.amount ? equivalents({ amount: r.amount, frequency: r.frequency }) : null;
              return (
                <div key={r.name} className={cn("rounded-[12px] border p-3 transition-colors", r.on ? "border-accent bg-accent-soft/40" : "border-hairline bg-surface")}>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <span className={cn("size-5 rounded-[6px] border grid place-items-center", r.on ? "bg-accent border-accent text-on-accent" : "border-hairline-strong")}>{r.on && <Check size={13} strokeWidth={3} />}</span>
                    <input type="checkbox" className="sr-only" checked={r.on} onChange={(e) => setRecurring(recurring.map((x, j) => j === i ? { ...x, on: e.target.checked } : x))} />
                    <span className="text-body font-medium flex-1">{r.name}</span>
                  </label>
                  {r.on && (
                    <div className="grid grid-cols-2 gap-2 mt-3">
                      <MoneyInput value={r.amount} onChange={(v) => setRecurring(recurring.map((x, j) => j === i ? { ...x, amount: v } : x))} aria-label={`${r.name} amount`} />
                      <Select value={r.frequency} aria-label="How often" onChange={(e) => setRecurring(recurring.map((x, j) => j === i ? { ...x, frequency: e.target.value as Freq } : x))}>
                        <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Yearly</option>
                      </Select>
                      {eq && <p className="col-span-2 text-caption text-ink-2 num">≈ {formatMoney(eq.monthly)} a month · {formatMoney(eq.weekly)} a week</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </Step>
        )}

        {step === 3 && (
          <Step title="What do you sell?" body="Add a few products now, or import the rest later. If you have stock, tell us how many and what each cost you.">
            {products.map((p, i) => (
              <div key={i} className="rounded-[12px] border border-hairline bg-surface p-3 flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input value={p.name} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} placeholder="Product name" aria-label="Product name" />
                  {products.length > 1 && <button type="button" onClick={() => setProducts(products.filter((_, j) => j !== i))} className="size-11 shrink-0 grid place-items-center rounded-[10px] text-ink-3 hover:text-negative" aria-label="Remove"><Trash2 size={17} /></button>}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Price"><MoneyInput aria-label="Price" value={p.selling_price} onChange={(v) => setProducts(products.map((x, j) => j === i ? { ...x, selling_price: v } : x))} /></Field>
                  <Field label="Cost each"><MoneyInput aria-label="Cost each" value={p.unit_cost} onChange={(v) => setProducts(products.map((x, j) => j === i ? { ...x, unit_cost: v } : x))} /></Field>
                  <Field label="In stock"><Input aria-label="In stock" inputMode="decimal" value={p.qty} onChange={(e) => setProducts(products.map((x, j) => j === i ? { ...x, qty: e.target.value.replace(/[^\d.]/g, "") } : x))} placeholder="0" /></Field>
                </div>
              </div>
            ))}
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setProducts([...products, { name: "", selling_price: null, unit_cost: null, qty: "" }])}><Plus size={15} />Add another</Button>
          </Step>
        )}

        {step === 4 && (
          <Step title="Set your targets" body="Optional. Ledgr shows your progress on the dashboard.">
            <Field label="Weekly sales target"><MoneyInput value={targets.weekly_sales} onChange={(v) => setTargets({ ...targets, weekly_sales: v })} /></Field>
            <Field label="Monthly sales target"><MoneyInput value={targets.monthly_sales} onChange={(v) => setTargets({ ...targets, monthly_sales: v })} /></Field>
            <Field label="Monthly profit target"><MoneyInput value={targets.monthly_profit} onChange={(v) => setTargets({ ...targets, monthly_profit: v })} /></Field>
          </Step>
        )}

        {err && <p role="alert" className="text-caption text-negative mt-4">{err}</p>}
      </main>

      <footer className="sticky bottom-0 bg-bg/90 backdrop-blur-xl border-t border-hairline">
        <div className="max-w-xl mx-auto px-4 sm:px-8 py-3 flex items-center gap-2 pb-[max(12px,env(safe-area-inset-bottom))]">
          {step > 0 && <Button variant="plain" onClick={() => setStep(step - 1)}><ChevronLeft size={17} />Back</Button>}
          <div className="flex-1" />
          {step >= 2 && step < STEPS.length - 1 && <Button variant="plain" onClick={() => setStep(step + 1)}>Skip for now</Button>}
          <Button size="lg" onClick={next} disabled={pending}>{pending ? "Setting up…" : step === STEPS.length - 1 ? "Finish" : "Continue"}</Button>
        </div>
      </footer>
    </div>
  );
}

function Step({ title, body, children }: { title: string; body: string; children: React.ReactNode }) {
  return (
    <section>
      <h1 className="text-title sm:text-[1.75rem] sm:leading-9 font-semibold tracking-tight">{title}</h1>
      <p className="text-body text-ink-2 mt-1 mb-6">{body}</p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}
