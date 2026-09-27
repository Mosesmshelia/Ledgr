"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { getUserId } from "@/lib/server/session";
import { pool, withUser, rpc, humanError } from "@/lib/server/db";

const kobo = z.number().int().nonnegative();
const schema = z.object({
  business: z.object({
    name: z.string().trim().min(1, "Enter your business name."), business_type: z.string().max(80).optional(), owner_name: z.string().max(80).optional(),
    phone: z.string().max(30).optional(), fy_start_month: z.number().int().min(1).max(12), vat_registered: z.boolean(),
  }),
  accounts: z.array(z.object({ name: z.string().trim().min(1), type: z.enum(["cash", "bank", "pos", "mobile_money", "other"]), opening_balance: kobo })).min(1, "Add at least one account."),
  recurring: z.array(z.object({ name: z.string().trim().min(1), category: z.string(), amount: kobo.positive(), frequency: z.enum(["daily", "weekly", "monthly", "quarterly", "annual"]) })),
  products: z.array(z.object({ name: z.string().trim().min(1), selling_price: kobo.nullable(), unit_cost: kobo.nullable(), qty: z.number().nonnegative() })),
  targets: z.object({ weekly_sales: kobo.nullable(), monthly_sales: kobo.nullable(), monthly_profit: kobo.nullable() }),
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function completeOnboarding(input: z.infer<typeof schema>): Promise<{ error: string } | void> {
  const userId = await getUserId();
  if (!userId) redirect("/login");
  const p = schema.safeParse(input);
  if (!p.success) return { error: p.error.issues[0].message };
  const d = p.data;
  try {
    // One transaction: the business is set up completely or not at all.
    await withUser(pool, userId, async (db) => {
      const b = await rpc<string>(db, "create_business", {
        ...d.business, accounts: d.accounts.map((a) => ({ ...a, opening_date: d.today })),
      });
      const cats = (await db.query("select id, name from expense_categories where business_id = $1", [b])).rows as { id: string; name: string }[];
      const catId = (n: string) => cats.find((c) => c.name === n)?.id ?? cats.find((c) => c.name === "Miscellaneous")!.id;
      const monthStart = d.today.slice(0, 8) + "01";
      for (const r of d.recurring) {
        await db.query("insert into recurring_expenses (business_id, name, category_id, amount, frequency, start_date, created_by) values ($1,$2,$3,$4,$5,$6,auth.uid())",
          [b, r.name, catId(r.category), r.amount, r.frequency, r.frequency === "weekly" || r.frequency === "daily" ? d.today : monthStart]);
      }
      for (const pr of d.products) {
        const { rows } = await db.query("insert into products (business_id, name, selling_price, created_by) values ($1,$2,$3,auth.uid()) returning id", [b, pr.name, pr.selling_price]);
        if (pr.qty > 0 && pr.unit_cost !== null) {
          await rpc(db, "set_opening_stock", { business_id: b, product_id: rows[0].id, qty: pr.qty, unit_cost: pr.unit_cost, date: d.today });
        } else if (pr.unit_cost !== null) {
          await db.query("update products set standard_cost = $2 where id = $1", [rows[0].id, pr.unit_cost]);
        }
      }
      for (const [kind, amount] of Object.entries(d.targets)) {
        if (amount) await db.query("insert into targets (business_id, kind, amount, created_by) values ($1,$2,$3,auth.uid())", [b, kind, amount]);
      }
      await rpc(db, "update_business_settings", { business_id: b, onboarding_complete: true, reason: "Setup finished" });
    });
  } catch (e) {
    return { error: humanError(e).message };
  }
  redirect("/dashboard");
}
