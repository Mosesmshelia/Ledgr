// Shared by server pages: turn ?period=…&from=…&to=… into a period key (+ custom range).
export function parsePeriodParams(sp: { period?: string; from?: string; to?: string }, fallback: string) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (sp.period === "custom" && sp.from && sp.to && iso.test(sp.from) && iso.test(sp.to)) return { key: "custom" as const, custom: { from: sp.from, to: sp.to } };
  const key = ["today", "this_week", "this_month", "last_month"].includes(sp.period ?? "") ? sp.period! : fallback;
  return { key: key as "today" | "this_week" | "this_month" | "last_month", custom: undefined };
}
