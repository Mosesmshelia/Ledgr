// Excel: real numbers with ₦ number formats, one sheet per section, frozen headers, bold totals.
import ExcelJS from "exceljs";
import type { ReportData, Row, Column, Section } from "./types";

const MONEY = '"₦"#,##0.00;[Red]-"₦"#,##0.00';
const STATEMENT_MONEY = '"₦"#,##0.00;[Red]("₦"#,##0.00)';
const PCT = "0.0%";
const QTY = "#,##0.###";
const ACCENT = "FF0071E3";

function value(c: Column, row: Row): string | number | Date | null {
  const v = row[c.key];
  if (v === null || v === undefined || v === "") return null;
  if (row._pct && typeof v === "number") return v;
  if (c.type === "money") return Number(v) / 100;
  if (c.type === "pct" || c.type === "qty" || c.type === "int") return Number(v);
  if (c.type === "date" && /^\d{4}-\d{2}-\d{2}$/.test(String(v))) { const [y, m, d] = String(v).split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  return String(v);
}

function fmtFor(c: Column, row: Row, s: Section) {
  if (row._pct) return PCT;
  if (c.type === "money") return s.kind === "statement" ? STATEMENT_MONEY : MONEY;
  if (c.type === "pct") return PCT;
  if (c.type === "qty") return QTY;
  if (c.type === "int") return "#,##0";
  if (c.type === "date") return "d mmm yyyy";
  return undefined;
}

export async function toXLSX(r: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Ledgr";
  wb.created = new Date(r.generatedAt);

  const sum = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  sum.columns = [{ width: 34 }, { width: 22 }, { width: 22 }];
  sum.addRow([r.title]).font = { size: 16, bold: true };
  sum.addRow([r.business]).font = { size: 11, color: { argb: "FF6E6E73" } };
  sum.addRow([r.asAt ? `As at ${r.to}` : `${r.from} to ${r.to}`]);
  sum.addRow([`Currency: ${r.currency === "NGN" ? "Nigerian naira (₦)" : r.currency}`]);
  sum.addRow([`Generated: ${new Date(r.generatedAt).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}`]);
  sum.addRow([r.status === "complete" ? "Data: fully calculated" : r.status === "partial" ? "Data: some costs are estimated" : "Data: some product costs are missing"]).font = { color: { argb: r.status === "complete" ? "FF1F8A4C" : "FFB25000" } };
  if (r.statusNote) sum.addRow([r.statusNote]).font = { italic: true, color: { argb: "FF6E6E73" } };
  if (r.figures?.length) {
    sum.addRow([]);
    for (const f of r.figures) {
      const row = sum.addRow([f.label, f.value === null ? "—" : f.type === "money" ? f.value / 100 : f.value, f.sub ?? ""]);
      row.getCell(2).numFmt = f.type === "money" ? MONEY : f.type === "pct" ? PCT : "#,##0";
      row.getCell(2).font = { bold: true };
    }
  }
  if (r.summary?.length) {
    sum.addRow([]);
    sum.addRow(["In plain English"]).font = { bold: true };
    for (const s of r.summary) { const row = sum.addRow([s]); sum.mergeCells(row.number, 1, row.number, 3); row.alignment = { wrapText: true }; row.height = 30; }
  }

  const used = new Set<string>(["Summary"]);
  r.sections.forEach((s, i) => {
    let name = (s.title ?? (r.sections.length === 1 ? r.title : `Section ${i + 1}`)).replace(/[\\/*?:[\]]/g, "").slice(0, 31);
    while (used.has(name)) name = name.slice(0, 28) + " " + (i + 1);
    used.add(name);
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
    ws.columns = s.columns.map((c) => ({ header: c.label, key: c.key, width: c.type === "text" ? Math.max(14, (c.width ?? 2) * 12) : c.type === "date" ? 13 : 16 }));
    const head = ws.getRow(1);
    head.font = { bold: true, color: { argb: "FFFFFFFF" } };
    head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ACCENT } };
    head.alignment = { vertical: "middle" };
    head.height = 22;
    s.columns.forEach((c, ci) => { if (c.type !== "text" && c.type !== "date") head.getCell(ci + 1).alignment = { horizontal: "right", vertical: "middle" }; });
    const addRow = (row: Row, isTotal = false) => {
      const xr = ws.addRow(s.columns.map((c) => value(c, row)));
      s.columns.forEach((c, ci) => { const f = fmtFor(c, row, s); if (f) xr.getCell(ci + 1).numFmt = f; });
      const st = isTotal ? "total" : row._style;
      if (st === "total" || st === "grand") { xr.font = { bold: true }; xr.border = { top: { style: st === "grand" ? "double" : "thin", color: { argb: "FF8E8E93" } } }; }
      if (st === "header") xr.font = { bold: true, color: { argb: "FF6E6E73" } };
      if (st === "indent") xr.getCell(1).alignment = { indent: 2 };
      if (st === "muted") xr.font = { italic: true, color: { argb: "FF6E6E73" } };
      if (st === "warning") xr.font = { color: { argb: "FFB25000" } };
    };
    s.rows.forEach((row) => addRow(row));
    if (s.totals) addRow(s.totals, true);
    if (s.note) { ws.addRow([]); ws.addRow([s.note]).font = { italic: true, color: { argb: "FF6E6E73" } }; }
    if (s.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: s.columns.length } };
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
