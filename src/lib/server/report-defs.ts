import "server-only";
// Report definitions: each turns (business, params) into a ReportData. The same object is rendered
// on screen and exported to PDF, CSV and Excel, so every format always shows identical numbers.
import type { Ctx } from "./session";
import { loadPnl, loadWeeklyReport, type ExpenseRow, type ProductRow } from "./reports";
import type { ReportData, ReportParams, Section, Row, Column, KeyFigure } from "@/lib/reports/types";
import { parsePeriodParams } from "@/lib/period-params";
import {
  ageing, bucketSeries, buckets, businessSummary, calculateBudgetVariance, calculateCashFlow, calculatePnl,
  endOfMonth, formatDate, formatRange, previousComparable, resolvePeriod, startOfMonth, todayIn, addMonths,
  type CashAccountRow, type DayRow, type Period, type PeriodKey, type PnlInputs,
} from "@/lib/finance";

export const REPORTS: Record<string, { title: string; description: string; defaultPeriod: string }> = {
  pnl: { title: "Profit & loss", description: "Revenue, cost of goods, expenses and net profit.", defaultPeriod: "this_month" },
  sales: { title: "Sales report", description: "Every sale with what was paid and what's still owed.", defaultPeriod: "this_month" },
  expenses: { title: "Expense report", description: "Expenses by category, including recurring costs' share.", defaultPeriod: "this_month" },
  cashflow: { title: "Cash flow report", description: "Money in and out by type and by account.", defaultPeriod: "this_month" },
  products: { title: "Product profitability", description: "Units, revenue, cost and margin per product.", defaultPeriod: "this_month" },
  receivables: { title: "Accounts receivable", description: "What customers owe you, by age.", defaultPeriod: "today" },
  payables: { title: "Accounts payable", description: "What you owe suppliers, by age.", defaultPeriod: "today" },
  inventory: { title: "Inventory report", description: "Stock in and out, closing quantity and value.", defaultPeriod: "this_month" },
  weekly: { title: "Weekly business report", description: "The week in numbers and in plain English.", defaultPeriod: "this_week" },
  monthly: { title: "Monthly business report", description: "The month in numbers, week by week.", defaultPeriod: "this_month" },
  budget: { title: "Budget vs actual", description: "How each line did against its monthly budget.", defaultPeriod: "this_month" },
};

const col = (key: string, label: string, type: Column["type"], width?: number): Column => ({ key, label, type, width });
const generatedAt = () => new Date().toISOString();

function periodFrom(ctx: Ctx, params: ReportParams, fallback: string) {
  const today = todayIn(ctx.business.timezone);
  const { key, custom } = parsePeriodParams(params, fallback);
  return { today, period: resolvePeriod(key as PeriodKey, today, ctx.business.week_start, custom) };
}

function monthFrom(ctx: Ctx, params: ReportParams) {
  const today = todayIn(ctx.business.timezone);
  const m = params.month && /^\d{4}-\d{2}$/.test(params.month) ? params.month : today.slice(0, 7);
  const from = `${m}-01`;
  const to = endOfMonth(from) > today ? today : endOfMonth(from);
  return { today, month: m, from, fullTo: endOfMonth(from), to, isCurrent: m === today.slice(0, 7) };
}

/** Apply search and recompute totals. */
export function finalize(r: ReportData, q?: string): ReportData {
  const needle = q?.trim().toLowerCase();
  for (const s of r.sections) {
    if (needle && s.searchable) {
      const textCols = s.columns.filter((c) => c.type === "text" || c.type === "date").map((c) => c.key);
      s.rows = s.rows.filter((row) => textCols.some((k) => String(row[k] ?? "").toLowerCase().includes(needle)));
    }
    if (s.autoTotal) {
      const t: Row = { _style: "total" };
      s.columns.forEach((c, i) => {
        if (i === 0) t[c.key] = `Total (${s.rows.length})`;
        else if ((s.totalTypes ?? ["money", "qty", "int"]).includes(c.type)) t[c.key] = s.rows.reduce((a, row) => a + (Number(row[c.key]) || 0), 0);
      });
      s.totals = t;
    }
  }
  return r;
}

