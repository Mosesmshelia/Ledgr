import Link from "next/link";
import { headers } from "next/headers";
import { requireCtx } from "@/lib/server/session";
import { can, type Capability } from "@/lib/permissions";
import { Card, PageHeader, Badge, ButtonLink, cn } from "@/components/ui/primitives";
import { mergeRules, todayIn, formatMoney, type AlertKind } from "@/lib/finance";
import { BusinessForm, AccountsEditor, CategoriesEditor, TargetsEditor, AlertRulesEditor, TeamPanel, type BizSettings, type Member, type Invite } from "./settings-client";

export const metadata = { title: "Settings" };

const TABS: { key: string; label: string; need: Capability }[] = [
  { key: "business", label: "Business", need: "business" },
  { key: "accounts", label: "Accounts", need: "settings" },
  { key: "categories", label: "Categories", need: "settings" },
  { key: "targets", label: "Targets", need: "settings" },
  { key: "alerts", label: "Alerts", need: "settings" },
  { key: "team", label: "Team", need: "team" },
  { key: "activity", label: "Activity log", need: "audit" },
];

type SP = { tab?: string; table?: string; action?: string; user?: string; from?: string; to?: string; before?: string };

export default async function Settings({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tabs = TABS.filter((t) => can(ctx.role, t.need));
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? tabs[0].key;
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);

  return (
    <div className="animate-rise max-w-4xl">
      <PageHeader title="Settings" subtitle={ctx.business.name} />
      <nav aria-label="Settings sections" className="flex flex-wrap gap-1 mb-4">
        {tabs.map((t) => (
          <Link key={t.key} href={`/settings?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}
            className={cn("h-9 px-3.5 rounded-full text-body whitespace-nowrap grid place-items-center transition-colors",
              t.key === tab ? "bg-ink text-bg font-medium" : "text-ink-2 hover:bg-fill")}>{t.label}</Link>
        ))}
      </nav>

      {tab === "business" && await (async () => {
        const [biz] = await ctx.q<BizSettings>("select * from businesses where id = $1", [b]);
        return <BusinessForm initial={biz} />;
      })()}

      {tab === "accounts" && await (async () => {
        const rows = await ctx.q<{ id: string; name: string; type: string; is_active: boolean }>("select id, name, type, is_active from cash_accounts where business_id = $1 order by is_active desc, created_at", [b]);
        const bal = await ctx.q<{ account_id: string; closing: number }>("select account_id, closing from fin_cash_accounts($1,$2,$2)", [b, today]);
        return <AccountsEditor accounts={rows.map((r) => ({ ...r, closing: Number(bal.find((x) => x.account_id === r.id)?.closing ?? 0) }))} />;
      })()}

      {tab === "categories" && await (async () => {
        const expense = await ctx.q<{ id: string; name: string; kind: string; is_system: boolean; is_active: boolean }>(
          "select id, name, kind, is_system, is_active from expense_categories where business_id = $1 order by is_active desc, kind, sort_order, name", [b]);
        const product = await ctx.q<{ id: string; name: string; is_active: boolean }>("select id, name, is_active from product_categories where business_id = $1 order by is_active desc, name", [b]);
        return <CategoriesEditor expense={expense} product={product} />;
      })()}

      {tab === "targets" && await (async () => {
        const cur = await ctx.q<{ kind: string; amount: number; effective_from: string }>(
          "select distinct on (kind) kind, amount, effective_from::text from targets where business_id = $1 and effective_from <= $2 order by kind, effective_from desc, created_at desc", [b, today]);
        const history = await ctx.q<{ kind: string; amount: number; effective_from: string; created_at: string }>(
          "select kind, amount, effective_from::text, created_at from targets where business_id = $1 order by effective_from desc, created_at desc limit 30", [b]);
        return <TargetsEditor current={Object.fromEntries(cur.map((c) => [c.kind, { amount: Number(c.amount), effective_from: c.effective_from }]))} history={history.map((h) => ({ ...h, amount: Number(h.amount) }))} today={today} />;
      })()}

      {tab === "alerts" && await (async () => {
        const rows = await ctx.q<{ kind: string; enabled: boolean; threshold: { value?: number } }>("select kind, enabled, threshold from alert_rules where business_id = $1", [b]);
        const merged = mergeRules(rows);
        return <AlertRulesEditor rules={(Object.keys(merged) as AlertKind[]).map((k) => ({ kind: k, ...merged[k] }))} />;
      })()}

      {tab === "team" && await (async () => {
        const members = await ctx.q<Member>("select * from team_members($1)", [b]);
        const invites = await ctx.q<Invite>(
          "select id, email, role, can_see_costs, token, expires_at::text, created_at::text from invitations where business_id = $1 and accepted_at is null and revoked_at is null and expires_at > now() order by created_at desc", [b]);
        const h = await headers();
        const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
        return <TeamPanel members={members} invites={invites} myRole={ctx.role} origin={origin} />;
      })()}

      {tab === "activity" && <Activity ctx={ctx} sp={sp} />}
    </div>
  );
}

// ============================================================ Activity log
const TABLE_LABEL: Record<string, string> = {
  sales: "Sale", sale_items: "Sale line", sale_returns: "Return", purchases: "Purchase", production_batches: "Production batch",
  expenses: "Expense", recurring_expenses: "Recurring expense", cash_transactions: "Money movement", products: "Product",
  cash_accounts: "Account", business_members: "Team member", businesses: "Business settings", targets: "Target", alert_rules: "Alert setting",
  budgets: "Budget", customers: "Customer", suppliers: "Supplier", expense_categories: "Expense category", product_categories: "Product category",
  stock_adjustments: "Stock adjustment",
};
const ACTION: Record<string, { label: string; tone: "neutral" | "accent" | "negative" | "warning" }> = {
  insert: { label: "Added", tone: "accent" }, update: { label: "Changed", tone: "neutral" }, void: { label: "Voided", tone: "negative" }, remove: { label: "Removed", tone: "warning" },
};
const MONEY_KEYS = new Set(["amount", "total", "net", "gross", "vat_amount", "discount_total", "opening_balance", "selling_price", "standard_cost", "unit_cost",
  "cost_effect", "cogs", "net_amount", "gross_amount", "discount_amount", "total_cost", "net_total", "vat_total"]);
const SKIP_KEYS = new Set(["id", "business_id", "created_at", "updated_at", "created_by", "voided_by", "next_invoice_no", "settings"]);

function fmt(k: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (MONEY_KEYS.has(k) && typeof v === "number") return formatMoney(v, { exact: true });
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (k === "vat_rate_bp" && typeof v === "number") return `${v / 100}%`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
const nice = (k: string) => k.replace(/_bp$/, "").replace(/_id$/, "").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const TARGET_LABEL: Record<string, string> = { daily_sales: "Daily sales", weekly_sales: "Weekly sales", monthly_sales: "Monthly sales", monthly_profit: "Monthly profit", gross_margin: "Gross margin" };

function describe(row: { table_name: string; old: Record<string, unknown> | null; new: Record<string, unknown> | null }) {
  const r = row.new ?? row.old ?? {};
  if (row.table_name === "targets") {
    const pct = r.kind === "gross_margin";
    return { name: `${TARGET_LABEL[r.kind as string] ?? r.kind} · ${pct ? `${Number(r.amount) / 100}%` : formatMoney(Number(r.amount))} from ${r.effective_from}`, money: undefined };
  }
  if (row.table_name === "budgets") return { name: `${r.line === "category" ? "Expense category" : r.line} · ${String(r.month).slice(0, 7)}`, money: r.amount as number };
  const name = (r.invoice_no ?? r.name ?? r.batch_no ?? r.reason ?? r.description ?? r.email ?? "") as string;
  const money = ["total", "amount", "net_amount"].map((k) => r[k]).find((v) => typeof v === "number") as number | undefined;
  return { name, money };
}

function diff(o: Record<string, unknown> | null, n: Record<string, unknown> | null) {
  if (!o || !n) return [];
  return Object.keys(n).filter((k) => !SKIP_KEYS.has(k) && JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => ({ key: nice(k), from: fmt(k, o[k]), to: fmt(k, n[k]) }));
}

async function Activity({ ctx, sp }: { ctx: Awaited<ReturnType<typeof requireCtx>>; sp: SP }) {
  const b = ctx.business.id;
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const filters: Record<string, string> = {};
  if (sp.table && TABLE_LABEL[sp.table]) filters.table = sp.table;
  if (sp.action && ACTION[sp.action]) filters.action = sp.action;
  if (sp.user && /^[0-9a-f-]{36}$/.test(sp.user)) filters.user_id = sp.user;
  if (sp.from && iso.test(sp.from)) filters.from = sp.from;
  if (sp.to && iso.test(sp.to)) filters.to = sp.to;
  if (sp.before && /^\d+$/.test(sp.before)) filters.before = sp.before;
  const rows = await ctx.q<{ id: number; at: string; table_name: string; record_id: string; action: string; user_name: string; reason: string | null; old: Record<string, unknown> | null; new: Record<string, unknown> | null }>(
    "select * from audit_entries($1, $2::jsonb)", [b, JSON.stringify({ ...filters, limit: 50 })]);
  const people = await ctx.q<{ user_id: string; name: string | null; email: string }>("select user_id, name, email from team_members($1)", [b]);
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams({ tab: "activity" });
    for (const [k, v] of Object.entries({ table: sp.table, action: sp.action, user: sp.user, from: sp.from, to: sp.to, ...patch })) if (v) p.set(k, v);
    return `/settings?${p}`;
  };
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: ctx.business.timezone });

  return (
    <>
      <form className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3" action="/settings">
        <input type="hidden" name="tab" value="activity" />
        <select name="table" defaultValue={sp.table ?? ""} className="h-10 rounded-[10px] bg-fill px-3 text-body" aria-label="Record type">
          <option value="">All records</option>
          {Object.entries(TABLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="action" defaultValue={sp.action ?? ""} className="h-10 rounded-[10px] bg-fill px-3 text-body" aria-label="What happened">
          <option value="">Any change</option>
          {Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select name="user" defaultValue={sp.user ?? ""} className="h-10 rounded-[10px] bg-fill px-3 text-body" aria-label="Person">
          <option value="">Anyone</option>
          {people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name || p.email}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from} className="h-10 rounded-[10px] bg-fill px-3 text-body" aria-label="From" />
        <div className="flex gap-2 col-span-2 sm:col-span-1">
          <input type="date" name="to" defaultValue={sp.to} className="h-10 min-w-0 flex-1 rounded-[10px] bg-fill px-3 text-body" aria-label="To" />
          <button className="h-10 px-3.5 rounded-[10px] bg-accent text-on-accent text-body font-medium">Filter</button>
        </div>
      </form>
      <p className="text-caption text-ink-2 mb-3">Every change is recorded here and can&apos;t be edited or deleted — not even by the owner.</p>
      <Card className="overflow-hidden">
        {rows.length === 0 ? <p className="p-5 text-body text-ink-2">No activity matches these filters.</p> : (
          <ul>
            {rows.map((r) => {
              const d = describe(r);
              const changes = r.action === "update" ? diff(r.old, r.new) : [];
              const a = ACTION[r.action] ?? { label: r.action, tone: "neutral" as const };
              return (
                <li key={r.id} className="px-5 py-3 border-t border-hairline first:border-0">
                  <details className="group">
                    <summary className="flex items-start gap-3 cursor-pointer list-none">
                      <Badge tone={a.tone} className="mt-0.5 w-[72px] justify-center">{a.label}</Badge>
                      <div className="flex-1 min-w-0">
                        <div className="text-body"><span className="font-medium">{TABLE_LABEL[r.table_name] ?? r.table_name}</span>{d.name && <span className="text-ink-2"> · {d.name}</span>}{d.money !== undefined && r.action !== "update" && <span className="text-ink-2 num"> · {formatMoney(d.money)}</span>}</div>
                        <div className="text-caption text-ink-2">{r.user_name} · {when.format(new Date(r.at))}{changes.length > 0 && ` · ${changes.length} field${changes.length === 1 ? "" : "s"}`}</div>
                        {r.reason && <div className="text-caption text-ink mt-0.5">Reason: {r.reason}</div>}
                      </div>
                    </summary>
                    <div className="mt-2 ml-[84px]">
                      {changes.length > 0 ? (
                        <table className="text-caption num w-full max-w-lg">
                          <tbody>{changes.map((c) => (
                            <tr key={c.key} className="border-t border-hairline"><td className="py-1 pr-3 text-ink-2">{c.key}</td><td className="py-1 pr-2 line-through text-ink-3 break-all">{c.from}</td><td className="py-1 break-all">{c.to}</td></tr>
                          ))}</tbody>
                        </table>
                      ) : (
                        <p className="text-caption text-ink-3">{r.action === "insert" ? "Created." : r.action === "void" ? "Marked as voided. Nothing was deleted." : "No field changes."}</p>
                      )}
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      {rows.length === 50 && (
        <div className="flex justify-center mt-3"><ButtonLink variant="secondary" size="sm" href={qs({ before: String(rows[rows.length - 1].id) })}>Older</ButtonLink></div>
      )}
    </>
  );
}
