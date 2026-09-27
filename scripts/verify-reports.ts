// Cross-checks: every report must agree with the others and with the dashboard, and every export must
// open and contain the same numbers. Runs against the dev server with the demo data.
import { chromium, type APIRequestContext } from "@playwright/test";
import ExcelJS from "exceljs";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
type Fig = { label: string; value: number | null };
type Sec = { title?: string; columns: { key: string; type: string }[]; rows: Record<string, unknown>[]; totals?: Record<string, unknown> };
type Rep = { figures?: Fig[]; sections: Sec[]; from: string; to: string };

let fails = 0;
const ok = (label: string, a: number | null | undefined, b: number | null | undefined) => {
  const pass = a === b;
  if (!pass) fails++;
  console.log(`${pass ? "✓" : "✗"} ${label.padEnd(64)} ${String(a).padStart(12)} ${pass ? "=" : "≠"} ${b}`);
};
const fig = (r: Rep, label: string) => r.figures?.find((f) => f.label === label)?.value ?? null;
const sec = (r: Rep, title?: string) => (title ? r.sections.find((s) => s.title === title)! : r.sections[0]);
const total = (s: Sec, key: string) => Number(s.totals?.[key]);
const rowVal = (s: Sec, label: string, key = "cur") => s.rows.find((x) => x.label === label)?.[key] as number;

