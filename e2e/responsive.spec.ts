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
