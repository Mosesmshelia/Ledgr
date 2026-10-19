import Link from "next/link";
import { cn } from "@/components/ui/primitives";

export function InventoryTabs({ active }: { active: "products" | "purchases" | "production" | "shopping" }) {
  const tabs = [
    { key: "products", href: "/inventory", label: "Products" },
    { key: "production", href: "/inventory/production", label: "Batches" },
    { key: "purchases", href: "/inventory/purchases", label: "Bought" },
    { key: "shopping", href: "/shopping", label: "To buy" },
  ];
  return (
    <div className="flex max-w-full overflow-x-auto p-1 rounded-[14px] bg-fill mb-4 w-fit [scrollbar-width:none]" role="tablist">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key}
          className={cn("h-9 px-4 grid place-items-center rounded-[10px] text-caption font-medium whitespace-nowrap transition-all", active === t.key ? "bg-surface text-ink shadow-[0_1px_3px_rgba(17,19,24,0.12)]" : "text-ink-2 hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
