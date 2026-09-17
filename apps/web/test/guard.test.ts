/**
 * Spend guard on POST /api/plan (apps/web/lib/guard.ts): the server key spends real credits, so past the per-IP rate
 * the route answers 429 + Retry-After, and past the day's credit ceiling an honest 503 — both before `planFor` runs.
 * `@/lib/server` is mocked as in route.coverage.test.ts so no client or network call is ever constructed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../app/api/plan/route";
import { ipAllowed, creditsLeft, recordSpend, budgetExhausted, resetGuard, clientIp, IP_PER_MIN, DAILY_CREDITS, MAX_REQUEST_CREDITS, BUDGET_MESSAGE } from "../lib/guard";

const { planForMock } = vi.hoisted(() => ({ planForMock: vi.fn() }));
vi.mock("@/lib/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/server")>();
  return { ...actual, planFor: planForMock };
});

const KEY = "nsn_guard_test_key_0000000000000000000000";
const BODY = { chain: "ethereum", token: "PEPE", amount: "1" };
const post = (ip = "203.0.113.7") =>
  POST(new Request("http://localhost/api/plan", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(BODY) }));

describe("guard counters", () => {
  beforeEach(resetGuard);

  it("clientIp prefers the first x-forwarded-for hop, then x-real-ip, then 'unknown'", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.1.1.1, 10.0.0.1" }))).toBe("1.1.1.1");
    expect(clientIp(new Headers({ "x-real-ip": "2.2.2.2" }))).toBe("2.2.2.2");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it(`an address gets ${IP_PER_MIN} requests a minute, then a Retry-After, then the window slides`, () => {
    const t0 = 1_000_000;
    for (let i = 0; i < IP_PER_MIN; i++) expect(ipAllowed("a", t0 + i)).toEqual({ ok: true });
    const blocked = ipAllowed("a", t0 + 10_000);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfter).toBe(50);
    expect(ipAllowed("b", t0 + 10_000)).toEqual({ ok: true });
    expect(ipAllowed("a", t0 + 60_001)).toEqual({ ok: true });
  });

  it("the table is bounded: 5,000 distinct addresses clear it rather than growing forever", () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("late");
    expect(ipAllowed("late").ok).toBe(false);
    for (let i = 0; i < 5_000; i++) ipAllowed(`ip-${i}`);
    expect(ipAllowed("late").ok).toBe(true);
  });

  it("the daily ceiling counts recorded spend, never refunds, and rolls over at UTC midnight", () => {
    const day1 = Date.parse("2026-09-20T12:00:00Z");
    expect(creditsLeft(day1)).toBe(DAILY_CREDITS);
    recordSpend(DAILY_CREDITS - MAX_REQUEST_CREDITS, day1);
    expect(budgetExhausted(day1)).toBe(false);
    recordSpend(1, day1);
    expect(budgetExhausted(day1)).toBe(true);
    recordSpend(-50, day1);
    expect(budgetExhausted(day1)).toBe(true);
    expect(budgetExhausted(Date.parse("2026-09-21T00:00:01Z"))).toBe(false);
  });
});

describe("POST /api/plan under the guard", () => {
  let realKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    realKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    planForMock.mockReset();
    planForMock.mockResolvedValue({ credits: 7, provenance: [], calls: 3, cachedCalls: 0, ms: 1, asOf: null });
  });
  afterEach(() => {
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
  });

  it("a successful plan records its credits against the day", async () => {
    expect((await post()).status).toBe(200);
    expect(creditsLeft()).toBe(DAILY_CREDITS - 7);
  });

  it("past the per-IP rate: 429 + Retry-After, planFor never runs; another address still gets through", async () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("203.0.113.7");
    const res = await post();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await res.json()).error).toMatch(/try again/);
    expect(planForMock).not.toHaveBeenCalled();
    expect((await post("203.0.113.8")).status).toBe(200);
  });

  it("past the daily ceiling: an honest 503 naming the reset time, planFor never runs", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await post();
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("3600");
    expect((await res.json()).error).toBe(BUDGET_MESSAGE);
    expect(planForMock).not.toHaveBeenCalled();
  });
});

describe("GET /api/og under the guard — an image never 4xxs", () => {
  let realKey: string | undefined;
  beforeEach(() => {
    resetGuard();
    realKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    planForMock.mockReset();
    planForMock.mockResolvedValue({ status: "not-found", credits: 3, tranches: [], resolved: { symbol: "X" }, input: { chain: "ethereum", amount: 1 }, statusReason: "x" });
  });
  afterEach(() => {
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
  });
  const og = async (ip: string) => (await import("../app/api/og/route")).GET(new Request(`http://localhost/api/og?chain=ethereum&token=PEPE&amount=1`, { headers: { "x-forwarded-for": ip } }));

  it("a live card records its credits against the day", async () => {
    const res = await og("203.0.113.7");
    expect(res.status).toBe(200);
    expect(planForMock).toHaveBeenCalledTimes(1);
    expect(creditsLeft()).toBe(DAILY_CREDITS - 3);
  });

  it("past the daily ceiling the card renders data-free: 200 image, planFor never runs", async () => {
    recordSpend(DAILY_CREDITS);
    const res = await og("203.0.113.7");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(planForMock).not.toHaveBeenCalled();
  });

  it("past the per-IP rate the card renders data-free too", async () => {
    for (let i = 0; i < IP_PER_MIN; i++) ipAllowed("203.0.113.7");
    expect((await og("203.0.113.7")).status).toBe(200);
    expect(planForMock).not.toHaveBeenCalled();
  });
});
