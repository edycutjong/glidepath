import { test, expect } from "@playwright/test";

const CLAIM = "dated selling calendar sized to the market's organic demand";

/** /judge must be reachable with no credentials and no session, and must carry the claim, the path, the receipts and the limits. */
test.describe("/judge", () => {
  test("returns 200 with no cookies, no auth and no redirect, and contains the claim sentence", async ({ request }) => {
    const res = await request.get("/judge", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.headers()["set-cookie"]).toBeUndefined();
    const html = await res.text();
    expect(html).toContain(CLAIM);
    expect(html).not.toMatch(/nsn_[A-Za-z0-9_-]{8,}/);
  });

  test("renders the claim, the 30-second path, the receipts, both reproduce blocks and the honest limits", async ({ page }) => {
    await page.goto("/judge");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("For the judge");
    await expect(page.locator("p.claim")).toContainText(CLAIM);
    for (const h of ["The claim", "The 30-second path", "Receipts (real runs, not estimates)", "Reproduce", "Honest limits", "Links"]) {
      await expect(page.getByRole("heading", { level: 2, name: h })).toBeVisible();
    }
    await expect(page.locator("ol > li")).toHaveCount(5);
    await expect(page.locator("pre").first()).toContainText("npm run glidepath -- PEPE --chain ethereum --amount 12000000000");
    await expect(page.locator("pre").nth(1)).toContainText("npm run verify");
    await expect(page.getByText("60,000 generated cases")).toBeVisible();
    await expect(page.locator("main.judge ul > li")).toHaveCount(3);
    await expect(page.getByRole("link", { name: "Live app" })).toHaveAttribute("href", "https://glidepath.edycu.dev");
    await expect(page.getByRole("link", { name: "Repository" })).toHaveAttribute("href", "https://github.com/edycutjong/glidepath");
    await expect(page.getByRole("navigation", { name: "site" }).getByRole("link", { name: "For the judge" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator("footer.site-footer")).toBeVisible();
  });
});
