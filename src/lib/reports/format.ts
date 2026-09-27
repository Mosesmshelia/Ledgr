// Cell formatting shared by the screen and PDF (CSV/Excel keep raw numbers).
import { formatMoney, formatPercent, formatQty } from "@/lib/finance/money";
import { formatDate } from "@/lib/finance/periods";
import type { Column, Row } from "./types";

export function formatCell(c: Column, row: Row, opts: { statement?: boolean; exact?: boolean } = {}): string {
  const v = row[c.key];
  if (v === null || v === undefined || v === "") return c.type === "text" || row._style === "header" || row._style === "muted" || row._style === "total" ? "" : "—";
  if (row._pct && typeof v === "number") return formatPercent(v, 1);
  switch (c.type) {
    case "money": {
      const n = Number(v);
      if (opts.statement && n < 0) return `(${formatMoney(-n, { exact: opts.exact })})`;
      return formatMoney(n, { exact: opts.exact });
    }
    case "pct": return formatPercent(Number(v), 1);
    case "qty": return formatQty(Number(v));
    case "int": return Number(v).toLocaleString("en-NG");
    case "date": return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDate(String(v), true) : String(v);
    default: return String(v);
  }
}

export const isNumeric = (c: Column) => c.type !== "text" && c.type !== "date";
