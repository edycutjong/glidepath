import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";

const viewports = [
  { name: "narrow", width: 320, height: 640 },
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1440, height: 900 },
];

for (const vp of viewports) {
  test.describe(`${vp.name} ${vp.width}px`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("no horizontal overflow on / and /judge; header fits; controls are tappable", async ({ page }) => {
      for (const path of ["/", "/judge"]) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
        const nav = await page.locator("header.site-header").boundingBox();
        expect(nav?.width).toBeLessThanOrEqual(vp.width);
      }
      await page.goto("/");
      for (const name of ["Plan", "PEPE · 12B", "Run it live now"]) {
        const box = await page.getByRole("button", { name, exact: name === "Plan" }).boundingBox();
        expect(box?.height ?? 0, name).toBeGreaterThanOrEqual(36);
        expect(box?.width ?? 0, name).toBeGreaterThanOrEqual(36);
      }
    });
  });
}

/**
 * Regression (README screenshot retake, 2026-09-17): a 90-tranche thin plan (60 bars drawn) widened the plan card — and with it the whole
 * page — to 2,560 px on a phone, because a grid item's min-width is `auto` and the scrollable tranche row set the card's
 * min-content width. The API is mocked with the recorded TURBO fixture so no credential and no network is needed.
 */
test.describe("mobile 375px · 90-tranche plan", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the tranche row scrolls inside the card; the page never overflows horizontally", async ({ page }) => {
    const fixture = JSON.parse(readFileSync(new URL("../fixtures/0XA35923162C--ETHEREUM.json", import.meta.url), "utf8"));
    await page.route("**/api/plan", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(fixture.plan) }));
    await page.goto("/");
    await page.getByRole("button", { name: "TURBO · 50M" }).click();
    await expect(page.locator(".tranche")).toHaveCount(60); // the UI draws the first 60 bars, then "+30 more"
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `page overflows by ${overflow}px`).toBeLessThanOrEqual(1);
    const card = await page.locator(".card.winner").boundingBox();
    expect(card?.width ?? 9999).toBeLessThanOrEqual(375);
  });
});
