// Ledgr 2.0 features: tap-to-sell till, recipe batches, shopping list (demo data).
import { test, expect, type Page } from "@playwright/test";
import { Client } from "pg";

/** Start the recipe test from a clean slate (demo database only). */
async function forgetRecipe(name: string) {
  const c = new Client({ connectionString: process.env.E2E_DATABASE_URL ?? "postgres://postgres@localhost:54322/ledgr" });
  await c.connect();
  await c.query("delete from recipes where product_id in (select id from products where name ilike $1)", [name + "%"]);
  await c.end();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.fill("#email", "demo@ledgr.ng");
  await page.fill("#password", "ledgr-demo");
  await Promise.all([page.waitForURL("**/dashboard**"), page.click("button[type=submit]")]);
}

test("till: tap products, charge, next sale, repeat last", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("link", { name: "Sell" }).click();
  await page.waitForURL("**/sales/new");
  const tiles = page.locator("button[aria-label*='₦']:not([aria-label*='out of stock'])");
  const first = tiles.nth(0), second = tiles.nth(1);
  const firstName = (await first.getAttribute("aria-label"))!.split(",")[0];
  await first.click(); await first.click(); await second.click();
  const receipt = page.getByRole("region", { name: "This sale" });
  await expect(receipt.getByRole("heading")).toHaveText("3 items");
  await receipt.getByRole("button", { name: `One less ${firstName}` }).click();
  await expect(receipt.getByRole("heading")).toHaveText("2 items");
  await page.getByRole("radio", { name: "Cash" }).click();
  await page.getByRole("button", { name: /^Charge/ }).click();
  const done = page.getByRole("dialog", { name: "Sale saved" });
  await expect(done).toContainText("Paid by cash");
  await done.getByRole("button", { name: "Next sale" }).click();
  await expect(receipt.getByRole("heading")).toHaveText("This sale");
  await page.getByRole("button", { name: "Repeat last" }).click();
  await expect(receipt.getByRole("heading")).toHaveText("2 items");
});

test("recipe: save once, then the batch fills itself in and scales", async ({ page }) => {
  await forgetRecipe("Pineapple");
  await login(page);
  const pick = async (trigger: string, text: string) => {
    await page.getByRole("button", { name: trigger }).first().click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  };
  await page.goto("/inventory/production/new");
  await pick("e.g. Orange juice 50cl", "Pineapple");
  await page.getByLabel("Quantity").first().fill("20");
  await pick("Choose ingredient", "Sugar");
  await page.getByLabel("Quantity").nth(1).fill("2");
  await expect(page.getByText(/Save as the recipe|Update the recipe/)).toBeVisible();
  await page.getByRole("button", { name: "Save batch" }).click();
  await page.waitForURL("**/inventory/production?made=1");

  await page.goto("/inventory/production/new");
  await pick("e.g. Orange juice 50cl", "Pineapple");
  await expect(page.getByText(/Using your recipe/)).toBeVisible();
  await page.getByLabel("Quantity").first().fill("40");
  await expect(page.getByLabel("Quantity").nth(1)).toHaveValue("4");
});

test("shopping list: low stock appears, ticks off, shares on WhatsApp", async ({ page }) => {
  await login(page);
  await page.goto("/shopping");
  await expect(page.getByRole("heading", { name: "To buy" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Share list on WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
  const box = page.getByRole("checkbox").first();
  await box.click();
  await expect(box).toHaveAttribute("aria-checked", "true");
  await page.reload();
  await expect(page.getByRole("checkbox").first()).toHaveAttribute("aria-checked", "true"); // remembered on this device
  await page.getByRole("button", { name: "Start the list fresh" }).click();
});
