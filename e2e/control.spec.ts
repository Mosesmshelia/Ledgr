// Phase 4 end-to-end: invitations, roles and stock adjustments, through the real UI.
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, email: string, password = "ledgr-demo") {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await Promise.all([page.waitForURL("**/dashboard**"), page.click("button[type=submit]")]);
}

test("owner invites a salesperson → they sign up from the link → limited view", async ({ browser }) => {
  const email = `rider-${Date.now()}@test.ng`;
  const owner = await (await browser.newContext()).newPage();
  await login(owner, "demo@ledgr.ng");
  await owner.goto("/settings?tab=team");
  await owner.getByRole("button", { name: "Invite" }).click();
  await owner.fill("#ie", email);
  await owner.getByRole("dialog").getByRole("radio", { name: /^Sales/ }).check();
  await owner.getByRole("button", { name: "Create invitation link" }).click();
  const link = (await owner.locator("code").innerText()).trim();
  expect(link).toMatch(/\/invite\/[a-f0-9]{48}$/);

  const newbie = await (await browser.newContext()).newPage();
  await newbie.goto(link);
  await expect(newbie.getByRole("heading", { name: /Join Tropic Press Juices/ })).toBeVisible();
  await newbie.getByRole("link", { name: "Create an account" }).click();
  await newbie.fill("#name", "Musa Rider");
  await expect(newbie.locator("#email")).toHaveValue(email);
  await newbie.fill("#password", "rider-pass-1");
  await newbie.click("button[type=submit]");
  await newbie.waitForURL(/\/invite\//);
  await newbie.getByRole("button", { name: "Accept and join" }).click();
  await newbie.waitForURL("**/dashboard**");
  await expect(newbie.getByRole("heading", { name: "Hello, Musa" })).toBeVisible();
  const nav = newbie.locator("aside nav");
  await expect(nav).not.toContainText("Reports");
  await newbie.goto("/reports/pnl");
  await expect(newbie).toHaveURL(/\/dashboard/);

  // The link can't be reused.
  await newbie.goto(link);
  await expect(newbie.getByText("already been used")).toBeVisible();

  // Owner sees them on the team.
  await owner.goto("/settings?tab=team");
  await expect(owner.getByText(email)).toBeVisible();
});

test("write off broken stock, then void it", async ({ page }) => {
  await login(page, "demo@ledgr.ng");
  await page.goto("/inventory");
  const href = await page.getByRole("link", { name: "Orange juice 50cl" }).first().getAttribute("href");
  await page.goto(href!, { waitUntil: "networkidle" });
  const stock = async () => (await page.getByText("In stock", { exact: true }).locator("..").innerText()).match(/In stock\s*([\d.]+)/)![1];
  const before = Number(await stock());
  await page.getByRole("button", { name: "Adjust stock" }).click();
  await page.getByRole("button", { name: "Broken" }).click();
  await page.getByRole("button", { name: /^Remove 1/ }).click();
  await expect(page.getByRole("heading", { name: "Adjustments" })).toBeVisible();
  await expect.poll(async () => Number(await stock())).toBe(before - 1);
  const row = page.locator("li", { hasText: "Broken" }).first();
  await row.getByRole("button", { name: "Void" }).click();
  await page.fill("#va-r", "Recounted, it was fine");
  await page.getByRole("button", { name: "Void adjustment" }).click();
  await expect.poll(async () => Number(await stock())).toBe(before);
  await page.goto("/settings?tab=activity&table=stock_adjustments&action=void");
  await expect(page.getByText("Reason: Recounted, it was fine")).toBeVisible();
});
