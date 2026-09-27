import "server-only";
import type { Ctx } from "./session";
import { loadBudgetLines } from "./report-defs";
import {
  calculatePnl, evaluateAlerts, mergeRules, todayIn, addDays, startOfWeek, diffDays,
  type AlertInputs, type PnlInputs, type CashAccountRow, type Severity, type AlertKind,
} from "@/lib/finance";

export interface AlertRow {
  id: string; kind: AlertKind; severity: Severity; message: string;
  data: { href?: string; costs?: boolean }; read_at: string | null; created_at: string; updated_at: string;
}

// Alerts are re-evaluated at most every few minutes per business, and immediately after anything is posted.
const SYNC_EVERY_MS = 3 * 60_000;
const lastSync = new Map<string, number>();
export function markAlertsStale(businessId: string) { lastSync.delete(businessId); }

const MANAGERS = new Set(["owner", "admin", "accountant"]);

export async function gatherAlertInputs(ctx: Ctx): Promise<AlertInputs> {
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  const weekStart = startOfWeek(today, ctx.business.week_start);
  const lastWeekFrom = addDays(weekStart, -7), lastWeekTo = addDays(weekStart, -1);
  const prior4From = addDays(lastWeekFrom, -28);
  const monthFrom = today.slice(0, 8) + "01";

  return ctx.db(async (db) => {
    const one = async <T,>(sql: string, p: unknown[]) => (await db.query(sql, p)).rows as T[];
    const pnl = async (from: string, to: string) => calculatePnl((await one<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, from, to]))[0].r);

    const cash = await one<CashAccountRow>("select * from fin_cash_accounts($1,$2,$3)", [b, today, today]);
    const receivables = await one<{ outstanding: number; days_overdue: number }>("select * from fin_receivables($1,$2)", [b, today]);
    const payables = await one<{ outstanding: number; days_overdue: number }>("select * from fin_payables($1,$2)", [b, today]);
    const inv = await one<{ product_id: string; name: string; on_hand: number; unit: string; low_stock: boolean; is_sellable: boolean }>("select * from fin_inventory($1)", [b]);
    const [target] = await one<{ amount: number }>(
      "select amount from targets where business_id=$1 and kind='weekly_sales' and effective_from <= $2 order by effective_from desc limit 1", [b, today]);

    // Expenses by category: this week so far, and each of the previous 8 full weeks.
    type Exp = { category_id: string; name: string; total: number; kind: string };
    const thisWeekExp = await one<Exp>("select * from fin_expense_breakdown($1,$2,$3)", [b, weekStart, today]);
    const history: Record<string, number> = {};
    for (let w = 1; w <= 8; w++) {
      const from = addDays(weekStart, -7 * w);
      for (const e of await one<Exp>("select * from fin_expense_breakdown($1,$2,$3)", [b, from, addDays(from, 6)])) {
        if (e.kind === "operating") history[e.category_id] = (history[e.category_id] ?? 0) + Number(e.total);
      }
    }

    const thisWeek = await pnl(weekStart, today);
    const lastWeek = await pnl(lastWeekFrom, lastWeekTo);
    const prior4 = await pnl(prior4From, addDays(lastWeekFrom, -1));
    const month = await pnl(monthFrom, today);

    return {
      today,
      cash: { total: cash.reduce((a, r) => a + Number(r.closing), 0) },
      receivables: receivables.map((r) => ({ outstanding: Number(r.outstanding), days_overdue: Number(r.days_overdue) })),
      payables: payables.map((r) => ({ outstanding: Number(r.outstanding), days_overdue: Number(r.days_overdue) })),
      expenses: thisWeekExp.filter((e) => e.kind === "operating").map((e) => ({
        category_id: e.category_id, name: e.name, thisWeek: Number(e.total), avg8: Math.round((history[e.category_id] ?? 0) / 8),
      })),
      weeklyTarget: { target: target ? Number(target.amount) : null, salesSoFar: thisWeek.revenue, daysElapsed: diffDays(today, weekStart) + 1, weekStart },
      budget: null as AlertInputs["budget"], // filled below (needs its own queries)
      lastWeek: lastWeek.salesCount > 0 ? { from: lastWeekFrom, netProfit: lastWeek.netProfit, grossMargin: lastWeek.grossMargin, status: lastWeek.status } : null,
      prior4Margin: prior4.salesCount > 0 ? prior4.grossMargin : null,
      lowStock: inv.filter((p) => p.low_stock).map((p) => ({ product_id: p.product_id, name: p.name, on_hand: Number(p.on_hand), unit: p.unit })),
      missingCostSales: month.salesCount > 0 ? (await one<{ n: number }>(
        `select count(distinct s.id)::int n from sales s join sale_items si on si.sale_id = s.id
         where s.business_id=$1 and s.voided_at is null and s.date between $2 and $3 and si.cost_status = 'missing'`, [b, monthFrom, today]))[0].n : 0,
    } satisfies AlertInputs;
  }).then(async (inputs) => {
    const lines = await loadBudgetLines(ctx, today.slice(0, 7));
    const budgeted = lines.filter((l) => l.budget !== null && l.line !== "revenue" && (l.isTotal || l.line === "category" || l.line === "cogs"));
    inputs.budget = budgeted.length ? {
      month: monthFrom,
      lines: budgeted.map((l) => ({ key: l.isTotal ? "opex_total" : l.category_id ?? l.line, label: l.label, budget: l.budget!, actual: l.actual })),
    } : null;
    return inputs;
  });
}

/** Re-evaluate alerts if they're stale (managers only — they can see every number the alerts use). */
const inflight = new Map<string, Promise<void>>();

export async function refreshAlerts(ctx: Ctx, force = false): Promise<void> {
  if (!MANAGERS.has(ctx.role)) return;
  const b = ctx.business.id;
  const running = inflight.get(b);
  if (running) return running; // a check is already under way: wait for it rather than showing stale alerts
  const last = lastSync.get(b) ?? 0;
  if (!force && Date.now() - last < SYNC_EVERY_MS) return;
  lastSync.set(b, Date.now());
  const job = (async () => {
    try {
      // A brand-new business with no sales yet gets no alerts: "cash is low" on day one is noise, not news.
      const [{ any }] = await ctx.q<{ any: boolean }>("select exists (select 1 from sales where business_id = $1 and voided_at is null) as any", [b]);
      if (!any) { await ctx.q("select sync_alerts($1,'[]'::jsonb)", [b]); return; }
      const inputs = await gatherAlertInputs(ctx);
      const ruleRows = await ctx.q<{ kind: string; enabled: boolean; threshold: { value?: number } }>(
        "select kind, enabled, threshold from alert_rules where business_id=$1", [b]);
      const alerts = evaluateAlerts(inputs, mergeRules(ruleRows));
      await ctx.q("select sync_alerts($1,$2::jsonb)", [b, JSON.stringify(alerts)]);
    } catch (e) {
      lastSync.delete(b);
      console.error("[alerts] refresh failed", e);
    } finally {
      inflight.delete(b);
    }
  })();
  inflight.set(b, job);
  return job;
}

export async function listAlerts(ctx: Ctx): Promise<AlertRow[]> {
  return ctx.q<AlertRow>(
    `select id, kind, severity, message, data, read_at, created_at, updated_at from alerts
     where business_id = $1 and resolved_at is null
     order by read_at nulls first, case severity when 'critical' then 0 when 'warning' then 1 else 2 end, updated_at desc
     limit 50`, [ctx.business.id]);
}
