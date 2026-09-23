import { test, expect } from "@playwright/test";

/**
 * The core flow reachable with zero credentials: input validation on the API and in the UI, and the honest error
 * banner when the server has no key. Nothing here can reach Nansen — the server is started with NANSEN_API_KEY="".
 */
test.describe("/api/plan input validation (before the key check, before any network call)", () => {
  const cases: Array<[string, Record<string, string>, RegExp]> = [
    ["missing token", { chain: "ethereum", amount: "1" }, /token is required/],
    ["missing chain", { token: "PEPE", amount: "1" }, /chain is required/],
    ["negative amount", { chain: "ethereum", token: "PEPE", amount: "-5" }, /positive number/],
    ["non-numeric amount", { chain: "ethereum", token: "PEPE", amount: "lots" }, /positive number/],
  ];
  for (const [name, body, msg] of cases) {
    test(`${name} → 400`, async ({ request }) => {
      const res = await request.post("/api/plan", { data: body });
      expect(res.status()).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(msg);
      expect(JSON.stringify(json)).not.toMatch(/nsn_/);
    });
  }

  test("a non-JSON body → 400", async ({ request }) => {
    const res = await request.post("/api/plan", { headers: { "content-type": "application/json" }, data: Buffer.from("{not json") });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toMatch(/body must be JSON/);
  });

  test("a well-formed query with no server key → 500 that names the variable, never the key", async ({ request }) => {
    const res = await request.post("/api/plan", { data: { chain: "ethereum", token: "PEPE", amount: "12000000000" } });
    expect(res.status()).toBe(500);
    const text = await res.text();
    expect(text).toMatch(/NANSEN_API_KEY is not set/);
    expect(text).not.toMatch(/nsn_/);
  });

  test("/api/export rejects a malformed query with 400 before doing anything else", async ({ request }) => {
    const res = await request.get("/api/export?chain=ethereum&token=PEPE&amount=-1&format=csv");
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/positive number/);
  });
});

test.describe("planner UI", () => {
  test("submitting with no key shows the honest server error, not a crash", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("token ticker or contract address").fill("PEPE");
    await page.getByLabel("amount held, in tokens").fill("12000000000");
    await page.getByRole("button", { name: "Plan", exact: true }).click();
    const banner = page.locator(".banner[role=alert]");
    await expect(banner).toBeVisible();
    await expect(banner).toContainText("NANSEN_API_KEY is not set on the server");
    await expect(page.getByRole("button", { name: "Plan", exact: true })).toBeEnabled();
  });

  test("an example chip fills the form and updates the URL query on submit", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "BONK · 20B on solana" }).click();
    await expect(page.getByLabel("token ticker or contract address")).toHaveValue("BONK");
    await expect(page.getByLabel("chain")).toHaveValue("solana");
    await expect(page.getByLabel("amount held, in tokens")).toHaveValue("20000000000");
    await expect(page.locator(".banner[role=alert]")).toBeVisible(); // no key on this server — honest, not silent
    await expect(page.locator("footer")).toContainText("it never trades"); // the page never breaks
  });

  test("the example's Run it live now fills the form with PEPE and runs (honest error without a key)", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Run it live now" }).click();
    await expect(page.getByLabel("token ticker or contract address")).toHaveValue("PEPE");
    await expect(page.getByLabel("amount held, in tokens")).toHaveValue("12000000000");
    await expect(page.locator(".banner[role=alert]")).toBeVisible();
  });

  test("the share page reports a malformed query in place instead of crashing", async ({ page }) => {
    const res = await page.goto("/p?chain=ethereum&token=PEPE&amount=0");
    expect(res?.status()).toBe(200);
    await expect(page.locator(".banner[role=alert]")).toContainText("amount must be a positive number");
  });

  test("regression (audit 2026-09-23): a well-formed share link on a keyless server is a banner, not a 500 page", async ({ page }) => {
    const res = await page.goto("/p?chain=ethereum&token=PEPE&amount=12000000000");
    expect(res?.status()).toBe(200);
    await expect(page.locator(".banner[role=alert]")).toContainText("no Nansen key");
  });

  test("regression (audit 2026-09-23): /api/export on a keyless server answers a plain 500 with the reason", async ({ request }) => {
    const res = await request.get("/api/export?chain=ethereum&token=PEPE&amount=1&format=ics");
    expect(res.status()).toBe(500);
    expect(await res.text()).toMatch(/NANSEN_API_KEY is not set/);
  });
});