export async function buildReport(ctx: Ctx, kind: string, params: ReportParams): Promise<ReportData | null> {
  const b = ctx.business.id;
  const base = { business: ctx.business.name, currency: ctx.business.currency, generatedAt: generatedAt() };
  const def = REPORTS[kind];
  if (!def) return null;

  switch (kind) {
    // ---------------------------------------------------------------- P&L
    case "pnl": {
      const { period } = periodFrom(ctx, params, def.defaultPeriod);
      const prev = previousComparable(period);
      const { pnl: p, prevPnl: q, expenses, prevExpenses } = await loadPnl(ctx, period, prev);
      const cats = (kind: string) => [...new Map([...expenses, ...prevExpenses].filter((e) => e.kind === kind).map((e) => [e.category_id, e.name])).entries()];
      const amt = (rows: ExpenseRow[], id: string) => rows.find((e) => e.category_id === id)?.total ?? 0;
      const L = (label: string, a: number | null, bb: number | null, _style: Row["_style"] = "normal", pct = false): Row => ({ label, cur: a, prev: bb, _style, _pct: pct });
      const rows: Row[] = [
        L("Revenue", null, null, "header"),
        L("Gross sales", p.grossSales, q.grossSales, "indent"),
        L("Discounts", -p.discounts, -q.discounts, "indent"),
        L("Returns and refunds", -p.returns, -q.returns, "indent"),
        L("Net revenue", p.revenue, q.revenue, "total"),
        L("Cost of goods sold", -p.cogs, -q.cogs),
        ...(p.excludedRevenue || q.excludedRevenue ? [L("Sales with missing cost (left out of profit)", -p.excludedRevenue, -q.excludedRevenue, "warning")] : []),
        L("Gross profit", p.grossProfit, q.grossProfit, "total"),
        L("Gross margin", p.grossMargin, q.grossMargin, "muted", true),
        L("Operating expenses", null, null, "header"),
        ...cats("operating").map(([id, n]) => L(n, -amt(expenses, id), -amt(prevExpenses, id), "indent")),
        L("Total operating expenses", -p.operatingExpenses, -q.operatingExpenses, "total"),
        L("Operating profit", p.operatingProfit, q.operatingProfit, "total"),
        ...(p.otherIncome || q.otherIncome || cats("other_expense").length || p.incomeTax || q.incomeTax ? [L("Other items", null, null, "header")] : []),
        ...(p.otherIncome || q.otherIncome ? [L("Other income", p.otherIncome, q.otherIncome, "indent")] : []),
        ...cats("other_expense").map(([id, n]) => L(n, -amt(expenses, id), -amt(prevExpenses, id), "indent")),
        ...(p.incomeTax || q.incomeTax ? [L("Income tax", -p.incomeTax, -q.incomeTax, "indent")] : []),
        L("Net profit", p.netProfit, q.netProfit, "grand"),
        L("Net margin", p.netMargin, q.netMargin, "muted", true),
      ];
      return finalize({
        ...base, kind, title: def.title, from: period.from, to: period.to, status: p.status, statusNote: p.statusNote, periodMode: "range",
        figures: [
          { label: "Net revenue", value: p.revenue, type: "money" }, { label: "Gross profit", value: p.grossProfit, type: "money", sub: `${pctText(p.grossMargin)} margin` },
          { label: "Operating expenses", value: p.operatingExpenses, type: "money" }, { label: "Net profit", value: p.netProfit, type: "money", tone: p.netProfit < 0 ? "negative" : undefined, sub: `${pctText(p.netMargin)} margin` },
        ],
        sections: [{ kind: "statement", columns: [col("label", "", "text", 3), col("cur", capital(period.label), "money"), col("prev", capital(prev.label), "money")], rows,
          note: p.vatCollected ? `VAT collected (owed to the tax authority, not revenue): ${fmt(p.vatCollected)}.` : "Recurring expenses are included as their share for these dates, paid or not. Buying stock is not an expense until it's sold." }],
      });
    }

    // ---------------------------------------------------------------- Sales
    case "sales": {
      const { period } = periodFrom(ctx, params, def.defaultPeriod);
      const [pnlRow] = await ctx.q<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, period.from, period.to]);
      const p = calculatePnl(pnlRow.r);
      const status = params.status;
      const rows = await ctx.q<{ id: string; date: string; invoice_no: string; customer: string; items: string; net: number; vat_amount: number; total: number; returned: number; paid: number; outstanding: number; due_date: string; voided_at: string | null; salesperson: string | null }>(`
        select s.id, s.date, s.invoice_no, c.name customer, s.net, s.vat_amount, s.total, s.due_date, s.voided_at,
          app_sale_returned(s.id) returned, (app_sale_paid(s.id) - app_sale_refunded(s.id)) paid, app_sale_outstanding(s.id) outstanding,
          coalesce(pr.display_name, pr.full_name) salesperson,
          (select string_agg(p.name || ' ×' || trim(to_char(si.qty, 'FM999999990.###')), ', ' order by si.created_at) from sale_items si join products p on p.id = si.product_id where si.sale_id = s.id) items
        from sales s join customers c on c.id = s.customer_id left join profiles pr on pr.user_id = s.salesperson_id
        where s.business_id = $1 and s.date between $2 and $3 and s.voided_at is null
          and ($4::uuid is null or s.customer_id = $4) and ($5::uuid is null or exists (select 1 from sale_items x where x.sale_id = s.id and x.product_id = $5))
        order by s.date, s.invoice_no`, [b, period.from, period.to, params.customer || null, params.product || null]);
      const today = todayIn(ctx.business.timezone);
      const st = (r: typeof rows[number]) => r.outstanding <= 0 ? "Paid" : r.due_date < today ? "Overdue" : r.paid > 0 ? "Part paid" : "Unpaid";
      const filtered = rows.filter((r) => !status || status === "all" || (status === "unpaid" ? r.outstanding > 0 : status === "overdue" ? st(r) === "Overdue" : status === "paid" ? r.outstanding <= 0 : true));
      const customers = await ctx.q<{ id: string; name: string }>("select id, name from customers where business_id = $1 order by is_walk_in desc, name", [b]);
      const products = await ctx.q<{ id: string; name: string }>("select id, name from products where business_id = $1 and is_sellable order by name", [b]);
      const byProduct = await ctx.q<{ label: string; units: number; revenue: number; gross_profit: number; missing_lines: number }>("select * from fin_sales_breakdown($1,$2,$3,'product')", [b, period.from, period.to]);
      const avg = p.salesCount ? Math.round(p.revenue / p.salesCount) : null;
      return finalize({
        ...base, kind, title: def.title, from: period.from, to: period.to, status: p.status, statusNote: p.statusNote, periodMode: "range",
        filters: [
          { key: "customer", label: "Customer", options: [{ value: "", label: "All customers" }, ...customers.map((c) => ({ value: c.id, label: c.name }))] },
          { key: "product", label: "Product", options: [{ value: "", label: "All products" }, ...products.map((c) => ({ value: c.id, label: c.name }))] },
          { key: "status", label: "Payment", options: [{ value: "", label: "Any payment status" }, { value: "paid", label: "Paid" }, { value: "unpaid", label: "Not fully paid" }, { value: "overdue", label: "Overdue" }] },
        ],
        figures: [
          { label: "Net revenue", value: p.revenue, type: "money", sub: "after discounts & returns, excl. VAT" },
          { label: "Sales", value: p.salesCount, type: "int" },
          { label: "Average sale", value: avg, type: "money" },
          { label: "Still owed", value: rows.reduce((a, r) => a + Math.max(0, r.outstanding), 0), type: "money" },
        ],
        sections: [
          { title: "Sales", searchable: true, autoTotal: true, columns: [col("date", "Date", "date"), col("invoice", "Invoice", "text"), col("customer", "Customer", "text", 2), col("items", "Items", "text", 3),
              col("net", "Net (excl. VAT)", "money"), col("total", "Total", "money"), col("paid", "Paid", "money"), col("outstanding", "Balance", "money"), col("status", "Status", "text")],
            rows: filtered.map((r) => ({ date: r.date, invoice: r.invoice_no, customer: r.customer, items: r.items, net: r.net, total: r.total, paid: r.paid, outstanding: Math.max(0, r.outstanding), status: st(r), _href: `/sales/${r.id}` })) },
          { title: "By product", columns: [col("label", "Product", "text", 2), col("units", "Units", "qty"), col("revenue", "Revenue", "money"), col("gross_profit", "Gross profit", "money"), col("margin", "Margin", "pct")],
            autoTotal: true, rows: byProduct.map((x) => ({ label: x.label, units: x.units, revenue: x.revenue, gross_profit: x.missing_lines ? null : x.gross_profit, margin: x.missing_lines || !x.revenue ? null : x.gross_profit / x.revenue })) },
        ],
      }, params.q);
    }

    // ---------------------------------------------------------------- Expenses
    case "expenses": {
      const { period } = periodFrom(ctx, params, def.defaultPeriod);
      const cat = params.category || null;
      const breakdown = await ctx.q<ExpenseRow>("select * from fin_expense_breakdown($1,$2,$3)", [b, period.from, period.to]);
      const items = await ctx.q<{ date: string; name: string; category: string; vendor: string | null; account: string | null; amount: number }>(`
        select e.date, e.name, c.name category, e.vendor, a.name account, e.amount from expenses e join expense_categories c on c.id = e.category_id
        left join cash_accounts a on a.id = e.cash_account_id
        where e.business_id = $1 and e.voided_at is null and e.date between $2 and $3 and ($4::uuid is null or e.category_id = $4) order by e.date, e.created_at`, [b, period.from, period.to, cat]);
      const recurring = await ctx.q<{ name: string; category: string; category_id: string; amount: number }>(`
        select re.name, c.name category, c.id category_id, x.amount from fin_recurring_accrual($1,$2,$3) x join recurring_expenses re on re.id = x.recurring_expense_id join expense_categories c on c.id = re.category_id
        where ($4::uuid is null or c.id = $4) order by x.amount desc`, [b, period.from, period.to, cat]);
      const cats = await ctx.q<{ id: string; name: string }>("select id, name from expense_categories where business_id = $1 order by sort_order, name", [b]);
      const op = breakdown.filter((e) => e.kind === "operating" && (!cat || e.category_id === cat));
      const total = op.reduce((a, e) => a + e.total, 0);
      return finalize({
        ...base, kind, title: def.title, from: period.from, to: period.to, status: "complete", periodMode: "range",
        filters: [{ key: "category", label: "Category", options: [{ value: "", label: "All categories" }, ...cats.map((c) => ({ value: c.id, label: c.name }))] }],
        figures: [
          { label: "Operating expenses", value: total, type: "money" },
          { label: "One-time", value: op.reduce((a, e) => a + e.one_time, 0), type: "money" },
          { label: "Recurring share", value: op.reduce((a, e) => a + e.recurring, 0), type: "money" },
          { label: "Largest category", value: op[0]?.total ?? null, type: "money", sub: op[0]?.name },
        ],
        sections: [
          { title: "By category", autoTotal: true, columns: [col("name", "Category", "text", 2), col("one_time", "One-time", "money"), col("recurring", "Recurring share", "money"), col("total", "Total", "money"), col("share", "Share", "pct")],
            rows: breakdown.filter((e) => !cat || e.category_id === cat).map((e) => ({ name: e.kind === "operating" ? e.name : `${e.name} (not operating)`, one_time: e.one_time, recurring: e.recurring, total: e.total, share: e.kind === "operating" && total ? e.total / total : null })) },
          { title: "One-time expenses", searchable: true, autoTotal: true, columns: [col("date", "Date", "date"), col("name", "Description", "text", 2), col("category", "Category", "text"), col("vendor", "Paid to", "text"), col("account", "From", "text"), col("amount", "Amount", "money")],
            rows: items.map((e) => ({ ...e, vendor: e.vendor ?? "" })) },
          { title: "Recurring expenses (share for these dates)", searchable: true, autoTotal: true, columns: [col("name", "Expense", "text", 2), col("category", "Category", "text"), col("amount", "Amount", "money")],
            rows: recurring.map((r) => ({ name: r.name, category: r.category, amount: r.amount })) },
        ],
      }, params.q);
    }

    // ---------------------------------------------------------------- Cash flow
    case "cashflow": {
      const { period } = periodFrom(ctx, params, def.defaultPeriod);
      const accounts = await ctx.q<CashAccountRow>("select * from fin_cash_accounts($1,$2,$3)", [b, period.from, period.to]);
      const kinds = await ctx.q<{ kind: string; direction: string; amount: number }>("select * from fin_cash_by_kind($1,$2,$3)", [b, period.from, period.to]);
      const cf = calculateCashFlow(accounts);
      const rows: Row[] = [
        { label: "Opening balance", amount: cf.opening, _style: "total" },
        { label: "Money in", amount: null, _style: "header" },
        ...kinds.filter((k) => k.direction === "in").map((k) => ({ label: CASH_KIND[k.kind] ?? k.kind, amount: k.amount, _style: "indent" as const })),
        { label: "Money out", amount: null, _style: "header" },
        ...kinds.filter((k) => k.direction === "out").map((k) => ({ label: CASH_KIND[k.kind] ?? k.kind, amount: -k.amount, _style: "indent" as const })),
        { label: "Net change", amount: cf.closing - cf.opening, _style: "total" },
        { label: "Closing balance", amount: cf.closing, _style: "grand" },
      ];
      return finalize({
        ...base, kind, title: def.title, from: period.from, to: period.to, status: cf.reconciles ? "complete" : "partial", periodMode: "range",
        figures: [{ label: "Opening", value: cf.opening, type: "money" }, { label: "Money in", value: kinds.filter((k) => k.direction === "in").reduce((a, k) => a + k.amount, 0), type: "money" },
          { label: "Money out", value: kinds.filter((k) => k.direction === "out").reduce((a, k) => a + k.amount, 0), type: "money" }, { label: "Closing", value: cf.closing, type: "money" }],
        sections: [
          { kind: "statement", columns: [col("label", "", "text", 3), col("amount", "Amount", "money")], rows, note: "Transfers between your own accounts are left out; they don't change your total." },
          { title: "By account", autoTotal: true, columns: [col("name", "Account", "text", 2), col("opening", "Opening", "money"), col("cash_in", "In", "money"), col("cash_out", "Out", "money"), col("closing", "Closing", "money")],
            rows: accounts.map((a) => ({ name: a.name, opening: a.opening, cash_in: a.cash_in, cash_out: a.cash_out, closing: a.closing })), note: "Account totals include transfers between your accounts." },
        ],
      });
    }

    // ---------------------------------------------------------------- Products
    case "products": {
      const { period } = periodFrom(ctx, params, def.defaultPeriod);
      const rows = await ctx.q<ProductRow>("select * from fin_product_performance($1,$2,$3)", [b, period.from, period.to]);
      const status = rows.some((r) => r.missing_lines) ? "missing_data" : rows.some((r) => r.estimated_lines) ? "partial" : "complete";
      return finalize({
        ...base, kind, title: def.title, from: period.from, to: period.to, status, periodMode: "range",
        sections: [{ searchable: true, autoTotal: true, columns: [col("name", "Product", "text", 2), col("units", "Units", "qty"), col("revenue", "Revenue", "money"), col("cogs", "Cost of goods", "money"),
            col("gross_profit", "Gross profit", "money"), col("margin", "Margin", "pct"), col("asp", "Avg price", "money"), col("avg_cost", "Avg cost", "money")],
          rows: rows.map((r) => ({ name: r.name, units: r.units, revenue: r.revenue, cogs: r.missing_lines ? null : r.cogs, gross_profit: r.missing_lines ? null : r.gross_profit,
            margin: r.missing_lines || !r.revenue ? null : r.gross_profit / r.revenue, asp: r.units ? Math.round(r.revenue / r.units) : null, avg_cost: r.units && !r.missing_lines ? Math.round(r.cogs / r.units) : null,
            _href: `/inventory/products/${r.product_id}` })),
          note: "Net of returns. Products with missing cost show no profit until the cost is added." }],
      }, params.q);
    }

    // ---------------------------------------------------------------- Receivables / Payables
    case "receivables":
    case "payables": {
      const today = todayIn(ctx.business.timezone);
      const asAt = params.to && /^\d{4}-\d{2}-\d{2}$/.test(params.to) ? params.to : today;
      const isRec = kind === "receivables";
      const rows = isRec
        ? await ctx.q<{ sale_id: string; invoice_no: string; customer_id: string; customer_name: string; date: string; due_date: string; total: number; paid: number; outstanding: number; days_overdue: number; status: string }>("select * from fin_receivables($1,$2)", [b, asAt])
        : await ctx.q<{ purchase_id: string; supplier_invoice_no: string | null; supplier_id: string; supplier_name: string; date: string; due_date: string; total: number; paid: number; outstanding: number; days_overdue: number; status: string }>("select * from fin_payables($1,$2)", [b, asAt]);
      const a = ageing(rows);
      type AnyRow = (typeof rows)[number] & { customer_name?: string; supplier_name?: string; invoice_no?: string; supplier_invoice_no?: string | null; sale_id?: string; customer_id?: string; supplier_id?: string };
      const party = (r: AnyRow) => (isRec ? r.customer_name! : r.supplier_name!);
      const partyId = (r: AnyRow) => (isRec ? r.customer_id! : r.supplier_id!);
      const groups = new Map<string, Row>();
      for (const r of rows as AnyRow[]) {
        const g = groups.get(partyId(r)) ?? { name: party(r), current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0, total: 0, _href: `/money/${isRec ? "customers" : "suppliers"}/${partyId(r)}` };
        const bucket = r.days_overdue <= 0 ? "current" : r.days_overdue <= 30 ? "d1_30" : r.days_overdue <= 60 ? "d31_60" : r.days_overdue <= 90 ? "d61_90" : "d90p";
        g[bucket] = (g[bucket] as number) + r.outstanding; g.total = (g.total as number) + r.outstanding;
        groups.set(partyId(r), g);
      }
      const ageCols = [col("current", "Not yet due", "money"), col("d1_30", "1–30 days", "money"), col("d31_60", "31–60", "money"), col("d61_90", "61–90", "money"), col("d90p", "90+", "money"), col("total", "Total", "money")];
      const STATUS: Record<string, string> = { unpaid: "Unpaid", partially_paid: "Part paid", overdue: "Overdue", paid: "Paid" };
      return finalize({
        ...base, kind, title: def.title, from: asAt, to: asAt, asAt: true, status: "complete", periodMode: "asAt",
        figures: [{ label: isRec ? "Customers owe you" : "You owe suppliers", value: a.total, type: "money" }, { label: "Overdue", value: a.overdue, type: "money", tone: a.overdue ? "negative" : undefined, sub: `${a.overdueCount} of ${a.count} ${isRec ? "invoices" : "bills"}` },
          { label: "More than 90 days late", value: a.d90p, type: "money", tone: a.d90p ? "negative" : undefined }],
        sections: [
          { title: isRec ? "By customer" : "By supplier", searchable: true, autoTotal: true, columns: [col("name", isRec ? "Customer" : "Supplier", "text", 2), ...ageCols], rows: [...groups.values()].sort((x, y) => (y.total as number) - (x.total as number)) },
          { title: isRec ? "Open invoices" : "Open bills", searchable: true, autoTotal: true,
            columns: [col("party", isRec ? "Customer" : "Supplier", "text", 2), col("ref", isRec ? "Invoice" : "Their invoice", "text"), col("date", "Date", "date"), col("due", "Due", "date"), col("total", "Total", "money"), col("paid", "Paid", "money"), col("outstanding", "Outstanding", "money"), col("late", "Days late", "int"), col("status", "Status", "text")],
            rows: (rows as AnyRow[]).map((r) => ({ party: party(r), ref: isRec ? r.invoice_no : r.supplier_invoice_no ?? "", date: r.date, due: r.due_date, total: r.total, paid: r.paid, outstanding: r.outstanding, late: Math.max(0, r.days_overdue), status: STATUS[r.status] ?? r.status, _href: isRec ? `/sales/${r.sale_id}` : undefined })) },
        ],
      }, params.q);
    }

    // ---------------------------------------------------------------- Inventory
    case "inventory": {
      const { period } = periodFrom(ctx, params, def.defaultPeriod);
      const rows = await ctx.q<{ product_id: string; name: string; unit: string; is_sellable: boolean; opening: number; purchased: number; produced: number; used: number; sold: number; returned: number; adjusted: number; closing: number; closing_value: number; min_stock: number }>(
        "select * from fin_inventory_summary($1,$2,$3)", [b, period.from, period.to]);
      const view = params.type === "raw" ? rows.filter((r) => !r.is_sellable) : params.type === "sell" ? rows.filter((r) => r.is_sellable) : rows;
      const cols = [col("name", "Product", "text", 2), col("unit", "Unit", "text"), col("opening", "Opening", "qty"), col("purchased", "Bought", "qty"), col("produced", "Made", "qty"), col("used", "Used", "qty"),
        col("sold", "Sold", "qty"), col("returned", "Returned", "qty"), col("adjusted", "Adjusted", "qty"), col("closing", "Closing", "qty"), col("closing_value", "Value", "money")];
      const toRow = (r: (typeof rows)[number]): Row => ({ ...r, unit: r.unit === "unit" ? "" : r.unit, _href: `/inventory/products/${r.product_id}`, _style: r.min_stock > 0 && r.closing <= r.min_stock ? "warning" : "normal" });
      const low = rows.filter((r) => r.is_sellable && r.min_stock > 0 && r.closing <= r.min_stock);
      return finalize({
        ...base, kind, title: def.title, from: period.from, to: period.to, status: "complete", periodMode: "range",
        filters: [{ key: "type", label: "Type", options: [{ value: "", label: "Everything" }, { value: "sell", label: "Products you sell" }, { value: "raw", label: "Raw materials" }] }],
        figures: [{ label: "Stock value at end", value: view.reduce((a, r) => a + r.closing_value, 0), type: "money" }, { label: "Products", value: view.length, type: "int" },
          { label: "Running low", value: low.length, type: "int", tone: low.length ? "warning" : undefined }],
        sections: [
          { title: "Products you sell", searchable: true, autoTotal: true, totalTypes: ["money"], columns: cols, rows: view.filter((r) => r.is_sellable).map(toRow) },
          { title: "Raw materials & packaging", searchable: true, autoTotal: true, totalTypes: ["money"], columns: cols, rows: view.filter((r) => !r.is_sellable).map(toRow) },
        ].filter((s) => s.rows.length > 0) as Section[],
      }, params.q);
    }

    // ---------------------------------------------------------------- Weekly
    case "weekly": {
      const r = await loadWeeklyReport(ctx, params.week);
      return finalize({
        ...base, kind, title: def.title, from: r.period.from, to: r.period.to, status: r.pnl.status, statusNote: r.pnl.statusNote, periodMode: "week",
        summary: r.summary.map((s) => s.text),
        figures: headlineFigures(r.pnl, r.cash.closing, r.rec.total, r.pay.total),
        sections: [
          pnlSummarySection(r.pnl, "Performance"),
          { title: "Cash and balances", kind: "statement", columns: [col("label", "", "text", 3), col("amount", "Amount", "money")], rows: [
            { label: "Opening cash", amount: r.cash.opening }, { label: "Cash in", amount: r.cash.cashIn, _style: "indent" }, { label: "Cash out", amount: -r.cash.cashOut, _style: "indent" },
            { label: "Closing cash", amount: r.cash.closing, _style: "total" }, { label: "Customers owe you", amount: r.rec.total }, { label: "You owe suppliers", amount: r.pay.total }] },
          { title: "Expenses by category", autoTotal: true, columns: [col("name", "Category", "text", 2), col("total", "Amount", "money")], rows: r.operating.map((e) => ({ name: e.name, total: e.total })) },
          { title: "Products", autoTotal: true, columns: [col("name", "Product", "text", 2), col("units", "Sold", "qty"), col("revenue", "Revenue", "money"), col("profit", "Gross profit", "money")],
            rows: r.products.map((p) => ({ name: p.name, units: p.units, revenue: p.revenue, profit: p.missing_lines ? null : p.gross_profit })) },
        ],
      });
    }

    // ---------------------------------------------------------------- Monthly
    case "monthly": {
      const m = monthFrom(ctx, params);
      const period: Period = { key: "custom", from: m.from, to: m.to, label: "This month" };
      const prev: Period = m.isCurrent ? previousComparable({ ...period, key: "this_month" }) : { key: "custom", from: startOfMonth(addMonths(m.from, -1)), to: endOfMonth(addMonths(m.from, -1)), label: "last month" };
      const { pnl: p, prevPnl, expenses } = await loadPnl(ctx, period, prev);
      const cash = calculateCashFlow(await ctx.q<CashAccountRow>("select * from fin_cash_accounts($1,$2,$3)", [b, period.from, period.to]));
      const rec = ageing(await ctx.q<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_receivables($1,$2)", [b, period.to]));
      const pay = ageing(await ctx.q<{ outstanding: number; days_overdue: number; status: string }>("select * from fin_payables($1,$2)", [b, period.to]));
      const products = await ctx.q<ProductRow>("select * from fin_product_performance($1,$2,$3)", [b, period.from, period.to]);
      const days = await ctx.q<DayRow>("select * from fin_daily_series($1,$2,$3)", [b, period.from, period.to]);
      const weeks = bucketSeries(days, buckets(period.from, period.to, "week", ctx.business.week_start));
      const op = expenses.filter((e) => e.kind === "operating");
      const byProfit = products.filter((x) => !x.missing_lines).sort((a, z) => z.gross_profit - a.gross_profit);
      const summary = businessSummary({ periodWord: m.isCurrent ? "so far this month" : "this month", prevWord: m.isCurrent ? "the same days last month" : "the month before", pnl: p, prev: prevPnl,
        topExpense: op[0] ? { name: op[0].name, amount: op[0].total } : null, topRevenueProduct: products[0] ? { name: products[0].name, revenue: products[0].revenue } : null,
        topProfitProduct: byProfit[0] ? { name: byProfit[0].name, profit: byProfit[0].gross_profit } : null, receivables: { total: rec.total, overdue: rec.overdue } });
      return finalize({
        ...base, kind, title: def.title, from: period.from, to: period.to, status: p.status, statusNote: p.statusNote, periodMode: "month",
        summary: summary.map((s) => s.text),
        figures: headlineFigures(p, cash.closing, rec.total, pay.total),
        sections: [
          pnlSummarySection(p, "Performance"),
          { title: "Week by week", autoTotal: true, columns: [col("label", "Week of", "text"), col("revenue", "Revenue", "money"), col("cogs", "Cost of goods", "money"), col("grossProfit", "Gross profit", "money"), col("opex", "Expenses", "money"), col("netProfit", "Net profit", "money"), col("cashIn", "Cash in", "money"), col("cashOut", "Cash out", "money")],
            rows: weeks.map((w) => ({ label: `${formatDate(w.from)} – ${formatDate(w.to)}`, revenue: w.revenue, cogs: w.cogs, grossProfit: w.grossProfit, opex: w.opex, netProfit: w.netProfit, cashIn: w.cashIn, cashOut: w.cashOut, _style: w.netProfit < 0 ? "warning" : "normal" })) },
          { title: "Expenses by category", autoTotal: true, columns: [col("name", "Category", "text", 2), col("total", "Amount", "money")], rows: op.map((e) => ({ name: e.name, total: e.total })) },
          { title: "Products", autoTotal: true, columns: [col("name", "Product", "text", 2), col("units", "Sold", "qty"), col("revenue", "Revenue", "money"), col("profit", "Gross profit", "money"), col("margin", "Margin", "pct")],
            rows: products.map((x) => ({ name: x.name, units: x.units, revenue: x.revenue, profit: x.missing_lines ? null : x.gross_profit, margin: x.missing_lines || !x.revenue ? null : x.gross_profit / x.revenue })) },
        ],
      });
    }

    // ---------------------------------------------------------------- Budget vs actual
    case "budget": {
      const m = monthFrom(ctx, params);
      const lines = await loadBudgetLines(ctx, m.month);
      const rows: Row[] = lines.map((l) => ({ label: l.label, budget: l.budget, actual: l.actual, variance: l.budget === null ? null : l.variance, pct: l.ratio, status: l.statusText, _style: l.bad ? "warning" : l.isTotal ? "total" : "normal" }));
      const set = lines.filter((l) => l.budget !== null && !l.isTotal);
      return finalize({
        ...base, kind, title: def.title, from: m.from, to: m.to, status: "complete", periodMode: "month",
        figures: [
          { label: "Lines with a budget", value: set.length, type: "int" },
          { label: "Over budget", value: set.filter((l) => l.bad && l.line !== "revenue").length, type: "int", tone: set.some((l) => l.bad && l.line !== "revenue") ? "warning" : undefined },
          { label: "Revenue vs budget", value: lines.find((l) => l.line === "revenue")?.ratio ?? null, type: "pct" },
        ],
        sections: [{ columns: [col("label", "Line", "text", 2), col("budget", "Budget", "money"), col("actual", m.isCurrent ? "Actual so far" : "Actual", "money"), col("variance", "Variance", "money"), col("pct", "Variance %", "pct"), col("status", "", "text")], rows,
          note: m.isCurrent ? "This month isn't over yet, so actuals are month-to-date. Expenses include each recurring cost's share so far." : "Expenses include each recurring cost's share for the month." }],
      });
    }
  }
  return null;
}

