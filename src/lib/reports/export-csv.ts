// CSV: plain numbers (naira with 2 decimals, percentages as numbers) so spreadsheets can calculate with them.
import type { ReportData, Row, Column } from "./types";

const esc = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function raw(c: Column, row: Row): string | number {
  const v = row[c.key];
  if (v === null || v === undefined) return "";
  if (row._pct && typeof v === "number") return (v * 100).toFixed(2);
  if (c.type === "money") return (Number(v) / 100).toFixed(2);
  if (c.type === "pct") return (Number(v) * 100).toFixed(2);
  return v as string | number;
}

export function toCSV(r: ReportData): string {
  const lines: string[] = [];
  lines.push(esc(r.title));
  lines.push([esc(r.business), esc(r.asAt ? `As at ${r.to}` : `${r.from} to ${r.to}`), esc(`Currency: ${r.currency}`), esc(`Generated: ${r.generatedAt}`),
    esc(r.status === "complete" ? "Fully calculated" : r.status === "partial" ? "Partly estimated" : "Missing cost data")].join(","));
  if (r.summary?.length) { lines.push(""); r.summary.forEach((s) => lines.push(esc(s))); }
  if (r.figures?.length) {
    lines.push("");
    lines.push(r.figures.map((f) => esc(f.label)).join(","));
    lines.push(r.figures.map((f) => (f.value === null ? "" : f.type === "money" ? (f.value / 100).toFixed(2) : f.type === "pct" ? (f.value * 100).toFixed(2) : f.value)).join(","));
  }
  for (const s of r.sections) {
    lines.push("");
    if (s.title) lines.push(esc(s.title));
    lines.push(s.columns.map((c) => esc(c.label + (c.type === "money" ? " (NGN)" : c.type === "pct" ? " (%)" : ""))).join(","));
    for (const row of s.rows) lines.push(s.columns.map((c) => esc(raw(c, row))).join(","));
    if (s.totals) lines.push(s.columns.map((c) => esc(raw(c, s.totals!))).join(","));
    if (s.note) lines.push(esc(s.note));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
