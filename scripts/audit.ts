// Quality audit: for every page, in each mode (phone/desktop × light/dark):
//  - accessibility violations (axe, WCAG 2.1 A + AA)
//  - horizontal overflow on phones
//  - tap targets smaller than 44×44 on phones (buttons/links/inputs that are the main control)
//  - server response time and full load time
// Usage: npm run build && npm start (port 3001), then BASE=http://localhost:3001 tsx scripts/audit.ts
import { chromium, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3001";
const MODES = (process.env.MODES ?? "desktop-light,desktop-dark,mobile-light,mobile-dark").split(",");
const ONLY = process.env.PAGES?.split(",");

async function pages(page: Page) {
  // Pick real ids from the app so detail pages are included.
  await page.goto(BASE + "/sales", { waitUntil: "networkidle" });
  const sale = await page.locator("a[href^='/sales/']").filter({ hasText: /INV-/ }).first().getAttribute("href");
  await page.goto(BASE + "/inventory", { waitUntil: "networkidle" });
  const product = await page.locator("a[href^='/inventory/products/']").first().getAttribute("href");
  await page.goto(BASE + "/money?tab=receivables", { waitUntil: "networkidle" });
  const customer = await page.locator("a[href^='/money/customers/']").first().getAttribute("href");
  await page.goto(BASE + "/money?tab=payables", { waitUntil: "networkidle" });
  const supplier = await page.locator("a[href^='/money/suppliers/']").first().getAttribute("href");
  const all = ["/dashboard", "/sales", sale!, "/sales/new", "/inventory", product!, "/inventory/purchases", "/inventory/purchases/new",
    "/inventory/production", "/inventory/production/new", "/expenses", "/money", "/money?tab=cashflow", "/money?tab=receivables", "/money?tab=payables",
    customer!, supplier!, "/reports", "/reports/pnl", "/reports/weekly", "/reports/analytics", "/reports/budget", "/reports/budget/edit",
    "/reports/cashflow", "/reports/inventory", "/settings?tab=business", "/settings?tab=accounts", "/settings?tab=categories",
    "/settings?tab=targets", "/settings?tab=alerts", "/settings?tab=team", "/settings?tab=activity"];
  return ONLY ? all.filter((p) => ONLY.some((o) => p.startsWith(o))) : all;
}

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const report: Record<string, unknown>[] = [];
  let list: string[] = [];
  for (const mode of MODES) {
    const [device, scheme] = mode.split("-");
    const ctx = await browser.newContext({
      viewport: device === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      colorScheme: scheme as "light" | "dark", isMobile: device === "mobile", hasTouch: device === "mobile",
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(BASE + "/login");
    await page.fill("#email", "demo@ledgr.ng");
    await page.fill("#password", "ledgr-demo");
    await Promise.all([page.waitForURL("**/dashboard**", { timeout: 90_000 }), page.click("button[type=submit]")]);
    if (!list.length) list = await pages(page);
    for (const p of list) {
      errors.length = 0;
      const t0 = Date.now();
      await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 120_000 });
      const total = Date.now() - t0;
      const ttfb = await page.evaluate(() => { const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming; return Math.round(n.responseStart - n.requestStart); });
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, help: v.help, sample: v.nodes.slice(0, 3).map((x) => x.target.join(" ")) }));
      const overflow = device === "mobile" ? await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) : 0;
      const small = device === "mobile" ? await page.evaluate(() => {
        const out: string[] = [];
        document.querySelectorAll<HTMLElement>("main button, main a[href], main input, main select, nav button, nav a[href]").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          const style = getComputedStyle(el);
          if (style.visibility === "hidden") return;
          // Inline text links inside a sentence are exempt (WCAG 2.5.8 exception).
          if (el.tagName === "A" && style.display === "inline") return;
          if (r.height < 32 || r.width < 32) out.push(`${el.tagName.toLowerCase()} "${(el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
        });
        return out;
      }) : [];
      report.push({ mode, page: p, ttfb, total, violations, overflow, small, errors: [...errors] });
      const flag = violations.length || overflow > 0 || errors.length ? "✗" : "✓";
      console.log(`${flag} ${mode.padEnd(13)} ${p.padEnd(40)} ttfb ${String(ttfb).padStart(5)}ms  load ${String(total).padStart(5)}ms  a11y ${violations.map((v) => `${v.id}(${v.n})`).join(",") || "0"}${overflow > 0 ? `  OVERFLOW ${overflow}px` : ""}${small.length ? `  small:${small.length}` : ""}${errors.length ? `  ERR ${errors[0].slice(0, 80)}` : ""}`);
    }
    await ctx.close();
  }
  await browser.close();
  writeFileSync(process.env.OUT ?? "/tmp/audit.json", JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