// ---------- Budget lines (shared by the report and the budget editor) ----------
export interface BudgetLine { line: "revenue" | "cogs" | "category"; category_id: string | null; label: string; budget: number | null; actual: number; variance: number; ratio: number | null; bad: boolean; statusText: string; isTotal?: boolean }

export async function loadBudgetLines(ctx: Ctx, month: string): Promise<BudgetLine[]> {
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  const from = `${month}-01`;
  const to = endOfMonth(from) > today ? today : endOfMonth(from);
  const [pnlRow] = await ctx.q<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, from, to]);
  const p = calculatePnl(pnlRow.r);
  const exp = await ctx.q<ExpenseRow>("select * from fin_expense_breakdown($1,$2,$3)", [b, from, to]);
  const budgets = await ctx.q<{ line: string; category_id: string | null; amount: number }>("select line, category_id, amount from budgets where business_id = $1 and month = $2", [b, from]);
  const cats = await ctx.q<{ id: string; name: string }>("select id, name from expense_categories where business_id = $1 and kind = 'operating' order by sort_order, name", [b]);
  const bud = (line: string, cat: string | null) => budgets.find((x) => x.line === line && (x.category_id ?? null) === cat)?.amount ?? null;
  const mk = (line: BudgetLine["line"], category_id: string | null, label: string, actual: number, higherIsGood: boolean): BudgetLine => {
    const budget = bud(line, category_id);
    const v = budget === null ? null : calculateBudgetVariance(budget, actual);
    const bad = v ? (higherIsGood ? v.variance < 0 : v.variance > 0) : false;
    const statusText = !v ? "No budget" : v.variance === 0 ? "On budget" : higherIsGood ? (v.variance > 0 ? "Ahead" : "Behind") : v.variance > 0 ? "Over budget" : "Under budget";
    return { line, category_id, label, budget, actual, variance: v?.variance ?? 0, ratio: v?.ratio ?? null, bad, statusText };
  };
  const catLines = cats.map((c) => mk("category", c.id, c.name, exp.find((e) => e.category_id === c.id)?.total ?? 0, false))
    .filter((l) => l.budget !== null || l.actual !== 0);
  const opexBudget = catLines.reduce((a, l) => a + (l.budget ?? 0), 0);
  const opexActual = catLines.reduce((a, l) => a + l.actual, 0);
  const anyCatBudget = catLines.some((l) => l.budget !== null);
  const opexV = calculateBudgetVariance(opexBudget, opexActual);
  return [
    mk("revenue", null, "Revenue", p.revenue, true),
    mk("cogs", null, "Cost of goods sold", p.cogs, false),
    ...catLines,
    { line: "category", category_id: "__total", label: "Total operating expenses", budget: anyCatBudget ? opexBudget : null, actual: opexActual, variance: opexV.variance,
      ratio: anyCatBudget ? opexV.ratio : null, bad: anyCatBudget && opexV.variance > 0, statusText: !anyCatBudget ? "" : opexV.variance > 0 ? "Over budget" : "Under budget", isTotal: true },
  ];
}

