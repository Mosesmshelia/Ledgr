// What each role can do in the interface. The database enforces the same rules (app_require / RLS);
// this file only decides what to SHOW, so a hidden button is never the only protection.
export type Role = "owner" | "admin" | "accountant" | "sales" | "viewer";

export type Capability =
  | "sell"        // new sale, record customer payment, add customer
  | "record"      // purchases, expenses, production, stock adjustments, cash movements, supplier payments
  | "void"        // void / reverse any document
  | "reports"     // financial reports and analytics
  | "settings"    // settings area (categories, accounts, targets, alerts)
  | "business"    // business details, VAT, week start
  | "team"        // invite, change roles, remove
  | "audit";      // audit log

const MATRIX: Record<Role, Capability[]> = {
  owner: ["sell", "record", "void", "reports", "settings", "business", "team", "audit"],
  admin: ["sell", "record", "void", "reports", "settings", "business", "team", "audit"],
  accountant: ["sell", "record", "void", "reports", "settings", "audit"],
  sales: ["sell"],
  viewer: ["reports"],
};

export function can(role: Role, cap: Capability): boolean {
  return MATRIX[role].includes(cap);
}

export const ROLE_INFO: Record<Role, { label: string; summary: string }> = {
  owner: { label: "Owner", summary: "Everything, including ownership and team." },
  admin: { label: "Admin", summary: "Everything except changing owners." },
  accountant: { label: "Accountant", summary: "Records and reviews all money, reports and settings. Can't manage the team." },
  sales: { label: "Sales", summary: "Records sales and customer payments. Doesn't see costs or profit unless you allow it." },
  viewer: { label: "Viewer", summary: "Can look at everything, but can't change anything." },
};

/** Which capability each area needs, and where to send people who lack it. First match wins. */
export const ROUTE_RULES: { prefix: string; need: Capability; fallback: string }[] = [
  { prefix: "/sales/new", need: "sell", fallback: "/sales" },
  { prefix: "/inventory/purchases/new", need: "record", fallback: "/inventory/purchases" },
  { prefix: "/inventory/production/new", need: "record", fallback: "/inventory/production" },
  { prefix: "/reports/budget/edit", need: "record", fallback: "/reports/budget" },
  { prefix: "/inventory", need: "reports", fallback: "/dashboard" },
  { prefix: "/expenses", need: "reports", fallback: "/dashboard" },
  { prefix: "/money", need: "reports", fallback: "/dashboard" },
  { prefix: "/reports", need: "reports", fallback: "/dashboard" },
  { prefix: "/settings", need: "settings", fallback: "/dashboard" },
];

export function routeFallback(role: Role, path: string): string | null {
  const p = path.split("?")[0];
  const rule = ROUTE_RULES.find((r) => p === r.prefix || p.startsWith(r.prefix + "/"));
  return rule && !can(role, rule.need) ? rule.fallback : null;
}
