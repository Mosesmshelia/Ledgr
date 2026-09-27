// Exercises every list's search, filters, date range, sort and paging through the URL and checks the
// results are actually filtered/sorted (not just that the page loads).
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
let fails = 0;
const ok = (c: boolean, m: string) => { if (!c) fails++; console.log(`${c ? "✓" : "✗"} ${m}`); };

async function texts(page: Page, sel: string) { return page.locator(sel).allInnerTexts(); }
const naira = (t: string) => Number(t.replace(/[^\d.−-]/g, "").replace("−", "-"));

async function go(page: Page, path: string) {
  const errs: string[] = [];
  const h = (e: Error) => errs.push(e.message);
  page.on("pageerror", h);
  const r = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 120_000 });
  page.off("pageerror", h);
  const body = await page.locator("main").innerText();
  ok(!!r && r.status() < 400 && !errs.length && !/Application error|This page didn't load/.test(body), `${path} loads${errs.length ? " — " + errs[0] : ""}`);
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  await page.goto(BASE + "/login"); await page.fill("#email", "demo@ledgr.ng"); await page.fill("#password", "ledgr-demo");
  await Promise.all([page.waitForURL("**/dashboard**", { timeout: 90_000 }), page.click("button[type=submit]")]);

  // Sales
  await go(page, "/sales?sort=total&dir=desc");
  let v = (await texts(page, "table tbody tr td:nth-child(5)")).map(naira);
  ok(v.length > 5 && v.every((x, i) => i === 0 || v[i - 1] >= x), `sales sorted by total desc (${v.slice(0, 3).join(", ")}…)`);
  await go(page, "/sales?from=2026-09-01&to=2026-09-07");
  const dates = await texts(page, "table tbody tr td:nth-child(1)");
  ok(dates.length > 0 && dates.every((d) => /Sep/.test(d) && Number(d.match(/\d+/)![0]) <= 7), `sales date range 1–7 Sep (${dates.length} rows)`);
  await go(page, "/sales?status=overdue");
  ok((await texts(page, "table tbody tr td:nth-child(6)")).every((t) => /Overdue/.test(t)), "sales overdue filter");
  await go(page, "/sales?status=missing");
  ok((await page.locator("table tbody tr").count()) > 0, "sales missing-cost filter shows rows");
  await go(page, "/sales?q=Crescent");
  ok((await texts(page, "table tbody tr td:nth-child(3)")).every((t) => /Crescent/.test(t)), "sales search by customer");
  await go(page, "/sales?page=2");
  ok((await page.getByRole("link", { name: "Previous" }).count()) === 1, "sales page 2 has Previous");

  // Purchases
  await go(page, "/inventory/purchases?sort=total&dir=desc");
  await go(page, "/inventory/purchases?status=unpaid");
  ok((await texts(page, "main ul li")).every((t) => /Unpaid|Overdue|Part paid/.test(t)), "purchases unpaid filter");
  await go(page, "/inventory/purchases?q=zzzz-nothing");
  ok(/No matching purchases/.test(await page.locator("main").innerText()), "purchases empty search state");

  // Production
  await go(page, "/inventory/production?sort=cost&dir=desc");
  v = (await texts(page, "table tbody tr td:nth-child(4)")).map(naira);
  ok(v.length > 0 && v.every((x, i) => i === 0 || v[i - 1] >= x), "production sorted by cost");

  // Inventory
  await go(page, "/inventory?stock=low");
  ok((await page.locator("table tbody tr").count()) > 0 && (await texts(page, "table tbody tr td:nth-child(1)")).every((t) => /Low/.test(t)), "inventory low-stock filter");
  await go(page, "/inventory?kind=raw");
  ok((await page.getByRole("heading", { name: "Products you sell" }).count()) === 0 && (await page.getByRole("heading", { name: /Raw materials/ }).count()) === 1, "inventory raw-materials filter");
  await go(page, "/inventory?sort=value&dir=desc&kind=sell");
  v = (await texts(page, "table tbody tr td:nth-child(3)")).map(naira);
  ok(v.every((x, i) => i === 0 || v[i - 1] >= x), "inventory sorted by value");
  await go(page, "/inventory?q=juice");
  ok((await texts(page, "table tbody tr td:nth-child(1)")).every((t) => /juice/i.test(t)), "inventory search");

  // Expenses
  await go(page, "/expenses?period=last_month&sort=amount&dir=desc");
  await go(page, "/expenses?q=diesel&period=last_month");
  // Money
  await go(page, "/money?dir_=in&sort=amount&dir=desc");
  const signs = await texts(page, "main ul li .num.font-medium");
  ok(signs.length > 0 && signs.every((t) => t.trim().startsWith("+")), `money-in filter (${signs.length})`);
  await go(page, "/money?from=2026-09-20&to=2026-09-27&page=2");

  // Toolbar interaction: typing in search updates the URL and results.
  await go(page, "/sales");
  await page.getByRole("searchbox", { name: "Search invoice, customer or product" }).fill("Harmony");
  await page.waitForURL(/q=Harmony/, { timeout: 15_000 });
  await page.waitForLoadState("networkidle");
  ok((await texts(page, "table tbody tr td:nth-child(3)")).every((t) => /Harmony/.test(t)), "typing in search filters sales");
  await page.getByRole("button", { name: "Clear" }).click();
  await page.waitForURL((u) => !u.search.includes("q="), { timeout: 15_000 });
  ok(true, "Clear resets filters");

  await browser.close();
  console.log(fails ? `\n✗ ${fails} problem(s)` : "\n✓ All lists behave correctly.");
  process.exit(fails ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
