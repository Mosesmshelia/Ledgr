// Fixing a product entered by mistake: delete it if unused, or cancel its opening stock and archive it, then restore.
import { test, expect, type Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", "demo@ledgr.ng");
  await page.fill("#password", "ledgr-demo");
  await Promise.all([page.waitForURL("**/dashboard**"), page.click("button[type=submit]")]);
}

async function addProduct(page: Page, name: string, openingQty?: string) {
  await page.goto("/inventory");
  await page.getByRole("button", { name: "Add product" }).first().click();
  await page.fill("#pn", name);
  if (openingQty) {
    await page.fill("#oq", openingQty);
    await page.fill("#oc", "500");
  }
  await page.getByRole("dialog").getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("link", { name })).toBeVisible();
}

test("remove a product added by mistake", async ({ page }) => {
  await login(page);
  const stamp = Date.now().toString().slice(-5);

  // 1. Never used → deleted completely.
  const typo = `Oragne jiuce ${stamp}`;
  await addProduct(page, typo);
  await page.getByRole("button", { name: `Edit ${typo}` }).click();
  await page.getByRole("button", { name: "Remove product" }).click();
  await expect(page.getByText("will be deleted completely")).toBeVisible();
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page.getByRole("link", { name: typo })).toHaveCount(0);

  // 2. Opening stock typed in by mistake → stock cancelled, product archived, then restored.
  const wrong = `Wrong zobo ${stamp}`;
  await addProduct(page, wrong, "12");
  await page.getByRole("button", { name: `Edit ${wrong}` }).click();
  await page.getByRole("button", { name: "Remove product" }).click();
  await expect(page.getByText("opening stock you entered (12")).toBeVisible();
  await page.getByRole("button", { name: "Cancel stock & archive" }).click();
  await page.waitForURL("**/inventory");
  await expect(page.getByRole("link", { name: wrong })).toHaveCount(0);

  await page.getByRole("link", { name: /Show archived products/ }).click();
  await expect(page.getByRole("link", { name: wrong })).toBeVisible();
  await page.getByRole("button", { name: `Restore ${wrong}` }).click();
  await page.goto("/inventory");
  await expect(page.getByRole("link", { name: wrong })).toBeVisible();
  await page.screenshot({ path: "test-results/remove-product-after.png" });
});
