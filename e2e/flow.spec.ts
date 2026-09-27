// End-to-end: a brand-new owner signs up, sets up the business, buys stock, makes a credit sale,
// and the dashboard shows exactly the right numbers.
//
// Expected (hand-calculated):
//   Opening stock 10 × ₦1,000, purchase 10 × ₦1,100 (paid from Bank), sale 12 × ₦1,500 = ₦18,000, ₦8,000 paid in cash.
//   COGS (FIFO) = 10 × ₦1,000 + 2 × ₦1,100 = ₦12,200 → gross profit ₦5,800
//   Cash = ₦10,000 opening − ₦11,000 purchase + ₦8,000 = ₦7,000
//   Customers owe ₦10,000 · stock left 8 × ₦1,100 = ₦8,800
import { test, expect, type Page } from "@playwright/test";

async function pick(page: Page, trigger: ReturnType<Page["locator"]>, text: string) {
  await trigger.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

test("sign up → onboarding → purchase → credit sale → correct dashboard", async ({ page }) => {
  const email = `e2e-${Date.now()}@test.ng`;
  await page.goto("/signup");
  await page.fill("#name", "Ada Okafor");
  await page.fill("#email", email);
  await page.fill("#password", "correct-horse-9");
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");

  // Step 1 — business
  await page.fill("#bn", "E2E Juice Bar");
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 2 — money: Cash ₦10,000, Bank ₦0
  await page.getByLabel("Balance today").first().fill("10000");
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 3 — expenses: skip
  await page.getByRole("button", { name: "Skip for now" }).click();
  // Step 4 — products
  await page.getByLabel("Product name").fill("Test Juice");
  await page.getByLabel("Price").fill("1500");
  await page.getByLabel("Cost each").fill("1000");
  await page.getByLabel("In stock").fill("10");
  await page.getByRole("button", { name: "Continue" }).click();
  // Step 5 — targets: finish
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL("**/dashboard**");
  await expect(page.getByRole("heading", { name: "Get set up" })).toBeVisible();
  await expect(page.getByText("2 of 5 done")).toBeVisible(); // product + opening stock from onboarding

  // Purchase 10 more at ₦1,100, paid from Bank
  await page.goto("/inventory/purchases/new");
  await page.getByRole("button", { name: "+ New supplier" }).click();
  await page.getByPlaceholder("New supplier name").fill("Fresh Fruit Co");
  await pick(page, page.getByRole("button", { name: "Choose a product" }), "Test");
  await page.getByLabel("Quantity").fill("10");
  await page.getByLabel("Cost each").fill("1100");
  await page.getByRole("radio", { name: "Bank" }).click();
  await page.getByRole("button", { name: "Save purchase" }).click();
  await page.waitForURL("**/inventory/purchases");
  await expect(page.getByText("Fresh Fruit Co")).toBeVisible();

  // Credit sale: 12 × ₦1,500 to a new customer, ₦8,000 paid in cash
  await page.goto("/sales/new");
  await page.locator("#customer").click();
  await page.getByRole("button", { name: "New customer" }).click();
  await page.fill("#cn", "Ada Stores");
  await page.getByRole("button", { name: "Add customer" }).click();
  await pick(page, page.getByRole("button", { name: "Choose a product" }), "Test");
  await page.getByLabel("Quantity").fill("12");
  await page.getByRole("radio", { name: "Part paid" }).click();
  await page.getByLabel("Amount paid now").fill("8000");
  await page.getByRole("radio", { name: "Cash" }).click();
  await expect(page.locator("text=₦18,000").first()).toBeVisible();
  await page.getByRole("button", { name: "Save sale" }).last().click();
  await page.waitForURL("**/sales/*?new=1");
  await expect(page.getByText("Sale saved.")).toBeVisible();
  await expect(page.getByText("Part paid")).toBeVisible();

  // Dashboard (today)
  await page.goto("/dashboard?period=today");
  const card = (label: string) => page.getByRole("button", { name: new RegExp(`^${label}:`) });
  await expect(card("Revenue")).toContainText("₦18k");
  await expect(card("Gross profit")).toContainText("₦5.8k");
  await expect(card("Money you have")).toContainText("₦7k");
  await expect(page.getByRole("link", { name: /Customers owe you/ })).toContainText("₦10k");
  await expect(page.getByRole("link", { name: /Stock value/ })).toContainText("₦8.8k");

  // "How was this calculated?" shows the exact FIFO cost
  await card("Gross profit").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toContainText("₦12,200.00");
  await expect(sheet).toContainText("₦5,800.00");
});

test("add an expense in seconds, then void it with a reason", async ({ page }) => {
  const email = `e2e-exp-${Date.now()}@test.ng`;
  await page.goto("/signup");
  await page.fill("#name", "Tunde Bello");
  await page.fill("#email", email);
  await page.fill("#password", "correct-horse-9");
  await page.click("button[type=submit]");
  await page.waitForURL("**/onboarding");
  await page.fill("#bn", "Void Test Ltd");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Balance today").first().fill("50000");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Skip for now" }).click();
  await page.getByRole("button", { name: "Finish" }).click();
  await page.waitForURL("**/dashboard**");

  await page.goto("/expenses?add=1");
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("radio", { name: "Generator & fuel" }).click();
  await sheet.locator("input[inputmode=decimal]").first().fill("12500");
  await sheet.getByRole("button", { name: "Save ₦12,500" }).click();
  await expect(page.getByText("Operating expenses · this month")).toBeVisible();
  await expect(page.locator("text=₦12,500").first()).toBeVisible();

  await page.getByRole("button", { name: "Void expense" }).click();
  const v = page.getByRole("dialog", { name: "Void expense?" });
  await v.locator("textarea").fill("Recorded by mistake");
  await v.getByRole("button", { name: "Void expense" }).click();
  await expect(page.getByText("Voided: Recorded by mistake")).toBeVisible();
  await page.goto("/money");
  await expect(page.getByText("You have ₦50,000")).toBeVisible();   // the money is back
});

