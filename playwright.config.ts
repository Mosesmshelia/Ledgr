import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:3000",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { executablePath: process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" },
    trace: "retain-on-failure",
  },
  reporter: [["list"]],
});
