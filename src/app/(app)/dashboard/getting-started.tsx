// First-run checklist for a new business: each step ticks itself off from real records.
import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import type { Ctx } from "@/lib/server/session";
import { Card, cn } from "@/components/ui/primitives";
import { can } from "@/lib/permissions";

export async function GettingStarted({ ctx }: { ctx: Ctx }) {
  const b = ctx.business.id;
  const [c] = await ctx.q<{ products: number; stock: number; sales: number; costs: number; team: number }>(`
    select (select count(*) from products where business_id = $1)::int products,
           (select count(*) from inventory_transactions where business_id = $1 and qty_change > 0)::int stock,
           (select count(*) from sales where business_id = $1 and voided_at is null)::int sales,
           ((select count(*) from expenses where business_id = $1) + (select count(*) from recurring_expenses where business_id = $1))::int costs,
           (select count(*) from business_members where business_id = $1)::int team`, [b]);
  const steps = [
    { done: c.products > 0, title: "Add what you sell", body: "Products with a price, so sales take seconds.", href: "/inventory?add=1", show: can(ctx.role, "record") },
    { done: c.stock > 0, title: "Record stock you bought", body: "Ledgr uses what you paid to work out real profit on every sale.", href: "/inventory/purchases/new", show: can(ctx.role, "record") },
    { done: c.sales > 0, title: "Record your first sale", body: "Cash, transfer, POS or on credit — revenue and profit appear here straight away.", href: "/sales/new", show: can(ctx.role, "sell") },
    { done: c.costs > 0, title: "Add your running costs", body: "Rent, salaries, diesel. Yearly bills are spread across the months automatically.", href: "/expenses?add=1", show: can(ctx.role, "record") },
    { done: c.team > 1, title: "Invite your team", body: "Give sales staff their own login without showing them your costs.", href: "/settings?tab=team", show: can(ctx.role, "team") },
  ].filter((s) => s.show);
  const done = steps.filter((s) => s.done).length;
  const next = steps.findIndex((s) => !s.done);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-headline font-semibold">Get set up</h2>
          <p className="text-body text-ink-2 mt-0.5">Once you record a sale, your revenue, profit and cash show up here.</p>
        </div>
        <span className="text-caption text-ink-2 num whitespace-nowrap mt-1">{done} of {steps.length} done</span>
      </div>
      <div className="h-1.5 rounded-full bg-fill mt-4 overflow-hidden" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={steps.length} aria-label="Setup progress">
        <div className="h-full rounded-full bg-positive transition-all" style={{ width: `${(done / Math.max(1, steps.length)) * 100}%` }} />
      </div>
      <ol className="mt-4 flex flex-col">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link href={s.href} className={cn("flex items-center gap-4 rounded-[12px] px-3 py-3 -mx-3 hover:bg-fill transition-colors", i === next && "bg-accent-soft hover:bg-accent-soft")}>
              <span className={cn("size-7 shrink-0 rounded-full grid place-items-center text-caption font-semibold",
                s.done ? "bg-positive text-white" : i === next ? "bg-accent text-on-accent" : "bg-fill text-ink-2")} aria-hidden>
                {s.done ? <Check size={15} strokeWidth={3} /> : i + 1}
              </span>
              <span className="flex-1 min-w-0">
                <span className={cn("block text-body font-medium", s.done && "text-ink-2 line-through decoration-ink-3")}>{s.title}<span className="sr-only">{s.done ? " (done)" : ""}</span></span>
                {!s.done && <span className="block text-caption text-ink-2">{s.body}</span>}
              </span>
              {!s.done && <ChevronRight size={17} className="text-ink-3 shrink-0" aria-hidden />}
            </Link>
          </li>
        ))}
      </ol>
    </Card>
  );
}
