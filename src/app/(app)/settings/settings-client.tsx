"use client";
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, Link2, Plus, UserPlus, Archive, RotateCcw, Pencil } from "lucide-react";
import {
  saveBusinessSettings, updateCashAccount, saveCategory, saveTarget, saveAlertRules,
  createInvite, revokeInvite, setMemberRole, removeMember,
} from "@/app/actions/control";
import { saveCashAccount } from "@/app/actions/ledger";
import { Badge, Button, Card, Field, Input, Select, Textarea, cn } from "@/components/ui/primitives";
import { Chips, MoneyInput } from "@/components/ui/inputs";
import { Sheet } from "@/components/ui/sheet";
import { ROLE_INFO, type Role } from "@/lib/permissions";
import { ALERT_META, type AlertKind } from "@/lib/finance/alerts";
import { formatMoney } from "@/lib/finance/money";

type Result = { ok: true } | { ok: false; error: string };
function useSave() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<Result | { ok: boolean; error?: string }>, done = "Saved.") =>
    start(async () => {
      setMsg(null);
      const r = await fn();
      if (!r.ok) return setMsg({ ok: false, text: ("error" in r && r.error) || "Something went wrong." });
      setMsg({ ok: true, text: done });
      router.refresh();
    });
  const note = msg && <p role={msg.ok ? "status" : "alert"} className={cn("text-caption", msg.ok ? "text-positive" : "text-negative")}>{msg.text}</p>;
  return { pending, run, note };
}

function Section({ title, sub, children, action }: { title: string; sub?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div><h2 className="text-headline font-semibold">{title}</h2>{sub && <p className="text-caption text-ink-2 mt-0.5 max-w-xl">{sub}</p>}</div>
        {action}
      </div>
      {children}
    </Card>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cn("relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors", checked ? "bg-positive" : "bg-fill-hover")}>
      <span className={cn("absolute left-0 top-[3px] size-5 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[21px]" : "translate-x-[3px]")} />
    </button>
  );
}

