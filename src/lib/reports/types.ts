// One report model drives every output: the screen, PDF, CSV and Excel.
// Money is always kobo here; each renderer formats it for its medium.
import type { Completeness } from "@/lib/finance/pnl";

export type ColType = "text" | "money" | "qty" | "pct" | "date" | "int";

export interface Column {
  key: string;
  label: string;
  type: ColType;
  /** Relative width hint for PDF/Excel (default 1; text columns 2). */
  width?: number;
}

export type RowStyle = "normal" | "header" | "indent" | "total" | "grand" | "muted" | "warning";

export interface Row {
  [key: string]: unknown;
  _style?: RowStyle;
  _href?: string;
  /** Numbers in this row are ratios (margins), not money. */
  _pct?: boolean;
}

export interface Section {
  title?: string;
  subtitle?: string;
  columns: Column[];
  rows: Row[];
  totals?: Row;
  note?: string;
  /** "statement" = P&L-style lines (brackets for negatives in print). */
  kind?: "table" | "statement";
  /** Search applies to this section's text columns. */
  searchable?: boolean;
  /** Recompute totals for money/qty/int columns from the (possibly filtered) rows. */
  autoTotal?: boolean;
  /** Which column types get totals (default money, qty, int). Use ["money"] when units differ. */
  totalTypes?: ColType[];
}

export interface KeyFigure {
  label: string;
  value: number | null;
  type: ColType;
  sub?: string;
  tone?: "positive" | "negative" | "warning";
}

export interface FilterDef {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

export interface ReportData {
  kind: string;
  title: string;
  business: string;
  from: string;
  to: string;
  /** "As at" reports (receivables, payables) show a single date. */
  asAt?: boolean;
  generatedAt: string;
  currency: string;
  status: Completeness;
  statusNote?: string;
  summary?: string[];
  figures?: KeyFigure[];
  sections: Section[];
  filters?: FilterDef[];
  periodMode?: "range" | "month" | "week" | "asAt";
}

export interface ReportParams {
  period?: string;
  from?: string;
  to?: string;
  month?: string;
  week?: string;
  q?: string;
  [filter: string]: string | undefined;
}
