"use server";
// Every money-changing action in the app. Thin wrappers: validation of money logic lives in the database functions.
import { z } from "zod";
import { post, withCtx, type ActionResult } from "./_run";
import { read, rpc, humanError } from "@/lib/server/db";
import { requireCtx } from "@/lib/server/session";

const kobo = z.number().int().nonnegative();
const qty = z.number().positive().max(1_000_000);
const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function bad(e: z.ZodError): ActionResult<never> {
  return { ok: false, error: e.issues[0]?.message ?? "Please check the form." };
}

// ---------- Sales ----------
const saleSchema = z.object({
  customer_id: uuid.nullable().optional(),
  date,
  due_date: date.optional(),
  items: z.array(z.object({ product_id: uuid, qty, unit_price: kobo, line_discount: kobo.optional() })).min(1, "Add at least one product."),
  invoice_discount: kobo.optional(),
  payment: z.object({ account_id: uuid, amount: kobo }).optional(),
  notes: z.string().max(500).optional(),
  allow_negative_stock: z.boolean().optional(),
});
export async function postSale(input: z.infer<typeof saleSchema>) {
  const p = saleSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  return post("post_sale", p.data, ["/"]);
}

export async function recordPayment(input: { party: "customer" | "supplier"; party_id: string; account_id: string; date: string; amount: number; allocations?: { target_id: string; amount: number }[]; allow_credit?: boolean; reference?: string }) {
  const p = z.object({ party: z.enum(["customer", "supplier"]), party_id: uuid, account_id: uuid, date, amount: kobo.positive("Enter an amount."),
    allocations: z.array(z.object({ target_id: uuid, amount: kobo })).optional(), allow_credit: z.boolean().optional(), reference: z.string().max(100).optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("record_payment", p.data);
}

export async function postReturn(input: { sale_id: string; date: string; reason?: string; restock: boolean; refund_method: "cash" | "credit"; account_id?: string; items: { sale_item_id: string; qty: number }[] }) {
  const p = z.object({ sale_id: uuid, date, reason: z.string().max(200).optional(), restock: z.boolean(), refund_method: z.enum(["cash", "credit"]),
    account_id: uuid.optional(), items: z.array(z.object({ sale_item_id: uuid, qty: z.number().nonnegative() })) }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("post_return", { ...p.data, items: p.data.items.filter((i) => i.qty > 0) });
}

export async function voidDocument(input: { type: "sale" | "purchase" | "expense" | "return" | "production" | "cash"; id: string; reason: string }) {
  const p = z.object({ type: z.enum(["sale", "purchase", "expense", "return", "production", "cash"]), id: uuid, reason: z.string().trim().min(3, "Please give a reason.") }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("void_document", p.data);
}

export async function setMissingCost(input: { sale_item_id: string; unit_cost: number }) {
  const p = z.object({ sale_item_id: uuid, unit_cost: kobo }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("set_missing_cost", p.data);
}

// ---------- Purchases ----------
export async function postPurchase(input: { supplier_id?: string | null; date: string; due_date?: string; supplier_invoice_no?: string; allocation_method?: "value" | "quantity";
  items: { product_id: string; qty: number; unit_cost: number }[]; costs?: { kind: string; amount: number; description?: string }[]; payment?: { account_id: string; amount: number }; notes?: string }) {
  const p = z.object({
    supplier_id: uuid.nullable().optional(), date, due_date: date.optional(), supplier_invoice_no: z.string().max(60).optional(),
    allocation_method: z.enum(["value", "quantity"]).optional(),
    items: z.array(z.object({ product_id: uuid, qty, unit_cost: kobo })).min(1, "Add at least one product."),
    costs: z.array(z.object({ kind: z.enum(["shipping", "customs", "clearing", "packaging", "other"]), amount: kobo, description: z.string().max(100).optional() })).optional(),
    payment: z.object({ account_id: uuid, amount: kobo }).optional(), notes: z.string().max(500).optional(),
  }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("post_purchase", p.data);
}

// ---------- Expenses ----------
export async function createExpense(input: { date: string; name?: string; category_id: string; amount: number; vendor?: string; account_id: string; notes?: string }) {
  const p = z.object({ date, name: z.string().max(120).optional(), category_id: uuid, amount: kobo.positive("Expense amount must be greater than ₦0."),
    vendor: z.string().max(120).optional(), account_id: uuid, notes: z.string().max(500).optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("create_expense", p.data);
}

export async function saveRecurringExpense(input: { id?: string; name: string; category_id: string; amount: number; frequency: string; start_date: string; end_date?: string | null; cash_account_id?: string | null; notes?: string }) {
  const p = z.object({ id: uuid.optional(), name: z.string().trim().min(1, "Enter a name."), category_id: uuid, amount: kobo.positive("Enter an amount."),
    frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"], { message: "Choose how often you pay it." }),
    start_date: date, end_date: date.nullable().optional(), cash_account_id: uuid.nullable().optional(), notes: z.string().max(500).optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  const d = p.data;
  return withCtx(async (ctx) => {
    if (d.id) {
      await ctx.q("update recurring_expenses set name=$2, category_id=$3, amount=$4, frequency=$5, start_date=$6, end_date=$7, cash_account_id=$8, notes=$9 where id=$1 and business_id=$10",
        [d.id, d.name, d.category_id, d.amount, d.frequency, d.start_date, d.end_date ?? null, d.cash_account_id ?? null, d.notes ?? null, ctx.business.id]);
      return d.id;
    }
    const [r] = await ctx.q<{ id: string }>("insert into recurring_expenses (business_id, name, category_id, amount, frequency, start_date, end_date, cash_account_id, notes, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,auth.uid()) returning id",
      [ctx.business.id, d.name, d.category_id, d.amount, d.frequency, d.start_date, d.end_date ?? null, d.cash_account_id ?? null, d.notes ?? null]);
    return r.id;
  });
}

export async function recordRecurringPayment(input: { recurring_expense_id: string; account_id: string; date: string; amount: number }) {
  const p = z.object({ recurring_expense_id: uuid, account_id: uuid, date, amount: kobo.positive("Enter an amount.") }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("record_recurring_payment", p.data);
}

// ---------- Money ----------
export async function recordCashMovement(input: { kind: string; account_id: string; date: string; amount: number; description?: string; counterparty?: string }) {
  const p = z.object({ kind: z.enum(["other_income", "capital_injection", "loan_received", "loan_repayment", "owner_withdrawal", "tax_payment"]),
    account_id: uuid, date, amount: kobo.positive("Enter an amount."), description: z.string().max(200).optional(), counterparty: z.string().max(120).optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("record_cash_movement", p.data);
}

export async function transferCash(input: { from_account_id: string; to_account_id: string; date: string; amount: number; description?: string }) {
  const p = z.object({ from_account_id: uuid, to_account_id: uuid, date, amount: kobo.positive("Enter an amount."), description: z.string().max(200).optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post("transfer_cash", p.data);
}

export async function saveCashAccount(input: { id?: string; name: string; type: string; opening_balance: number; opening_date: string }) {
  const p = z.object({ id: uuid.optional(), name: z.string().trim().min(1, "Enter a name."), type: z.enum(["cash", "bank", "pos", "mobile_money", "other"]),
    opening_balance: z.number().int(), opening_date: date }).safeParse(input);
  if (!p.success) return bad(p.error);
  const d = p.data;
  return withCtx(async (ctx) => {
    if (d.id) {
      await ctx.q("update cash_accounts set name=$2, type=$3, opening_balance=$4, opening_date=$5 where id=$1 and business_id=$6", [d.id, d.name, d.type, d.opening_balance, d.opening_date, ctx.business.id]);
      return d.id;
    }
    const [r] = await ctx.q<{ id: string }>("insert into cash_accounts (business_id, name, type, opening_balance, opening_date, created_by) values ($1,$2,$3,$4,$5,auth.uid()) returning id",
      [ctx.business.id, d.name, d.type, d.opening_balance, d.opening_date]);
    return r.id;
  });
}

// ---------- Master data ----------
export async function saveProduct(input: { id?: string; name: string; sku?: string; category?: string; unit?: string; selling_price?: number | null; standard_cost?: number | null;
  min_stock?: number; is_sellable?: boolean; opening?: { qty: number; unit_cost: number; date: string } | null }) {
  const p = z.object({
    id: uuid.optional(), name: z.string().trim().min(1, "Enter the product name."), sku: z.string().trim().max(40).optional(), category: z.string().trim().max(60).optional(),
    unit: z.string().trim().max(20).optional(), selling_price: kobo.nullable().optional(), standard_cost: kobo.nullable().optional(),
    min_stock: z.number().nonnegative().optional(), is_sellable: z.boolean().optional(),
    opening: z.object({ qty, unit_cost: kobo, date }).nullable().optional(),
  }).safeParse(input);
  if (!p.success) return bad(p.error);
  const d = p.data;
  return withCtx((ctx) => ctx.db(async (db) => {
    // One transaction: the product and its opening stock are saved together or not at all.
    const q1 = async <T,>(sql: string, params: unknown[]) => (await db.query(sql, params)).rows as T[];
    let categoryId: string | null = null;
    if (d.category) {
      const [c] = await q1<{ id: string }>(
        "insert into product_categories (business_id, name, created_by) values ($1,$2,auth.uid()) on conflict (business_id, name) do update set name = excluded.name returning id",
        [ctx.business.id, d.category]);
      categoryId = c.id;
    }
    const vals = [d.name, d.sku || null, categoryId, d.unit || "unit", d.selling_price ?? null, d.standard_cost ?? null, d.min_stock ?? 0, d.is_sellable ?? true];
    let id = d.id;
    if (id) {
      await q1("update products set name=$2, sku=$3, category_id=$4, unit=$5, selling_price=$6, standard_cost=$7, min_stock=$8, is_sellable=$9 where id=$1 and business_id=$10", [id, ...vals, ctx.business.id]);
    } else {
      const [r] = await q1<{ id: string }>("insert into products (name, sku, category_id, unit, selling_price, standard_cost, min_stock, is_sellable, business_id, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,auth.uid()) returning id", [...vals, ctx.business.id]);
      id = r.id;
    }
    if (d.opening) {
      await read(db, "select set_opening_stock($1::jsonb)", [JSON.stringify({ business_id: ctx.business.id, product_id: id, ...d.opening })]);
    }
    return id!;
  }));
}

/** What "Remove" would do for this product: delete / void_opening / archive / blocked / restore, with a plain-English message. */
export async function checkProductRemoval(productId: string) {
  if (!uuid.safeParse(productId).success) return { ok: false as const, error: "Product not found." };
  const ctx = await requireCtx();
  try {
    const data = await ctx.db((db) => rpc<{ mode: "delete" | "void_opening" | "archive" | "blocked" | "restore"; message: string }>(
      db, "product_removal_check", { business_id: ctx.business.id, product_id: productId }));
    return { ok: true as const, data };
  } catch (e) {
    return { ok: false as const, error: humanError(e).message };
  }
}

/** Remove a product entered by mistake (or restore an archived one). Money history is never deleted. */
export async function removeProduct(input: { product_id: string; reason?: string }) {
  const p = z.object({ product_id: uuid, reason: z.string().trim().max(200).optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  return post<"deleted" | "archived" | "restored">("remove_product", p.data);
}

export async function saveCustomer(input: { id?: string; name: string; phone?: string; email?: string; payment_terms_days?: number | null }) {
  const p = z.object({ id: uuid.optional(), name: z.string().trim().min(1, "Enter the customer's name."), phone: z.string().max(30).optional(),
    email: z.string().email("Enter a valid email.").or(z.literal("")).optional(), payment_terms_days: z.number().int().min(0).max(365).nullable().optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  const d = p.data;
  return withCtx(async (ctx) => {
    if (d.id) {
      await ctx.q("update customers set name=$2, phone=$3, email=$4, payment_terms_days=$5 where id=$1 and business_id=$6", [d.id, d.name, d.phone || null, d.email || null, d.payment_terms_days ?? null, ctx.business.id]);
      return { id: d.id, name: d.name };
    }
    const [r] = await ctx.q<{ id: string }>("insert into customers (business_id, name, phone, email, payment_terms_days, created_by) values ($1,$2,$3,$4,$5,auth.uid()) returning id",
      [ctx.business.id, d.name, d.phone || null, d.email || null, d.payment_terms_days ?? null]);
    return { id: r.id, name: d.name };
  });
}

export async function saveSupplier(input: { id?: string; name: string; phone?: string; contact_name?: string }) {
  const p = z.object({ id: uuid.optional(), name: z.string().trim().min(1, "Enter the supplier's name."), phone: z.string().max(30).optional(), contact_name: z.string().max(80).optional() }).safeParse(input);
  if (!p.success) return bad(p.error);
  const d = p.data;
  return withCtx(async (ctx) => {
    const [r] = await ctx.q<{ id: string }>("insert into suppliers (business_id, name, phone, contact_name, created_by) values ($1,$2,$3,$4,auth.uid()) returning id",
      [ctx.business.id, d.name, d.phone || null, d.contact_name || null]);
    return { id: r.id, name: d.name };
  });
}

// ---------- Production ----------
export async function postProduction(input: { product_id: string; qty: number; date: string; batch_no?: string; notes?: string;
  materials: { product_id: string; qty: number }[]; costs: { kind: string; amount: number; description?: string; account_id?: string | null }[] }) {
  const p = z.object({
    product_id: uuid, qty: qty, date, batch_no: z.string().max(40).optional(), notes: z.string().max(500).optional(),
    materials: z.array(z.object({ product_id: uuid, qty })),
    costs: z.array(z.object({ kind: z.enum(["materials", "labour", "packaging", "transport", "other"]), amount: kobo, description: z.string().max(100).optional(), account_id: uuid.nullable().optional() })),
  }).safeParse(input);
  if (!p.success) return bad(p.error);
  const d = p.data;
  return post("post_production", {
    product_id: d.product_id, qty: d.qty, date: d.date, batch_no: d.batch_no, notes: d.notes,
    costs: [
      ...d.materials.map((m) => ({ kind: "materials", consumed_product_id: m.product_id, consumed_qty: m.qty })),
      ...d.costs.filter((c) => c.amount > 0).map((c) => ({ kind: c.kind, amount: c.amount, description: c.description, account_id: c.account_id ?? undefined })),
    ],
  });
}

// ---------- Budgets ----------
export async function saveBudgets(input: { month: string; lines: { line: "revenue" | "cogs" | "category"; category_id: string | null; amount: number | null }[] }) {
  const p = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), lines: z.array(z.object({ line: z.enum(["revenue", "cogs", "category"]), category_id: uuid.nullable(), amount: kobo.nullable() })) }).safeParse(input);
  if (!p.success) return bad(p.error);
  const month = `${p.data.month}-01`;
  return withCtx((ctx) => ctx.db(async (db) => {
    for (const l of p.data.lines) {
      if (l.amount === null) {
        await db.query("delete from budgets where business_id = $1 and month = $2 and line = $3 and category_id is not distinct from $4", [ctx.business.id, month, l.line, l.category_id]);
      } else {
        await db.query(`insert into budgets (business_id, month, line, category_id, amount, created_by) values ($1,$2,$3,$4,$5,auth.uid())
          on conflict (business_id, month, line, category_id) do update set amount = excluded.amount`, [ctx.business.id, month, l.line, l.category_id, l.amount]);
      }
    }
    return p.data.lines.filter((l) => l.amount !== null).length;
  }));
}