// ============================================================ Business
export interface BizSettings {
  name: string; business_type: string | null; owner_name: string | null; phone: string | null; email: string | null; address: string | null;
  week_start: number; fy_start_month: number; vat_registered: boolean; vat_rate_bp: number; prices_include_vat: boolean; default_payment_terms_days: number;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function BusinessForm({ initial }: { initial: BizSettings }) {
  const [f, setF] = useState(initial);
  const set = <K extends keyof BizSettings>(k: K, v: BizSettings[K]) => setF((x) => ({ ...x, [k]: v }));
  const { pending, run, note } = useSave();
  const save = () => run(() => saveBusinessSettings({
    ...f, business_type: f.business_type ?? "", owner_name: f.owner_name ?? "", phone: f.phone ?? "", email: f.email ?? "", address: f.address ?? "",
  }));
  return (
    <div className="flex flex-col gap-3">
      <Section title="Business details" sub="Shown on reports and exports.">
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Business name" htmlFor="bn"><Input id="bn" value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="What you do" htmlFor="bt"><Input id="bt" value={f.business_type ?? ""} onChange={(e) => set("business_type", e.target.value)} placeholder="e.g. Juice production & retail" /></Field>
          <Field label="Owner" htmlFor="bo"><Input id="bo" value={f.owner_name ?? ""} onChange={(e) => set("owner_name", e.target.value)} /></Field>
          <Field label="Phone" htmlFor="bp"><Input id="bp" value={f.phone ?? ""} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></Field>
          <Field label="Email" htmlFor="be"><Input id="be" type="email" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Address" htmlFor="ba" className="sm:col-span-2"><Textarea id="ba" rows={2} value={f.address ?? ""} onChange={(e) => set("address", e.target.value)} /></Field>
        </div>
      </Section>
      <Section title="VAT" sub="VAT you charge is money you hold for the government. It's never counted as revenue.">
        <div className="flex items-center justify-between gap-4 py-1">
          <div><div className="text-body font-medium">Registered for VAT</div><div className="text-caption text-ink-2">Turn on to add VAT to new sales.</div></div>
          <Toggle checked={f.vat_registered} onChange={(v) => set("vat_registered", v)} label="Registered for VAT" />
        </div>
        {f.vat_registered && (
          <div className="grid sm:grid-cols-2 gap-4 mt-4">
            <Field label="VAT rate (%)" htmlFor="vr" hint="Nigeria's standard rate is 7.5%.">
              <Input id="vr" inputMode="decimal" value={f.vat_rate_bp / 100} onChange={(e) => set("vat_rate_bp", Math.round(Number(e.target.value.replace(",", ".") || 0) * 100))} />
            </Field>
            <Field label="Your prices">
              <Chips label="Prices include VAT" value={f.prices_include_vat ? "incl" : "excl"} onChange={(v) => set("prices_include_vat", v === "incl")}
                options={[{ value: "excl", label: "Exclude VAT (VAT added on top)" }, { value: "incl", label: "Include VAT" }]} />
            </Field>
          </div>
        )}
        <p className="text-caption text-ink-3 mt-3">Changes apply to new sales only. Past sales keep the VAT they were recorded with.</p>
      </Section>
      <Section title="Periods and terms">
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label="Week starts on" htmlFor="ws"><Select id="ws" value={f.week_start} onChange={(e) => set("week_start", Number(e.target.value))}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field>
          <Field label="Financial year starts" htmlFor="fy"><Select id="fy" value={f.fy_start_month} onChange={(e) => set("fy_start_month", Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select></Field>
          <Field label="Default payment terms (days)" htmlFor="pt" hint="When credit sales are due, unless the customer has their own terms.">
            <Input id="pt" inputMode="numeric" value={f.default_payment_terms_days} onChange={(e) => set("default_payment_terms_days", Math.max(0, Number(e.target.value.replace(/\D/g, "")) || 0))} />
          </Field>
        </div>
      </Section>
      <div className="flex items-center gap-3 justify-end sticky bottom-[calc(76px+env(safe-area-inset-bottom))] lg:bottom-4">
        {note}
        <Button size="lg" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save changes"}</Button>
      </div>
    </div>
  );
}

// ============================================================ Accounts
export function AccountsEditor({ accounts }: { accounts: { id: string; name: string; type: string; is_active: boolean; closing: number }[] }) {
  const [edit, setEdit] = useState<(typeof accounts)[number] | "new" | null>(null);
  return (
    <Section title="Money accounts" sub="Where your money sits: cash drawer, bank, POS. Archived accounts keep their history but disappear from forms."
      action={<Button variant="secondary" size="sm" onClick={() => setEdit("new")}><Plus size={15} />Add</Button>}>
      <ul className="divide-y divide-hairline">
        {accounts.map((a) => (
          <li key={a.id} className={cn("flex items-center gap-3 py-3", !a.is_active && "opacity-60")}>
            <div className="flex-1 min-w-0">
              <div className="text-body font-medium flex items-center gap-2">{a.name}{!a.is_active && <Badge>Archived</Badge>}</div>
              <div className="text-caption text-ink-2 capitalize">{a.type.replace("_", " ")}</div>
            </div>
            <div className="num text-body">{formatMoney(a.closing)}</div>
            <button onClick={() => setEdit(a)} className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:text-ink hover:bg-fill" aria-label={`Edit ${a.name}`}><Pencil size={15} /></button>
          </li>
        ))}
      </ul>
      {edit && <AccountSheet key={edit === "new" ? "new" : edit.id} account={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
    </Section>
  );
}

type AccType = "cash" | "bank" | "pos" | "mobile_money" | "other";
function AccountSheet({ account, onClose }: { account: { id: string; name: string; type: string; is_active: boolean } | null; onClose: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccType>((account?.type as AccType) ?? "bank");
  const [opening, setOpening] = useState<number | null>(0);
  const { pending, run, note } = useSave();
  const save = (is_active = account?.is_active ?? true) => run(async () => {
    const r = account ? await updateCashAccount({ id: account.id, name, type, is_active })
      : await saveCashAccount({ name, type, opening_balance: opening ?? 0, opening_date: new Date().toISOString().slice(0, 10) });
    if (r.ok) onClose();
    return r;
  });
  return (
    <Sheet open onClose={onClose} title={account ? "Edit account" : "Add account"}
      footer={<div className="flex gap-2 justify-between">
        {account ? <Button variant="ghost" disabled={pending} onClick={() => save(!account.is_active)}>{account.is_active ? <><Archive size={16} />Archive</> : <><RotateCcw size={16} />Restore</>}</Button> : <span />}
        <Button disabled={pending || !name.trim()} onClick={() => save()}>{pending ? "Saving…" : "Save"}</Button>
      </div>}>
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="acn"><Input id="acn" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Type"><Chips label="Type" value={type} onChange={setType} options={[{ value: "cash", label: "Cash" }, { value: "bank", label: "Bank" }, { value: "pos", label: "POS" }, { value: "mobile_money", label: "Mobile money" }]} /></Field>
        {!account && <Field label="Balance today"><MoneyInput value={opening} onChange={setOpening} /></Field>}
        {note}
      </div>
    </Sheet>
  );
}

// ============================================================ Categories
type Cat = { id: string; name: string; kind?: string; is_system?: boolean; is_active: boolean };
const KIND_LABEL: Record<string, string> = { operating: "Running cost", other_expense: "Other expense", income_tax: "Income tax" };

export function CategoriesEditor({ expense, product }: { expense: Cat[]; product: Cat[] }) {
  return (
    <div className="grid lg:grid-cols-2 gap-3">
      <CategoryList title="Expense categories" sub="Running costs count in operating profit. “Other” and tax sit below it." table="expense_categories" rows={expense} />
      <CategoryList title="Product categories" sub="Group products for reports." table="product_categories" rows={product} />
    </div>
  );
}

function CategoryList({ title, sub, table, rows }: { title: string; sub: string; table: "expense_categories" | "product_categories"; rows: Cat[] }) {
  const [adding, setAdding] = useState("");
  const { pending, run, note } = useSave();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  return (
    <Section title={title} sub={sub}>
      <ul className="divide-y divide-hairline">
        {rows.map((c) => (
          <li key={c.id} className={cn("flex items-center gap-2 py-2", !c.is_active && "opacity-60")}>
            {editing === c.id ? (
              <form className="flex-1 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => saveCategory({ table, id: c.id, name, kind: c.kind as never }).then((r) => { if (r.ok) setEditing(null); return r; })); }}>
                <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="h-9" aria-label="Category name" />
                <Button size="sm" disabled={pending}>Save</Button>
              </form>
            ) : (
              <>
                <span className="flex-1 min-w-0 text-body truncate">{c.name}</span>
                {c.kind && c.kind !== "operating" && <Badge>{KIND_LABEL[c.kind]}</Badge>}
                {!c.is_active && <Badge>Archived</Badge>}
                <button onClick={() => { setEditing(c.id); setName(c.name); }} className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:text-ink hover:bg-fill" aria-label={`Rename ${c.name}`}><Pencil size={14} /></button>
                {!c.is_system && (
                  <button disabled={pending} onClick={() => run(() => saveCategory({ table, id: c.id, name: c.name, is_active: !c.is_active }), c.is_active ? "Archived." : "Restored.")}
                    className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:text-ink hover:bg-fill" aria-label={c.is_active ? `Archive ${c.name}` : `Restore ${c.name}`}>
                    {c.is_active ? <Archive size={14} /> : <RotateCcw size={14} />}
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="flex gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) run(() => saveCategory({ table, name: adding }).then((r) => { if (r.ok) setAdding(""); return r; }), "Added."); }}>
        <Input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="New category" className="h-10" aria-label="New category name" />
        <Button variant="secondary" disabled={pending || !adding.trim()}><Plus size={15} />Add</Button>
      </form>
      <div className="mt-2">{note}</div>
    </Section>
  );
}

// ============================================================ Targets
const TARGETS = [
  { kind: "daily_sales", label: "Daily sales", money: true },
  { kind: "weekly_sales", label: "Weekly sales", money: true },
  { kind: "monthly_sales", label: "Monthly sales", money: true },
  { kind: "monthly_profit", label: "Monthly net profit", money: true },
  { kind: "gross_margin", label: "Gross margin", money: false },
] as const;

export function TargetsEditor({ current, history, today }: {
  current: Record<string, { amount: number; effective_from: string } | undefined>;
  history: { kind: string; amount: number; effective_from: string; created_at: string }[]; today: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <Section title="Targets" sub="Used on the dashboard and for the “behind target” alert. Changing a target keeps the old one in history — past periods are judged against the target that applied then.">
        <ul className="divide-y divide-hairline">{TARGETS.map((t) => <TargetRow key={t.kind} t={t} cur={current[t.kind]} today={today} />)}</ul>
      </Section>
      {history.length > 0 && (
        <Section title="Target history">
          <ul className="divide-y divide-hairline text-body">
            {history.map((h, i) => {
              const t = TARGETS.find((x) => x.kind === h.kind);
              return (
                <li key={i} className="flex justify-between py-2 num">
                  <span>{t?.label ?? h.kind} <span className="text-ink-2">· from {h.effective_from}</span></span>
                  <span>{t?.money ? formatMoney(h.amount) : `${(h.amount / 100).toFixed(1)}%`}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
    </div>
  );
}

function TargetRow({ t, cur, today }: { t: (typeof TARGETS)[number]; cur?: { amount: number; effective_from: string }; today: string }) {
  const [val, setVal] = useState<number | null>(cur?.amount ?? null);
  const [pct, setPct] = useState(cur ? String(cur.amount / 100) : "");
  const [from, setFrom] = useState(today);
  const { pending, run, note } = useSave();
  const amount = t.money ? val : pct ? Math.round(Number(pct) * 100) : null;
  const changed = amount !== null && amount !== (cur?.amount ?? null);
  return (
    <li className="py-3 grid sm:grid-cols-[1fr_200px_160px_auto] gap-2 sm:items-center">
      <div>
        <div className="text-body font-medium">{t.label}</div>
        <div className="text-caption text-ink-2">{cur ? `Since ${cur.effective_from}` : "Not set"}</div>
      </div>
      {t.money ? <MoneyInput value={val} onChange={setVal} aria-label={t.label} />
        : <div className="relative"><Input inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} aria-label={`${t.label} (%)`} className="pr-8" /><span className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-2">%</span></div>}
      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Starting from" />
      <div className="flex items-center gap-2">
        <Button size="sm" variant={changed ? "primary" : "secondary"} disabled={pending || !changed} onClick={() => run(() => saveTarget({ kind: t.kind, amount: amount!, effective_from: from }))}>Save</Button>
        {note}
      </div>
    </li>
  );
}

// ============================================================ Alert rules
export function AlertRulesEditor({ rules }: { rules: { kind: AlertKind; enabled: boolean; value: number }[] }) {
  const [r, setR] = useState(rules);
  const { pending, run, note } = useSave();
  const upd = (k: AlertKind, patch: Partial<{ enabled: boolean; value: number }>) => setR((xs) => xs.map((x) => (x.kind === k ? { ...x, ...patch } : x)));
  return (
    <Section title="Alerts" sub="Ledgr checks these whenever something is recorded and shows them in the bell and on the dashboard. People without access to costs only see the alerts that don't reveal them.">
      <ul className="divide-y divide-hairline">
        {r.map((x) => {
          const m = ALERT_META[x.kind];
          return (
            <li key={x.kind} className="py-3 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="text-body font-medium">{m.label}</div>
                <div className="text-caption text-ink-2">{m.help}{m.unit ? "" : "."}</div>
              </div>
              {m.unit && (
                <div className="w-[170px]">
                  {m.unit === "money" ? <MoneyInput value={x.value} onChange={(v) => upd(x.kind, { value: v ?? 0 })} aria-label={`${m.label} level`} />
                    : (
                      <div className="relative">
                        <Input inputMode="decimal" value={x.value} onChange={(e) => upd(x.kind, { value: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} aria-label={`${m.label} level`} className="pr-14" />
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-caption text-ink-2">{m.unit === "pct" ? "%" : m.unit === "pts" ? "points" : "days"}</span>
                      </div>
                    )}
                </div>
              )}
              <Toggle checked={x.enabled} onChange={(v) => upd(x.kind, { enabled: v })} label={`${m.label} alert`} />
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-3 justify-end mt-3">
        {note}
        <Button disabled={pending} onClick={() => run(() => saveAlertRules(r), "Saved. Alerts re-checked.")}>{pending ? "Saving…" : "Save alert settings"}</Button>
      </div>
    </Section>
  );
}

// ============================================================ Team
export interface Member { member_id: string; user_id: string; email: string; name: string | null; role: Role; can_see_costs: boolean; joined_at: string; is_me: boolean }
export interface Invite { id: string; email: string; role: Role; can_see_costs: boolean; token: string; expires_at: string; created_at: string }

export function TeamPanel({ members, invites, myRole, origin }: { members: Member[]; invites: Invite[]; myRole: Role; origin: string }) {
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <Section title="Team" sub="Everyone who can open this business in Ledgr."
        action={<Button size="sm" onClick={() => setInviting(true)}><UserPlus size={15} />Invite</Button>}>
        <ul className="divide-y divide-hairline">
          {members.map((m) => (
            <li key={m.member_id} className="flex items-center gap-3 py-3">
              <span className="size-9 rounded-full bg-fill grid place-items-center text-caption font-semibold text-ink-2 shrink-0">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
              <div className="flex-1 min-w-0">
                <div className="text-body font-medium truncate">{m.name || m.email}{m.is_me && <span className="text-ink-2 font-normal"> (you)</span>}</div>
                <div className="text-caption text-ink-2 truncate">{m.email}</div>
              </div>
              <Badge tone={m.role === "owner" ? "accent" : "neutral"}>{ROLE_INFO[m.role].label}{m.role === "sales" && m.can_see_costs && " · sees costs"}</Badge>
              {!(m.role === "owner" && myRole !== "owner") && (
                <button onClick={() => setEditing(m)} className="size-8 grid place-items-center rounded-[8px] text-ink-3 hover:text-ink hover:bg-fill" aria-label={`Change ${m.name || m.email}`}><Pencil size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      </Section>
      {invites.length > 0 && (
        <Section title="Waiting to join" sub="Share the link with the person. It works once, only for that email, and expires after 14 days.">
          <ul className="divide-y divide-hairline">
            {invites.map((i) => <InviteRow key={i.id} i={i} origin={origin} />)}
          </ul>
        </Section>
      )}
      <Section title="What each role can do">
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
            <div key={r}><dt className="text-body font-medium">{ROLE_INFO[r].label}</dt><dd className="text-caption text-ink-2">{ROLE_INFO[r].summary}</dd></div>
          ))}
        </dl>
      </Section>
      {inviting && <InviteSheet onClose={() => setInviting(false)} onCreated={(t) => { setInviting(false); setLink(`${origin}/invite/${t}`); }} />}
      {link && <LinkSheet link={link} onClose={() => setLink(null)} />}
      {editing && <MemberSheet m={editing} myRole={myRole} onClose={() => setEditing(null)} />}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button variant="secondary" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { /* clipboard blocked */ } }}>
      {done ? <><Check size={15} />Copied</> : <><Copy size={15} />Copy link</>}
    </Button>
  );
}

function InviteRow({ i, origin }: { i: Invite; origin: string }) {
  const { pending, run } = useSave();
  const link = `${origin}/invite/${i.token}`;
  return (
    <li className="py-3 flex flex-wrap items-center gap-3">
      <div className="flex-1 min-w-[180px]">
        <div className="text-body font-medium truncate">{i.email}</div>
        <div className="text-caption text-ink-2">{ROLE_INFO[i.role].label} · expires {i.expires_at.slice(0, 10)}</div>
      </div>
      <CopyButton text={link} />
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => revokeInvite(i.id), "Invitation cancelled.")}>Cancel</Button>
    </li>
  );
}

function InviteSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (token: string) => void }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("sales");
  const [costs, setCosts] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Sheet open onClose={onClose} title="Invite someone"
      footer={<Button size="lg" className="w-full" disabled={pending || !email.includes("@")} onClick={() => start(async () => {
        const r = await createInvite({ email, role, can_see_costs: role === "sales" ? costs : undefined });
        if (!r.ok) return setErr(r.error);
        router.refresh(); onCreated(r.data);
      })}>{pending ? "Creating…" : "Create invitation link"}</Button>}>
      <div className="flex flex-col gap-4">
        <Field label="Their email" htmlFor="ie" hint="They must sign in or sign up with this exact email."><Input id="ie" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus placeholder="name@example.com" /></Field>
        <Field label="Role">
          <div className="flex flex-col gap-2">
            {(["admin", "accountant", "sales", "viewer"] as const).map((r) => (
              <label key={r} className={cn("flex items-start gap-3 rounded-[12px] border p-3 cursor-pointer", role === r ? "border-accent bg-accent-soft" : "border-hairline")}>
                <input type="radio" name="role" checked={role === r} onChange={() => setRole(r)} className="mt-1 accent-[var(--accent)]" />
                <span><span className="block text-body font-medium">{ROLE_INFO[r].label}</span><span className="block text-caption text-ink-2">{ROLE_INFO[r].summary}</span></span>
              </label>
            ))}
          </div>
        </Field>
        {role === "sales" && (
          <div className="flex items-center justify-between gap-3">
            <div><div className="text-body font-medium">Can see costs and profit</div><div className="text-caption text-ink-2">Off by default for sales staff.</div></div>
            <Toggle checked={costs} onChange={setCosts} label="Can see costs and profit" />
          </div>
        )}
        {err && <p role="alert" className="text-caption text-negative">{err}</p>}
      </div>
    </Sheet>
  );
}

function LinkSheet({ link, onClose }: { link: string; onClose: () => void }) {
  return (
    <Sheet open onClose={onClose} title="Invitation ready" footer={<Button size="lg" className="w-full" onClick={onClose}>Done</Button>}>
      <div className="flex flex-col gap-4">
        <p className="text-body">Send this link by WhatsApp, SMS or email. It works once, only for the email you entered.</p>
        <div className="flex items-center gap-2 rounded-[12px] bg-fill px-3 py-2.5">
          <Link2 size={16} className="text-ink-2 shrink-0" />
          <code className="text-caption break-all flex-1">{link}</code>
        </div>
        <CopyButton text={link} />
      </div>
    </Sheet>
  );
}

function MemberSheet({ m, myRole, onClose }: { m: Member; myRole: Role; onClose: () => void }) {
  const [role, setRole] = useState<Role>(m.role);
  const [costs, setCosts] = useState(m.can_see_costs);
  const [confirm, setConfirm] = useState(false);
  const { pending, run, note } = useSave();
  const roles: Role[] = myRole === "owner" ? ["owner", "admin", "accountant", "sales", "viewer"] : ["admin", "accountant", "sales", "viewer"];
  return (
    <Sheet open onClose={onClose} title={m.name || m.email} subtitle={m.email}
      footer={<div className="flex gap-2 justify-between">
        {!m.is_me ? (confirm
          ? <Button variant="destructive" disabled={pending} onClick={() => run(async () => { const r = await removeMember({ member_id: m.member_id }); if (r.ok) onClose(); return r; }, "Removed.")}>Yes, remove</Button>
          : <Button variant="ghost" className="text-negative" onClick={() => setConfirm(true)}>Remove from team</Button>)
          : <span />}
        <Button disabled={pending || (role === m.role && costs === m.can_see_costs)} onClick={() => run(async () => { const r = await setMemberRole({ member_id: m.member_id, role, can_see_costs: role === "sales" ? costs : false }); if (r.ok) onClose(); return r; })}>Save</Button>
      </div>}>
      <div className="flex flex-col gap-4">
        <Field label="Role"><Chips label="Role" value={role} onChange={setRole} options={roles.map((r) => ({ value: r, label: ROLE_INFO[r].label }))} /></Field>
        <p className="text-caption text-ink-2 -mt-2">{ROLE_INFO[role].summary}</p>
        {role === "sales" && (
          <div className="flex items-center justify-between gap-3">
            <div className="text-body">Can see costs and profit</div>
            <Toggle checked={costs} onChange={setCosts} label="Can see costs and profit" />
          </div>
        )}
        {confirm && <p className="text-caption text-negative">They lose access straight away. Everything they recorded stays.</p>}
        {note}
      </div>
    </Sheet>
  );
}
