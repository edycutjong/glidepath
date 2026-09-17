import { test, expect } from "@playwright/test";

/** Smoke: the app boots with no NANSEN_API_KEY, renders the planner, carries correct meta, and logs no console errors. */
test.describe("home page without a key", () => {
  test("renders the planner with the five example chips and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(e.message));
    const res = await page.goto("/");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Sell what you must");
    await expect(page.getByPlaceholder("0x… or PEPE")).toHaveValue("PEPE");
    await expect(page.getByRole("button", { name: "Plan my glidepath" })).toBeVisible();
    for (const chip of ["PEPE · 12B", "BONK · 20B on solana", "BRETT · 3M on base", "TURBO · 50M", "SHIB2 · dead token"]) {
      await expect(page.getByRole("button", { name: chip })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test("title and description are set and the footer says it never trades", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Glidepath — sell what you must/);
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(description).toMatch(/dated selling calendar/);
    await expect(page.locator("footer")).toContainText("it never trades");
  });

  test("the page HTML never contains a Nansen key", async ({ request }) => {
    for (const path of ["/", "/judge", "/p?chain=ethereum&token=&amount=1"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(await res.text(), path).not.toMatch(/nsn_[A-Za-z0-9_-]{8,}/);
    }
  });
});
