import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against the production build of apps/web started WITHOUT a Nansen key: nothing here spends a credit or
 * needs a secret. What is covered without a key — the home page, /judge, responsive layout, the input-validation
 * 400 path, and the boundary that no page or API response ever carries an nsn_ key.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // the key is deliberately unset: the E2E surface must work with zero credentials
    env: { NANSEN_API_KEY: "", NEXT_TELEMETRY_DISABLED: "1" },
  },
});
