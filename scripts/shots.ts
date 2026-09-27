// Screenshot pages at phone and desktop sizes, light and dark. Usage: tsx scripts/shots.ts /dashboard /sales ...
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = process.env.OUT ?? "/tmp/shots";
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ["/dashboard"];
const modes = (process.env.MODES ?? "desktop-light,mobile-light").split(",");

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" }).catch(() => chromium.launch());
  for (const mode of modes) {
    const [device, scheme] = mode.split("-");
    const ctx = await browser.newContext({
      viewport: device === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 1000 },
      deviceScaleFactor: device === "mobile" ? 2 : 1,
      colorScheme: scheme as "light" | "dark",
      isMobile: device === "mobile", hasTouch: device === "mobile",
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.error("pageerror", e.message));
    page.on("console", (m) => m.type() === "error" && console.error("console", m.text()));
    await page.goto(BASE + "/login");
    await page.fill("#email", process.env.EMAIL ?? "demo@ledgr.ng");
    await page.fill("#password", "ledgr-demo");
    await Promise.all([page.waitForURL("**/dashboard**", { timeout: 60000 }), page.click("button[type=submit]")]);
    for (const p of pages) {
      await page.goto(BASE + p, { waitUntil: "networkidle", timeout: 90000 });
      await page.waitForTimeout(400);
      const name = `${OUT}/${p.replace(/[/?=&]/g, "_").replace(/^_/, "") || "root"}-${mode}.png`;
      await page.screenshot({ path: name, fullPage: true });
      console.log(name);
    }
    await ctx.close();
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
