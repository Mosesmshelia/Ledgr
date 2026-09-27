import Link from "next/link";
import { BarChart3, CalendarDays, CalendarRange, ChevronRight, Coins, FileBarChart, HandCoins, Package, PiggyBank, Receipt, Scale, ShoppingBag, Truck, Warehouse } from "lucide-react";
import { requireCtx } from "@/lib/server/session";
import { PageHeader } from "@/components/ui/primitives";

export const metadata = { title: "Reports" };

const GROUPS = [
  { title: "How the business is doing", items: [
    { href: "/reports/weekly", icon: CalendarDays, title: "Weekly business report", body: "The week in numbers and in plain English." },
    { href: "/reports/monthly", icon: CalendarRange, title: "Monthly business report", body: "The month at a glance, week by week." },
    { href: "/reports/pnl", icon: Scale, title: "Profit & loss", body: "Revenue, cost of goods, expenses and net profit, vs the previous period." },
    { href: "/reports/budget", icon: PiggyBank, title: "Budget vs actual", body: "Each line against its monthly budget." },
    { href: "/reports/analytics", icon: BarChart3, title: "Sales analytics", body: "By product, category, customer, salesperson and payment method." },
  ] },
  { title: "Money", items: [
    { href: "/reports/cashflow", icon: Coins, title: "Cash flow", body: "Money in and out by type and by account." },
    { href: "/reports/receivables", icon: HandCoins, title: "Accounts receivable", body: "What customers owe you, by how late it is." },
    { href: "/reports/payables", icon: Truck, title: "Accounts payable", body: "What you owe suppliers, by how late it is." },
  ] },
  { title: "Day to day", items: [
    { href: "/reports/sales", icon: ShoppingBag, title: "Sales report", body: "Every sale, filterable by customer, product and payment status." },
    { href: "/reports/expenses", icon: Receipt, title: "Expense report", body: "By category, one-time and recurring." },
    { href: "/reports/products", icon: Package, title: "Product profitability", body: "Units, revenue, cost and margin for every product." },
    { href: "/reports/inventory", icon: Warehouse, title: "Inventory report", body: "Opening, bought, made, sold and closing stock with value." },
  ] },
];

export default async function ReportsPage() {
  await requireCtx();
  return (
    <div className="animate-rise max-w-5xl">
      <PageHeader title="Reports" subtitle="Every report can be filtered, printed and exported to PDF, Excel or CSV." />
      {GROUPS.map((g) => (
        <section key={g.title} className="mb-6">
          <h2 className="text-overline uppercase font-semibold text-ink-2 mb-2">{g.title}</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {g.items.map((r) => (
              <Link key={r.href} href={r.href} className="group bg-surface rounded-[16px] border border-hairline p-5 hover:border-hairline-strong transition-colors">
                <div className="flex items-center justify-between">
                  <span className="size-10 rounded-[12px] bg-accent-soft text-accent grid place-items-center"><r.icon size={19} /></span>
                  <ChevronRight size={17} className="text-ink-3 group-hover:translate-x-0.5 transition-transform" />
                </div>
                <h3 className="text-headline font-semibold mt-4">{r.title}</h3>
                <p className="text-caption text-ink-2 mt-1">{r.body}</p>
              </Link>
            ))}
          </div>
        </section>
      ))}
      <p className="text-caption text-ink-3 flex items-center gap-1.5"><FileBarChart size={14} />Every report shows its period, when it was generated, and whether any costs are missing or estimated.</p>
    </div>
  );
}