// ---------- helpers ----------
const CASH_KIND: Record<string, string> = {
  customer_payment: "Customer payments", supplier_payment: "Supplier payments", expense_payment: "Expenses", recurring_payment: "Recurring expenses (rent, salaries…)",
  direct_cost_payment: "Production costs", other_income: "Other income", capital_injection: "Money you put in", loan_received: "Loans received",
  loan_repayment: "Loan repayments", owner_withdrawal: "Owner withdrawals", tax_payment: "Tax payments", refund: "Refunds to customers",
};
function capital(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function pctText(r: number | null) { return r === null ? "—" : `${(r * 100).toFixed(1)}%`; }
function fmt(k: number) { return "₦" + (k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function headlineFigures(p: ReturnType<typeof calculatePnl>, cash: number, rec: number, pay: number): KeyFigure[] {
  return [
    { label: "Revenue", value: p.revenue, type: "money" },
    { label: "Gross profit", value: p.grossProfit, type: "money", sub: `${pctText(p.grossMargin)} margin` },
    { label: "Net profit", value: p.netProfit, type: "money", sub: `${pctText(p.netMargin)} margin`, tone: p.netProfit < 0 ? "negative" : undefined },
    { label: "Closing cash", value: cash, type: "money" },
    { label: "Customers owe", value: rec, type: "money" },
    { label: "You owe suppliers", value: pay, type: "money" },
  ];
}

function pnlSummarySection(p: ReturnType<typeof calculatePnl>, title: string): Section {
  return {
    title, kind: "statement", columns: [col("label", "", "text", 3), col("amount", "Amount", "money")],
    rows: [
      { label: "Revenue", amount: p.revenue }, { label: "Cost of goods sold", amount: -p.cogs, _style: "indent" },
      ...(p.excludedRevenue ? [{ label: "Sales with missing cost (left out)", amount: -p.excludedRevenue, _style: "warning" as const }] : []),
      { label: "Gross profit", amount: p.grossProfit, _style: "total" }, { label: `Gross margin ${pctText(p.grossMargin)}`, amount: null, _style: "muted" },
      { label: "Operating expenses", amount: -p.operatingExpenses, _style: "indent" },
      ...(p.otherIncome - p.otherExpense - p.incomeTax ? [{ label: "Other items", amount: p.otherIncome - p.otherExpense - p.incomeTax, _style: "indent" as const }] : []),
      { label: "Net profit", amount: p.netProfit, _style: "grand" }, { label: `Net margin ${pctText(p.netMargin)}`, amount: null, _style: "muted" },
    ],
  };
}

export function reportFileName(r: ReportData, ext: string) {
  const slug = r.business.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return `${slug}-${r.kind}-${r.asAt ? r.to : `${r.from}_to_${r.to}`}.${ext}`;
}

export function periodText(r: ReportData) {
  return r.asAt ? `As at ${formatDate(r.to, true)}` : formatRange(r.from, r.to);
}
