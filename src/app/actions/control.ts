"use server";
// Phase 4 actions: settings, team, alerts, targets, stock adjustments. All permission checks happen in the
// database; these wrappers validate input shape and turn errors into plain English.
import { z } from "zod";
import { redirect } from "next/navigation";
import { post, withCtx, type ActionResult } from "./_run";
import { rpc, humanError, pool, withUser } from "@/lib/server/db";
import { getUserId } from "@/lib/server/session";
import { refreshAlerts } from "@/lib/server/alerts";
import { cookies } from "next/headers";

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reason = z.string().trim().min(3, "Please give a short reason.").max(300);
function bad(e: z.ZodError): ActionResult<never> {
  return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
}

// ---------- Alerts ----------
export async function dismissAlert(id: string) {
  if (!uuid.safeParse(id).success) return { ok: false as const, error: "Alert not found." };
  return post<void>("dismiss_alert", { id }, ["/"]);
}

export async function refreshAlertsNow() {
  return withCtx(async (ctx) => { await refreshAlerts(ctx, true); return true; });
}

const RULE_KINDS = ["low_cash", "overdue_receivables", "overdue_payables", "high_expense", "sales_behind_target",
  "over_budget", "negative_profit", "low_stock", "margin_drop", "missing_costs"] as const;
const rulesSchema = z.array(z.object({ kind: z.enum(RULE_KINDS), enabled: z.boolean(), value: z.number().min(0).max(1e13) }));
export async function saveAlertRules(input: z.infer<typeof rulesSchema>) {
  const p = rulesSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return withCtx(async (ctx) => {
    await ctx.db(async (db) => {
      for (const r of p.data) {
        await db.query(
          `insert into alert_rules (business_id, kind, enabled, threshold, created_by) values ($1,$2,$3,$4,auth.uid())
           on conflict (business_id, kind) do update set enabled = excluded.enabled, threshold = excluded.threshold, updated_at = now()`,
          [ctx.business.id, r.kind, r.enabled, JSON.stringify({ value: Math.round(r.value) })]);
      }
    });
    await refreshAlerts(ctx, true);
    return true;
  });
}

// ---------- Targets (a new row each time, so history is kept) ----------
const targetSchema = z.object({
  kind: z.enum(["daily_sales", "weekly_sales", "monthly_sales", "monthly_profit", "gross_margin"]),
  amount: z.number().int().min(0),
  effective_from: date,
});
export async function saveTarget(input: z.infer<typeof targetSchema>) {
  const p = targetSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return withCtx(async (ctx) => {
    await ctx.q(
      `insert into targets (business_id, kind, amount, effective_from, created_by) values ($1,$2,$3,$4,auth.uid())`,
      [ctx.business.id, p.data.kind, p.data.amount, p.data.effective_from]);
    return true;
  });
}

// ---------- Business settings ----------
const bizSchema = z.object({
  name: z.string().trim().min(1, "Business name can't be empty.").max(120),
  business_type: z.string().max(120).optional(),
  owner_name: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().trim().email("Enter a valid email address.").or(z.literal("")).optional(),
  address: z.string().max(300).optional(),
  week_start: z.number().int().min(0).max(6),
  fy_start_month: z.number().int().min(1).max(12),
  vat_registered: z.boolean(),
  vat_rate_bp: z.number().int().min(0).max(10000),
  prices_include_vat: z.boolean(),
  default_payment_terms_days: z.number().int().min(0).max(365),
});
export async function saveBusinessSettings(input: z.infer<typeof bizSchema>) {
  const p = bizSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return post<void>("update_business_settings", p.data, ["/"]);
}