test("record a production batch and see it in stock (demo data)", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "demo@ledgr.ng");
  await page.fill("#password", "ledgr-demo");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard**");
  await expect(page.getByText("In a nutshell")).toBeVisible();

  await page.goto("/inventory/production/new");
  await pick(page, page.getByRole("button", { name: "Choose product" }), "Zobo");
  await page.getByLabel("Quantity").first().fill("50");
  await pick(page, page.getByRole("button", { name: "Choose ingredient" }), "Sugar");
  await page.getByLabel("Quantity").nth(1).fill("3");
  await page.getByLabel("Amount").fill("5000");
  await page.getByRole("button", { name: "Save batch" }).click();
  await page.waitForURL("**/inventory/production");
  const row = page.getByRole("row").filter({ hasText: "Zobo 50cl" }).first();
  await expect(row).toContainText("50");

  // Weekly report and P&L render with their data-quality badge
  await page.goto("/reports/weekly");
  await expect(page.getByText("The week in plain English")).toBeVisible();
  await page.goto("/reports/pnl");
  await expect(page.getByRole("cell", { name: "Net profit" })).toBeVisible();
});

test("set a budget, see budget vs actual, and download a PDF (demo data)", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "demo@ledgr.ng");
  await page.fill("#password", "ledgr-demo");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard**");

  await page.goto("/reports/budget/edit");
  const repairs = page.getByLabel("Repairs & maintenance budget");
  await repairs.fill("50000");
  await page.getByRole("button", { name: "Save budgets" }).click();
  await page.waitForURL("**/reports/budget?month=*");
  const row = page.getByRole("row").filter({ hasText: "Repairs & maintenance" });
  await expect(row).toContainText("₦50,000");

  await page.getByRole("button", { name: "Export" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: /PDF/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/budget.*\.pdf$/);

  // Analytics renders its breakdowns
  await page.goto("/reports/analytics");
  await expect(page.getByRole("heading", { name: "By payment method" })).toBeVisible();
});