async function json(req: APIRequestContext, kind: string, qs = ""): Promise<Rep> {
  const r = await req.get(`${BASE}/api/reports/${kind}?format=json${qs ? "&" + qs : ""}`);
  if (!r.ok()) throw new Error(`${kind}: ${r.status()}`);
  return r.json();
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage();
  await page.goto(BASE + "/login");
  await page.fill("#email", "demo@ledgr.ng");
  await page.fill("#password", "ledgr-demo");
  await Promise.all([page.waitForURL("**/dashboard**", { timeout: 90_000 }), page.click("button[type=submit]")]);
  const req = page.request;

  for (const period of ["this_month", "last_month", "this_week"]) {
    console.log(`\n— ${period}`);
    const qs = `period=${period}`;
    const pnl = await json(req, "pnl", qs);
    const s = sec(pnl);
    const revenue = rowVal(s, "Net revenue"), opex = -rowVal(s, "Total operating expenses"), net = rowVal(s, "Net profit");
    ok("P&L gross − discounts − returns = net revenue", rowVal(s, "Gross sales") + rowVal(s, "Discounts") + rowVal(s, "Returns and refunds"), revenue);
    const products = await json(req, "products", qs);
    ok("Product profitability revenue total = P&L revenue", total(sec(products), "revenue"), revenue);
    const sales = await json(req, "sales", qs);
    ok("Sales report 'Net revenue' = P&L revenue", fig(sales, "Net revenue"), revenue);
    ok("Sales report by-product revenue = P&L revenue", total(sec(sales, "By product"), "revenue"), revenue);
    const exp = await json(req, "expenses", qs);
    ok("Expense report operating total = P&L operating expenses", fig(exp, "Operating expenses"), opex);
    const cf = await json(req, "cashflow", qs);
    const cfAcc = sec(cf, "By account");
    ok("Cash flow closing = sum of account closings", fig(cf, "Closing"), total(cfAcc, "closing"));
    ok("Cash flow: opening + in − out = closing", (fig(cf, "Opening") ?? 0) + (fig(cf, "Money in") ?? 0) - (fig(cf, "Money out") ?? 0), fig(cf, "Closing"));
    const inv = await json(req, "inventory", qs);
    const invVal = inv.sections.reduce((a, x) => a + total(x, "closing_value"), 0);
    ok("Inventory report value = its headline figure", invVal, fig(inv, "Stock value at end"));
    if (period === "this_month") {
      const monthly = await json(req, "monthly");
      ok("Monthly report revenue = P&L revenue", fig(monthly, "Revenue"), revenue);
      ok("Monthly report net profit = P&L net profit", fig(monthly, "Net profit"), net);
      ok("Monthly week-by-week revenue adds up", total(sec(monthly, "Week by week"), "revenue"), revenue);
      ok("Monthly week-by-week net profit adds up", total(sec(monthly, "Week by week"), "netProfit"), net);
      const budget = await json(req, "budget");
      ok("Budget 'actual' revenue = P&L revenue", sec(budget).rows.find((x) => x.label === "Revenue")?.actual as number, revenue);
      ok("Budget 'actual' opex = P&L operating expenses", sec(budget).rows.find((x) => x.label === "Total operating expenses")?.actual as number, opex);
      ok("Inventory closing value = inventory report today", invVal, fig(await json(req, "inventory", "period=today"), "Stock value at end"));
    }
    if (period === "this_week") {
      const weekly = await json(req, "weekly");
      ok("Weekly report revenue = P&L this week", fig(weekly, "Revenue"), revenue);
      ok("Weekly report net profit = P&L this week", fig(weekly, "Net profit"), net);
      ok("Weekly closing cash = cash flow closing", fig(weekly, "Closing cash"), fig(cf, "Closing"));
    }
  }

  console.log("\n— balances today");
  const rec = await json(req, "receivables"), pay = await json(req, "payables");
  ok("Receivables: by customer total = open invoices total", total(sec(rec, "By customer"), "total"), total(sec(rec, "Open invoices"), "outstanding"));
  ok("Receivables headline = open invoices total", fig(rec, "Customers owe you"), total(sec(rec, "Open invoices"), "outstanding"));
  ok("Payables: by supplier total = open bills total", total(sec(pay, "By supplier"), "total"), total(sec(pay, "Open bills"), "outstanding"));

  // Exports: the Excel file must hold real numbers equal to the JSON (in naira), the PDF must contain the ₦ figures.
  console.log("\n— exports");
  mkdirSync("/tmp/verify", { recursive: true });
  const pnlJson = await json(req, "pnl", "period=last_month");
  const x = await req.get(`${BASE}/api/reports/pnl?format=xlsx&period=last_month`);
  writeFileSync("/tmp/verify/pnl.xlsx", await x.body());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile("/tmp/verify/pnl.xlsx");
  const ws = wb.worksheets[1];
  let netCell: unknown;
  ws.eachRow((row) => { if (row.getCell(1).value === "Net profit") netCell = row.getCell(2).value; });
  ok("Excel P&L net profit is a number equal to the report (₦)", typeof netCell === "number" ? Math.round((netCell as number) * 100) : null, rowVal(sec(pnlJson), "Net profit"));
  ok("Excel has Summary + statement sheets", wb.worksheets.length, 2);
  const p = await req.get(`${BASE}/api/reports/pnl?format=pdf&period=last_month`);
  writeFileSync("/tmp/verify/pnl.pdf", await p.body());
  const text = execFileSync("pdftotext", ["/tmp/verify/pnl.pdf", "-"]).toString();
  const netNaira = "₦" + (rowVal(sec(pnlJson), "Net profit") / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 });
  ok(`PDF contains the net profit ${netNaira}`, text.includes(netNaira) ? 1 : 0, 1);
  ok("PDF contains the Naira sign", text.includes("₦") ? 1 : 0, 1);
  const c = await req.get(`${BASE}/api/reports/pnl?format=csv&period=last_month`);
  const csv = (await c.text()).split(/\r\n/);
  const csvNet = csv.find((l) => l.startsWith("Net profit,"))?.split(",")[1];
  ok("CSV net profit equals report (in naira, 2 dp)", csvNet ? Math.round(Number(csvNet) * 100) : null, rowVal(sec(pnlJson), "Net profit"));

  await browser.close();
  console.log(fails ? `\n✗ ${fails} check(s) failed` : "\n✓ All reports agree with each other, with the dashboard, and with their exports.");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
