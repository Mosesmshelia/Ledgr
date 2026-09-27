// Signs in as each demo role and walks every page: no errors, the right pages are reachable, the right
// ones redirect, and people without cost access never receive cost figures from the server.
// Usage: npm run dev, then tsx scripts/check-roles.ts
import { chromium, type Page } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const PAGES = ["/dashboard", "/sales", "/sales/new", "/inventory", "/inventory/purchases", "/inventory/purchases/new", "/inventory/production",
  "/expenses", "/money", "/money?tab=receivables", "/reports", "/reports/pnl", "/reports/weekly", "/reports/analytics", "/reports/budget/edit",
  "/settings", "/settings?tab=business", "/settings?tab=accounts", "/settings?tab=categories", "/settings?tab=targets", "/settings?tab=alerts",
  "/settings?tab=team", "/settings?tab=activity"];

// Where each role should END UP for each page (null = stays on the page).
const EXPECT: Record<string, Record<string, string | null>> = {
  "demo@ledgr.ng": {},
  "accountant@ledgr.ng": { "/settings": null, "/settings?tab=business": "/settings", "/settings?tab=team": "/settings" },
  "viewer@ledgr.ng": { "/sales/new": "/sales", "/inventory/purchases/new": "/inventory/purchases", "/reports/budget/edit": "/reports/budget",
    "/settings": "/dashboard", "/settings?tab=business": "/dashboard", "/settings?tab=accounts": "/dashboard", "/settings?tab=categories": "/dashboard",
    "/settings?tab=targets": "/dashboard", "/settings?tab=alerts": "/dashboard", "/settings?tab=team": "/dashboard", "/settings?tab=activity": "/dashboard" },
  "sales@ledgr.ng": Object.fromEntries(PAGES.filter((p) => !["/dashboard", "/sales", "/sales/new"].includes(p)).map((p) => [p, "/dashboard"])),
};

let failures = 0;
const fail = (m: string) => { failures++; console.log("  ✗ " + m); };

async function login(page: Page, email: string) {
  await page.goto(BASE + "/login");
  await page.fill("#email", email);
  await page.fill("#password", "ledgr-demo");
  await Promise.all([page.waitForURL("**/dashboard**", { timeout: 90_000 }), page.click("button[type=submit]")]);
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
  for (const email of Object.keys(EXPECT)) {
    console.log(`\n${email}`);
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await login(page, email);
    for (const p of PAGES) {
      errors.length = 0;
      const res = await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 120_000 });
      const url = new URL(page.url());
      const landed = url.pathname + (url.searchParams.get("tab") ? `?tab=${url.searchParams.get("tab")}` : "");
      const want = EXPECT[email][p] === undefined ? p : EXPECT[email][p] ?? p;
      const body = await page.locator("body").innerText();
      const ok = res && res.status() < 400 && !/Application error|Unhandled Runtime Error|permission denied/i.test(body);
      if (!ok) fail(`${p} → HTTP ${res?.status()} ${body.slice(0, 160).replace(/\s+/g, " ")}`);
      else if (landed !== want && url.pathname !== want) fail(`${p} → landed on ${landed}, expected ${want}`);
      else if (errors.length) fail(`${p} → browser error: ${errors[0]}`);
      else console.log(`  ✓ ${p}${landed !== p ? ` → ${landed}` : ""}`);
    }
    // API: report exports are refused for Sales.
    const api = await page.request.get(`${BASE}/api/reports/pnl?format=json`);
    if (email.startsWith("sales")) api.status() === 403 ? console.log("  ✓ report API refused (403)") : fail(`report API returned ${api.status()} for Sales`);
    else api.ok() ? console.log("  ✓ report API ok") : fail(`report API returned ${api.status()}`);
    // Sales never sees cost words on sale pages.
    if (email.startsWith("sales")) {
      await page.goto(BASE + "/sales", { waitUntil: "networkidle" });
      const first = page.locator("a[href^='/sales/']").filter({ hasText: /INV-/ }).first();
      const href = await first.getAttribute("href");
      await page.goto(BASE + href!, { waitUntil: "networkidle" });
      const html = await page.content();
      /Gross profit|Cost of goods|"cogs":\d|cost_status":"(actual|estimated)/.test(html) ? fail("sale page leaks costs to Sales") : console.log(`  ✓ ${href} shows no costs`);
      const nav = await page.locator("nav[aria-label=Main]").first().innerText();
      /Inventory|Reports|Settings/.test(nav) ? fail("Sales nav shows restricted sections") : console.log("  ✓ nav limited to Dashboard + Sales");
    }
    if (email.startsWith("viewer")) {
      await page.goto(BASE + "/expenses", { waitUntil: "networkidle" });
      (await page.getByRole("button", { name: /Add expense/i }).count()) ? fail("Viewer sees Add expense") : console.log("  ✓ no write buttons for Viewer");
    }
    await ctx.close();
  }
  await browser.close();
  console.log(failures ? `\n✗ ${failures} problem(s)` : "\n✓ All roles behave as expected.");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