// ---------- Categories (rename / add / archive — never delete) ----------
const catSchema = z.object({
  table: z.enum(["expense_categories", "product_categories"]),
  id: uuid.optional(),
  name: z.string().trim().min(1, "Enter a name.").max(80),
  kind: z.enum(["operating", "other_expense", "income_tax"]).optional(),
  is_active: z.boolean().optional(),
});
export async function saveCategory(input: z.infer<typeof catSchema>) {
  const p = catSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const { table, id, name, kind, is_active } = p.data;
  return withCtx(async (ctx) => {
    const b = ctx.business.id;
    if (id) {
      const sets = ["name = $3", "is_active = coalesce($4, is_active)", "updated_at = now()"];
      const params: unknown[] = [id, b, name, is_active ?? null];
      if (table === "expense_categories" && kind) { sets.push("kind = $5"); params.push(kind); }
      const r = await ctx.q(`update ${table} set ${sets.join(", ")} where id = $1 and business_id = $2 returning id`, params);
      if (!r.length) throw new Error("You don't have permission to do this.");
    } else if (table === "expense_categories") {
      await ctx.q("insert into expense_categories (business_id, name, kind, created_by) values ($1,$2,$3,auth.uid())", [b, name, kind ?? "operating"]);
    } else {
      await ctx.q("insert into product_categories (business_id, name, created_by) values ($1,$2,auth.uid())", [b, name]);
    }
    return true;
  });
}

// ---------- Team ----------
const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  role: z.enum(["admin", "accountant", "sales", "viewer"]),
  can_see_costs: z.boolean().optional(),
});
export async function createInvite(input: z.infer<typeof inviteSchema>) {
  const p = inviteSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return post<string>("create_invite", p.data, ["/settings"]);
}
export async function revokeInvite(id: string) {
  return post<void>("revoke_invite", { id }, ["/settings"]);
}
const roleSchema = z.object({ member_id: uuid, role: z.enum(["owner", "admin", "accountant", "sales", "viewer"]), can_see_costs: z.boolean().optional() });
export async function setMemberRole(input: z.infer<typeof roleSchema>) {
  const p = roleSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return post<void>("set_member_role", p.data, ["/"]);
}
export async function removeMember(input: { member_id: string; reason?: string }) {
  if (!uuid.safeParse(input.member_id).success) return { ok: false as const, error: "Team member not found." };
  return post<void>("remove_member", { member_id: input.member_id, reason: input.reason || "Removed from team" }, ["/settings"]);
}

/** Accept an invitation as the signed-in user, switch to that business, go to the dashboard. */
export async function acceptInvite(token: string): Promise<ActionResult<never>> {
  const userId = await getUserId();
  if (!userId) redirect(`/login?next=/invite/${token}`);
  let b: string;
  try {
    b = await withUser(pool, userId, (db) => rpc<string>(db, "accept_invite", { token }));
  } catch (e) {
    return { ok: false, error: humanError(e).message };
  }
  (await cookies()).set("ledgr_business", b, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

// ---------- Stock adjustments ----------
const adjSchema = z.object({
  product_id: uuid,
  date,
  qty_change: z.number().refine((n) => n !== 0 && Math.abs(n) <= 1_000_000, "Enter how many to add or remove."),
  unit_cost: z.number().int().min(0).optional(),
  reason,
});
export async function postStockAdjustment(input: z.infer<typeof adjSchema>) {
  const p = adjSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return post("post_stock_adjustment", p.data, ["/"]);
}
export async function voidStockAdjustment(input: { id: string; reason: string }) {
  const p = z.object({ id: uuid, reason }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post<void>("void_stock_adjustment", p.data, ["/"]);
}

// ---------- Cash accounts (rename / change type / archive) ----------
const accSchema = z.object({ id: uuid, name: z.string().trim().min(1, "Enter a name.").max(80), type: z.enum(["cash", "bank", "pos", "mobile_money", "other"]), is_active: z.boolean() });
export async function updateCashAccount(input: z.infer<typeof accSchema>) {
  const p = accSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return withCtx(async (ctx) => {
    const b = ctx.business.id;
    if (!p.data.is_active) {
      const today = new Date().toISOString().slice(0, 10);
      const [bal] = await ctx.q<{ closing: number }>("select closing from fin_cash_accounts($1,$2,$2) where account_id = $3", [b, today, p.data.id]);
      if (bal && Number(bal.closing) !== 0) throw new Error("This account still has money in it. Move it to another account first, then archive it.");
    }
    const r = await ctx.q("update cash_accounts set name=$3, type=$4, is_active=$5, updated_at=now() where id=$1 and business_id=$2 returning id",
      [p.data.id, b, p.data.name, p.data.type, p.data.is_active]);
    if (!r.length) throw new Error("You don't have permission to do this.");
    return true;
  });
}
