import Link from "next/link";
import { requireCtx } from "@/lib/server/session";
import { can } from "@/lib/permissions";
import { Badge, Card, EmptyState, Money, PageHeader, cn, invoiceStatus } from "@/components/ui/primitives";
import { ageing, calculateCashFlow, formatDate, formatMoney, formatRange, resolvePeriod, todayIn, type CashAccountRow, type PeriodKey } from "@/lib/finance";
import { PeriodSelector } from "@/components/app/period-selector";
import { parsePeriodParams } from "@/lib/period-params";
import { VoidInline } from "../sales/[id]/sale-actions";
import { readListParams, Where, orderAndPage, pageOf, like, type ListParams } from "@/lib/server/list";
import { ListControls, Pager } from "@/components/app/list-controls";
import { MoveMoneyButton, CustomerPaymentTrigger, AddAccountButton } from "./money-client";

export const metadata = { title: "Money" };

const KIND: Record<string, string> = {
  customer_payment: "Customer payment", supplier_payment: "Supplier payment", expense_payment: "Expense", recurring_payment: "Recurring expense",
  direct_cost_payment: "Production cost", other_income: "Other income", capital_injection: "Money you put in", loan_received: "Loan received",
  loan_repayment: "Loan repayment", owner_withdrawal: "Owner withdrawal", tax_payment: "Tax payment", refund: "Refund", transfer: "Transfer",
};

