import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireCap } from "@/lib/server/session";
import { addMonths, endOfMonth, todayIn, type PnlInputs, calculatePnl } from "@/lib/finance";
import { BudgetEditor } from "./budget-editor";

export const metadata = { title: "Set budgets" };

export default async function EditBudgets({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<{ month?: string }> }) {
  const { kind } = await params;
  if (kind !== "budget") notFound();
  const ctx = await requireCap("record", "/reports/budget");
  const sp = await searchParams;
  const b = ctx.business.id;
  const today = todayIn(ctx.business.timezone);
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const prevMonth = addMonths(`${month}-01`, -1).slice(0, 7);
  const cats = await ctx.q<{ id: string; name: string }>("select id, name from expense_categories where business_id = $1 and kind = 'operating' order by sort_order, name", [b]);
  const current = await ctx.q<{ line: string; category_id: string | null; amount: number }>("select line, category_id, amount from budgets where business_id = $1 and month = $2", [b, `${month}-01`]);
  const previous = await ctx.q<{ line: string; category_id: string | null; amount: number }>("select line, category_id, amount from budgets where business_id = $1 and month = $2", [b, `${prevMonth}-01`]);
  // Last month's actuals as a guide
  const [pnl] = await ctx.q<{ r: PnlInputs }>("select fin_pnl($1,$2,$3) r", [b, `${prevMonth}-01`, endOfMonth(`${prevMonth}-01`)]);
  const lp = calculatePnl(pnl.r);
  const exp = await ctx.q<{ category_id: string; total: number }>("select category_id, total from fin_expense_breakdown($1,$2,$3)", [b, `${prevMonth}-01`, endOfMonth(`${prevMonth}-01`)]);
  const lines = [
    { line: "revenue" as const, category_id: null, label: "Revenue", hint: "Sales target for the month", last: lp.revenue },
    { line: "cogs" as const, category_id: null, label: "Cost of goods sold", hint: "What the goods you sell should cost", last: lp.cogs },
    ...cats.map((c) => ({ line: "category" as const, category_id: c.id, label: c.name, hint: "", last: exp.find((e) => e.category_id === c.id)?.total ?? 0 })),
  ];
  const find = (rows: typeof current, l: { line: string; category_id: string | null }) => rows.find((x) => x.line === l.line && (x.category_id ?? null) === l.category_id)?.amount ?? null;
  return (
    <div className="animate-rise max-w-3xl">
      <Link href={`/reports/budget?month=${month}`} className="tap inline-flex items-center gap-1 text-body text-accent mb-3"><ChevronLeft size={18} />Budget vs actual</Link>
      <BudgetEditor month={month} lines={lines.map((l) => ({ ...l, value: find(current, l), previous: find(previous, l) }))} />
    </div>
  );
}
