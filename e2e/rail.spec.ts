import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { fulfillStream } from "./_ndjson";

/**
 * The Nansen call rail (family spec §13 A3): a landmark that streams every Nansen call. With no key on this server the
 * live path is exercised by replaying a recorded fixture through the real NDJSON wire format (e2e/_ndjson.ts) — every
 * row the rail shows is one of the fixture's own Call objects, and its totals must equal the drawer's.
 */
const pepe = JSON.parse(readFileSync(new URL("../fixtures/0X6982508145--ETHEREUM.json", import.meta.url), "utf8"));
const bonk = JSON.parse(readFileSync(new URL("../fixtures/DEZXAZ8Z7PNR--SOLANA.json", import.meta.url), "utf8"));

test.describe("rail · the recorded example on load", () => {
  test("is a landmark with one replayed row per example call, labelled 0 credits", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    await expect(rail).toBeAttached();
    await expect(rail.locator(".rail-row")).toHaveCount(pepe.plan.provenance.length);
    await expect(rail.locator(".rail-row.replayed")).toHaveCount(pepe.plan.provenance.length);
    await expect(rail.locator(".rail-row").first()).toContainText("replayed · 0 cr");
    await expect(rail.locator(".rail-foot")).toContainText(`session · ${pepe.plan.provenance.length} calls · 0 credits`);
    await expect(rail.locator(".rail-row")).toContainText(pepe.plan.provenance.map((c: { endpoint: string }) => c.endpoint));
    await expect(rail.locator(".rail-row")).not.toContainText([/nsn_/]);
  });

  test("clear empties the session and shows the empty state pointing at the example button", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    const bar = rail.locator(".rail-bar");
    if (await bar.isVisible()) await bar.click(); // below 1280 px the sheet is collapsed
    await rail.getByRole("button", { name: "clear" }).click();
    await expect(rail.locator(".rail-row")).toHaveCount(0);
    await expect(rail.locator(".rail-empty")).toContainText("run the example live");
  });
});

test.describe("rail · a live run (fixture replayed over the real NDJSON wire)", () => {
  test("rows land as green/grey, header counters equal the drawer's totals, and rows accumulate across runs", async ({ page }) => {
    await page.route("**/api/plan?stream=1", fulfillStream(pepe.plan));
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    const before = await rail.locator(".rail-row").count();
    await page.getByRole("button", { name: "Run it live now" }).click();
    await expect(page.locator(".banner")).toBeVisible();
    const p = pepe.plan;
    await expect(rail.locator(".rail-row")).toHaveCount(before + p.provenance.length);
    await expect(rail.locator(".rail-row.pending")).toHaveCount(0);
    await expect(rail.locator(".rail-row.live")).toHaveCount(p.provenance.filter((c: { cached: boolean; ok: boolean }) => !c.cached && c.ok).length);
    await expect(rail.locator(".rail-row.cached")).toHaveCount(p.provenance.filter((c: { cached: boolean }) => c.cached).length);
    await expect(rail.locator(".rail-counters")).toContainText(`${p.calls} calls · ${p.credits} cr · ${(p.ms / 1000).toFixed(1)} s`);
    await page.getByRole("button", { name: `Every Nansen call (${p.calls})` }).click();
    await expect(page.locator(".drawer .sum")).toContainText(`${p.credits} credits · ${p.calls} calls`);
    await expect(page.locator(".drawer tbody tr")).toHaveCount(p.calls);
    // a second run accumulates in the same session
    await page.unroute("**/api/plan?stream=1");
    await page.route("**/api/plan?stream=1", fulfillStream(bonk.plan));
    await page.getByRole("button", { name: "BONK · 20B on solana" }).click();
    await expect(page.locator(".banner")).toBeVisible();
    await expect(rail.locator(".rail-row")).toHaveCount(before + p.provenance.length + bonk.plan.provenance.length);
    await expect(rail.locator(".rail-foot")).toContainText(`session · ${before + p.calls + bonk.plan.calls} calls · ${p.credits + bonk.plan.credits} credits`);
  });

  test("a failed run (no key on this server) leaves no ghost pending rows", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    const before = await rail.locator(".rail-row").count();
    await page.getByRole("button", { name: "Run it live now" }).click();
    await expect(page.locator(".banner[role=alert]")).toBeVisible();
    await expect(rail.locator(".rail-row")).toHaveCount(before);
    await expect(rail.locator(".rail-row.pending")).toHaveCount(0);
  });
});

test.describe("rail · 1920×1080 (the recording viewport)", () => {
  test.use({ viewport: { width: 1920, height: 1080 } });
  test("is a fixed 360 px right rail, always visible, and the page column leaves room for it", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    await expect(rail).toBeVisible();
    const box = await rail.boundingBox();
    expect(box?.width).toBe(360);
    expect(box && box.x + box.width).toBe(1920 - 24);
    expect(box?.y).toBe(84);
    await expect(rail.locator(".rail-bar")).toBeHidden();
    await expect(rail.locator(".rail-row").first()).toBeVisible();
    const main = await page.locator("main.wrap").boundingBox();
    expect(main && main.x + main.width).toBeLessThanOrEqual(1920 - 408);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

test.describe("rail · 390 px", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("collapses to a 44 px bar that opens and closes with a tap and with Enter", async ({ page }) => {
    await page.goto("/");
    const rail = page.getByRole("complementary", { name: "Nansen API calls" });
    const bar = rail.getByRole("button", { name: /Nansen calls/ });
    await expect(bar).toBeVisible();
    const bb = await bar.boundingBox();
    expect(bb?.height).toBe(44);
    await expect(bar).toHaveAttribute("aria-expanded", "false");
    await expect(rail.locator(".rail-row").first()).toBeHidden();
    await bar.click();
    await expect(bar).toHaveAttribute("aria-expanded", "true");
    await expect(rail.locator(".rail-row").first()).toBeVisible();
    const open = await rail.boundingBox();
    expect(open?.height ?? 0).toBeLessThanOrEqual(844 * 0.6 + 1);
    await bar.focus();
    await page.keyboard.press("Enter");
    await expect(bar).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("Enter");
    await expect(bar).toHaveAttribute("aria-expanded", "true");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
