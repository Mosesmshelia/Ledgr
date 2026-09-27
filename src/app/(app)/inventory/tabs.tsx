import Link from "next/link";
import { cn } from "@/components/ui/primitives";

export function InventoryTabs({ active }: { active: "products" | "purchases" | "production" }) {
  const tabs = [
    { key: "products", href: "/inventory", label: "Products" },
    { key: "purchases", href: "/inventory/purchases", label: "Purchases" },
    { key: "production", href: "/inventory/production", label: "Production" },
  ];
  return (
    <div className="inline-flex p-0.5 rounded-[10px] bg-fill mb-4" role="tablist">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key}
          className={cn("h-8 px-4 grid place-items-center rounded-[8px] text-caption font-medium", active === t.key ? "bg-surface shadow-[0_1px_3px_rgba(0,0,0,0.12)]" : "text-ink-2 hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
