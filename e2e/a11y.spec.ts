// Keyboard and screen-reader basics that automated scans can't see.
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", "demo@ledgr.ng");
  await page.fill("#password", "ledgr-demo");
  await Promise.all([page.waitForURL("**/dashboard**"), page.click("button[type=submit]")]);
}

test("keyboard: skip link, quick-add menu, sheets", async ({ page }) => {
  await login(page);
  await page.goto("/expenses", { waitUntil: "networkidle" });
  // First Tab reaches "Skip to content", which moves focus into the page.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();

  // The + New menu opens with the keyboard and closes with Escape.
  await page.getByRole("button", { name: "New", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByRole("menuitem").first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // A sheet opens as a modal dialog, traps focus, and Escape closes it.
  await page.getByRole("button", { name: /Add expense/ }).focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Keyboard shortcut "n" opens a new sale.
  await page.locator("main#main").focus();
  await page.keyboard.press("n");
  await page.waitForURL("**/sales/new");
});

test("every form field has a label; every icon button has a name", async ({ page }) => {
  await login(page);
  for (const path of ["/sales/new", "/inventory/purchases/new", "/inventory/production/new", "/settings?tab=business", "/settings?tab=alerts"]) {
    await page.goto(path, { waitUntil: "networkidle" });
    const unlabeled = await page.evaluate(() => [...document.querySelectorAll("main input:not([type=hidden]), main select, main textarea, main button")]
      .filter((el) => {
        const e = el as HTMLElement;
        if (e.offsetParent === null) return false;
        const name = e.getAttribute("aria-label") || e.getAttribute("aria-labelledby") || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest("label") || e.textContent?.trim() || e.getAttribute("title") || (e as HTMLInputElement).placeholder;
        return !name;
      }).map((e) => e.outerHTML.slice(0, 90)));
    expect(unlabeled, path).toEqual([]);
  }
});