export default async function MoneyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const tab = sp.tab === "receivables" || sp.tab === "payables" || sp.tab === "cashflow" ? sp.tab : "accounts";
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  const accounts = await ctx.q<{ account_id: string; name: string; type: string; closing: number }>("select * from fin_cash_accounts($1,$2,$2)", [b, today]);
  const receivables = await ctx.q<{ sale_id: string; invoice_no: string; customer_id: string; customer_name: string; date: string; due_date: string; total: number; paid: number; outstanding: number; days_overdue: number; status: string }>("select * from fin_receivables($1,$2)", [b, today]);
  const payables = await ctx.q<{ purchase_id: string; supplier_id: string; supplier_invoice_no: string | null; supplier_name: string; date: string; due_date: string; total: number; outstanding: number; days_overdue: number; status: string }>("select * from fin_payables($1,$2)", [b, today]);
  const customers = await ctx.q<{ id: string; name: string; owed: number }>(`
    select c.id, c.name, coalesce(sum(app_sale_outstanding(s.id)), 0)::bigint owed from customers c left join sales s on s.customer_id = c.id and s.voided_at is null
    where c.business_id = $1 and not c.is_walk_in group by c.id order by owed desc, c.name`, [b]);
  const total = accounts.reduce((a, x) => a + x.closing, 0);
  const rec = ageing(receivables);
  const pay = ageing(payables);

  const tabs = [
    { key: "accounts", label: "Accounts" },
    { key: "cashflow", label: "Cash flow" },
    { key: "receivables", label: "Customers owe you" },
    { key: "payables", label: "You owe suppliers" },
  ];

  return (
    <div className="animate-rise">
      <PageHeader title="Money" subtitle={<>You have <Money value={total} className="text-ink font-medium" /> across {accounts.length} accounts.</>}
        actions={can(ctx.role, "record") && <><MoveMoneyButton accounts={accounts.map((a) => ({ id: a.account_id, name: a.name }))} today={today} /><CustomerPaymentTrigger open={sp.pay === "customer"} customers={customers} accounts={accounts.map((a) => ({ id: a.account_id, name: a.name, type: a.type }))} today={today} /></>} />

      <div className="inline-flex p-0.5 rounded-[10px] bg-fill mb-4 max-w-full overflow-x-auto" role="tablist">
        {tabs.map((t) => (
          <Link key={t.key} href={`/money${t.key === "accounts" ? "" : `?tab=${t.key}`}`} role="tab" aria-selected={tab === t.key}
            className={cn("h-8 px-3.5 grid place-items-center rounded-[8px] text-caption font-medium whitespace-nowrap", tab === t.key ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2 hover:text-ink")}>{t.label}</Link>
        ))}
      </div>

      {tab === "accounts" && <Accounts b={b} ctx={ctx} accounts={accounts} today={today} lp={readListParams(sp, { sort: "date" })} />}
      {tab === "cashflow" && <CashFlow ctx={ctx} sp={sp} today={today} />}

      {tab === "receivables" && (
        <>
          <Ageing a={rec} label="Customers owe you" />
          <ByParty title="By customer" rows={group(receivables.map((r) => ({ id: r.customer_id, name: r.customer_name, amount: r.outstanding, overdue: r.days_overdue > 0 ? r.outstanding : 0 })))} base="/money/customers" />
          <Card className="overflow-hidden mt-3">
            <h2 className="text-headline font-semibold px-5 pt-4 pb-1">Open invoices</h2>
            {receivables.length === 0 ? <EmptyState title="Nobody owes you" body="Credit sales that aren't fully paid will show up here." /> : (
              <ul>{receivables.map((r, i) => (
                <li key={r.sale_id} className={cn(i > 0 && "border-t border-hairline")}>
                  <Link href={`/sales/${r.sale_id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-body font-medium truncate">{r.customer_name}</div>
                      <div className="text-caption text-ink-2 num">{r.invoice_no} · {formatDate(r.date)} · {r.days_overdue > 0 ? <span className="text-negative">{r.days_overdue} days overdue</span> : `due ${formatDate(r.due_date)}`}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-body font-medium num"><Money value={r.outstanding} /></div>
                      <Badge tone={invoiceStatus[r.status].tone} className="mt-1">{invoiceStatus[r.status].label}</Badge>
                    </div>
                  </Link>
                </li>
              ))}</ul>
            )}
          </Card>
        </>
      )}

      {tab === "payables" && (
        <>
          <Ageing a={pay} label="You owe suppliers" />
          <ByParty title="By supplier" rows={group(payables.map((r) => ({ id: r.supplier_id, name: r.supplier_name, amount: r.outstanding, overdue: r.days_overdue > 0 ? r.outstanding : 0 })))} base="/money/suppliers" />
          <Card className="overflow-hidden mt-3">
            <h2 className="text-headline font-semibold px-5 pt-4 pb-1">Open bills</h2>
            {payables.length === 0 ? <EmptyState title="You don't owe anyone" body="Purchases on credit will show up here until you pay them." /> : (
              <ul>{payables.map((r, i) => (
                <li key={r.purchase_id} className={cn("flex items-center gap-3 px-5 py-3", i > 0 && "border-t border-hairline")}>
                  <div className="min-w-0 flex-1">
                    <div className="text-body font-medium truncate">{r.supplier_name}</div>
                    <div className="text-caption text-ink-2 num">{r.supplier_invoice_no ?? "No invoice no."} · {formatDate(r.date)} · {r.days_overdue > 0 ? <span className="text-negative">{r.days_overdue} days overdue</span> : `due ${formatDate(r.due_date)}`}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-body font-medium num"><Money value={r.outstanding} /></div>
                    <Badge tone={invoiceStatus[r.status].tone} className="mt-1">{invoiceStatus[r.status].label}</Badge>
                  </div>
                </li>
              ))}</ul>
            )}
          </Card>
          <p className="text-caption text-ink-2 mt-2">Pay a supplier from <Link href="/inventory/purchases" className="text-accent">Purchases</Link>.</p>
        </>
      )}
    </div>
  );
}

function Ageing({ a, label }: { a: ReturnType<typeof ageing>; label: string }) {
  const cells = [
    { l: "Not yet due", v: a.current }, { l: "1–30 days late", v: a.d1_30 }, { l: "31–60", v: a.d31_60 }, { l: "61–90", v: a.d61_90 }, { l: "90+", v: a.d90p },
  ];
  return (
    <Card className="p-5">
      <div className="text-caption font-medium text-ink-2">{label}</div>
      <div className="text-display-sm font-semibold num mt-1"><Money value={a.total} compact /></div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
        {cells.map((c, i) => (
          <div key={c.l} className="rounded-[10px] bg-surface-2 border border-hairline px-3 py-2">
            <div className="text-caption text-ink-2">{c.l}</div>
            <div className={cn("text-body font-medium num", i > 0 && c.v > 0 && "text-negative")}><Money value={c.v} /></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

async function Accounts({ b, ctx, accounts, today, lp }: { b: string; ctx: Awaited<ReturnType<typeof requireCtx>>; accounts: { account_id: string; name: string; type: string; closing: number }[]; today: string; lp: ListParams }) {
  const w = new Where("ct.business_id = ?", b);
  if (lp.q) w.add("(ct.description ilike ? or ct.counterparty ilike ? or c.name ilike ? or s.name ilike ?)", like(lp.q), like(lp.q), like(lp.q), like(lp.q));
  if (lp.from) w.add("ct.date >= ?", lp.from);
  if (lp.to) w.add("ct.date <= ?", lp.to);
  if (lp.account && accounts.some((a) => a.account_id === lp.account)) w.add("ct.account_id = ?", lp.account);
  if (lp.dir_ === "in" || lp.dir_ === "out") w.add("ct.direction = ?", lp.dir_);
  if (lp.kind && KIND[String(lp.kind)]) w.add("ct.kind = ?", lp.kind);
  const order = orderAndPage(lp, { date: "ct.date", amount: "ct.amount" }, "date", w, "ct.created_at desc");
  const raw = await ctx.q<{ id: string; date: string; account: string; direction: string; amount: number; kind: string; description: string | null; counterparty: string | null; customer: string | null; supplier: string | null; voided_at: string | null; source_type: string | null; transfer_group_id: string | null }>(`
    select ct.id, ct.date, a.name account, ct.direction, ct.amount, ct.kind, ct.description, ct.counterparty, c.name customer, s.name supplier, ct.voided_at, ct.source_type, ct.transfer_group_id
    from cash_transactions ct join cash_accounts a on a.id = ct.account_id left join customers c on c.id = ct.customer_id left join suppliers s on s.id = ct.supplier_id
    where ${w.sql} ${order}`, w.params);
  const { rows: tx, hasMore, page, pageSize } = pageOf(raw, lp);
  const filtered = !!(lp.q || lp.from || lp.to || lp.account || lp.dir_ || lp.kind);
  void today;
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {accounts.map((a) => (
          <Card key={a.account_id} className="p-5">
            <div className="text-caption font-medium text-ink-2">{a.name}</div>
            <div className={cn("text-title font-semibold num mt-1", a.closing < 0 && "text-negative")}><Money value={a.closing} /></div>
            <div className="text-caption text-ink-3 capitalize">{a.type.replace("_", " ")}</div>
          </Card>
        ))}
        {can(ctx.role, "record") && <AddAccountButton />}
      </div>
      <Card className="overflow-hidden mt-3">
        <h2 className="text-headline font-semibold px-5 pt-4 pb-2">Money in and out</h2>
        <div className="px-5">
          <ListControls search="Search description, customer or supplier" keep={["tab"]}
            filters={[
              { param: "dir_", label: "Direction", options: [{ value: "in", label: "Money in" }, { value: "out", label: "Money out" }] },
              { param: "account", label: "Account", allLabel: "All accounts", options: accounts.map((a) => ({ value: a.account_id, label: a.name })) },
            ]}
            sorts={[{ value: "date:asc", label: "Oldest first" }, { value: "amount:desc", label: "Largest first" }]} />
        </div>
        {tx.length === 0 && <EmptyState title={filtered ? "No matching transactions" : "No money in or out yet"} body={filtered ? "Try a different search, date range or filter." : "Sales paid, expenses, transfers and loans all show up here."} />}
        <ul>
          {tx.map((t) => (
            <li key={t.id} className={cn("flex items-center gap-3 px-5 py-2.5 border-t border-hairline", t.voided_at && "text-ink-3 line-through")}>
              <div className="min-w-0 flex-1">
                <div className="text-body truncate">{KIND[t.kind]}{(t.customer || t.supplier || t.counterparty || t.description) && <span className="text-ink-2"> · {t.customer ?? t.supplier ?? t.counterparty ?? t.description}</span>}</div>
                <div className="text-caption text-ink-3">{t.account} · {formatDate(t.date)}</div>
              </div>
              {can(ctx.role, "void") && !t.voided_at && !["expense", "sale_return", "production_batch"].includes(t.source_type ?? "") && (
                <VoidInline id={t.id} type="cash" label="Void"
                  effect={t.transfer_group_id ? "This cancels the whole transfer: the money goes back to the account it came from."
                    : t.kind === "customer_payment" ? `This cancels the ${formatMoney(t.amount, { exact: true })} payment. The customer will owe it again.`
                    : t.kind === "supplier_payment" ? `This cancels the ${formatMoney(t.amount, { exact: true })} payment. You will owe the supplier again.`
                    : `This removes ${formatMoney(t.amount, { exact: true })} ${t.direction === "in" ? "coming into" : "going out of"} ${t.account}.`} />
              )}
              <div className={cn("num font-medium", t.direction === "in" ? "text-positive" : "text-ink")}>{t.direction === "in" ? "+" : "−"}<Money value={t.amount} /></div>
            </li>
          ))}
        </ul>
        <div className="px-5 pb-3 empty:hidden"><Pager page={page} hasMore={hasMore} shown={tx.length} pageSize={pageSize} /></div>
      </Card>
    </>
  );
}

function group(rows: { id: string; name: string; amount: number; overdue: number }[]) {
  const m = new Map<string, { id: string; name: string; amount: number; overdue: number; count: number }>();
  for (const r of rows) {
    const g = m.get(r.id) ?? { id: r.id, name: r.name, amount: 0, overdue: 0, count: 0 };
    g.amount += r.amount; g.overdue += r.overdue; g.count += 1; m.set(r.id, g);
  }
  return [...m.values()].sort((a, z) => z.amount - a.amount);
}

function ByParty({ title, rows, base }: { title: string; rows: ReturnType<typeof group>; base: string }) {
  if (!rows.length) return null;
  return (
    <Card className="overflow-hidden mt-3">
      <h2 className="text-headline font-semibold px-5 pt-4 pb-1">{title}</h2>
      <ul>{rows.map((r) => (
        <li key={r.id} className="border-t border-hairline first:border-0">
          <Link href={`${base}/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
            <div className="flex-1 min-w-0"><div className="text-body font-medium truncate">{r.name}</div><div className="text-caption text-ink-2">{r.count} open · statement →</div></div>
            <div className="text-right num"><div className="text-body font-medium"><Money value={r.amount} /></div>{r.overdue > 0 && <div className="text-caption text-negative"><Money value={r.overdue} /> overdue</div>}</div>
          </Link>
        </li>
      ))}</ul>
    </Card>
  );
}

const IN_KINDS = ["customer_payment", "other_income", "capital_injection", "loan_received"];

async function CashFlow({ ctx, sp, today }: { ctx: Awaited<ReturnType<typeof requireCtx>>; sp: { period?: string; from?: string; to?: string }; today: string }) {
  const { key, custom } = parsePeriodParams(sp, "this_month");
  const period = resolvePeriod(key as PeriodKey, today, ctx.business.week_start, custom);
  const b = ctx.business.id;
  const rows = await ctx.q<CashAccountRow>("select * from fin_cash_accounts($1,$2,$3)", [b, period.from, period.to]);
  const kinds = await ctx.q<{ kind: string; direction: string; amount: number }>("select * from fin_cash_by_kind($1,$2,$3)", [b, period.from, period.to]);
  const cf = calculateCashFlow(rows);
  const ins = kinds.filter((k) => k.direction === "in");
  const outs = kinds.filter((k) => k.direction === "out");
  const transfersIn = cf.cashIn - ins.reduce((a, k) => a + k.amount, 0);
  const operatingIn = ins.filter((k) => k.kind === "customer_payment" || k.kind === "other_income").reduce((a, k) => a + k.amount, 0);
  const financingIn = ins.filter((k) => !["customer_payment", "other_income"].includes(k.kind)).reduce((a, k) => a + k.amount, 0);
  void IN_KINDS;
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <PeriodSelector value={key} basePath="/money?tab=cashflow" from={custom?.from} to={custom?.to} today={today} />
        <span className="text-caption text-ink-2">{formatRange(period.from, period.to)}</span>
      </div>
      <p className="text-caption text-ink-2 mb-3">Cash flow is money actually moving, which is different from profit. Buying stock is cash out but not yet a cost; a loan is cash in but not income.</p>
      <div className="grid lg:grid-cols-[1.1fr_1fr] gap-3">
        <Card className="p-5">
          <div className="flex flex-col num">
            <CfRow l="Opening balance" v={cf.opening} strong />
            <div className="text-overline uppercase font-semibold text-ink-2 mt-4 mb-1">Money in</div>
            {ins.map((k) => <CfRow key={k.kind} l={KIND[k.kind]} v={k.amount} />)}
            {ins.length === 0 && <p className="text-caption text-ink-3 py-1">None</p>}
            <div className="text-overline uppercase font-semibold text-ink-2 mt-4 mb-1">Money out</div>
            {outs.map((k) => <CfRow key={k.kind} l={KIND[k.kind]} v={-k.amount} />)}
            {outs.length === 0 && <p className="text-caption text-ink-3 py-1">None</p>}
            <div className="border-t border-hairline-strong mt-3 pt-3"><CfRow l="Closing balance" v={cf.closing} strong /></div>
            <CfRow l="Net change" v={cf.closing - cf.opening} muted />
          </div>
          {!cf.reconciles && <p className="text-caption text-negative mt-2">Balances don&apos;t reconcile. Please report this.</p>}
          {transfersIn !== 0 && <p className="text-caption text-ink-3 mt-2">Transfers between your own accounts are left out; they don&apos;t change your total.</p>}
        </Card>
        <div className="flex flex-col gap-3">
          <Card className="p-5">
            <div className="text-caption font-medium text-ink-2">Where the money came from</div>
            <div className="mt-3 flex flex-col gap-2 text-body num">
              <CfRow l="Trading (customers, other income)" v={operatingIn} />
              <CfRow l="Loans and money you put in" v={financingIn} />
            </div>
          </Card>
          <Card className="overflow-hidden">
            <table className="w-full text-body num">
              <thead><tr className="text-caption text-ink-2 text-left"><th className="font-medium py-2.5 pl-5">Account</th><th className="font-medium text-right">In</th><th className="font-medium text-right">Out</th><th className="font-medium text-right pr-5">Closing</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.account_id} className="border-t border-hairline"><td className="py-2.5 pl-5">{r.name}</td><td className="text-right"><Money value={r.cash_in} compact /></td><td className="text-right"><Money value={r.cash_out} compact /></td><td className="text-right pr-5 font-medium"><Money value={r.closing} /></td></tr>
              ))}</tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}

function CfRow({ l, v, strong, muted }: { l: string; v: number; strong?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3 py-1", strong && "font-semibold", muted && "text-ink-2 text-caption")}>
      <span className={strong ? "" : "text-ink-2"}>{l}</span>
      <span className={cn(v < 0 && !strong && "text-ink")}><Money value={v} signed={!strong} /></span>
    </div>
  );
}
