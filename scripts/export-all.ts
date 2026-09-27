// Downloads every report in PDF, CSV and Excel through the running app (same path a user takes)
// and saves them to OUT (default /tmp/reports). Usage: npm run dev, then tsx scripts/export-all.ts
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/reports";
const KINDS = ["pnl", "sales", "expenses", "cashflow", "products", "receivables", "payables", "inventory", "weekly", "monthly", "budget"];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await browser.newPage();
  await page.goto(BASE + "/login");
  await page.fill("#email", "demo@ledgr.ng");
  await page.fill("#password", "ledgr-demo");
  await Promise.all([page.waitForURL("**/dashboard**", { timeout: 90_000 }), page.click("button[type=submit]")]);
  let failed = 0;
  for (const kind of KINDS) {
    for (const format of ["pdf", "csv", "xlsx"]) {
      const res = await page.request.get(`${BASE}/api/reports/${kind}?format=${format}${process.env.QS ? "&" + process.env.QS : ""}`, { timeout: 120_000 });
      const name = /filename="([^"]+)"/.exec(res.headers()["content-disposition"] ?? "")?.[1] ?? `${kind}.${format}`;
      if (!res.ok()) { failed++; console.log(`✗ ${kind} ${format}: ${res.status()} ${(await res.text()).slice(0, 200)}`); continue; }
      const body = await res.body();
      writeFileSync(`${OUT}/${name}`, body);
      console.log(`✓ ${kind.padEnd(12)} ${format.padEnd(5)} ${String(body.length).padStart(8)} bytes  ${name}`);
    }
  }
  await browser.close();
  process.exit(failed ? 1 : 0);
}
main();
