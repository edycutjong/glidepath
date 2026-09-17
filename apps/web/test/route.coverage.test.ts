/**
 * Covers the two branches of `apps/web/app/api/plan/route.ts` that api-boundary.test.ts intentionally never
 * reaches: the happy path (`planFor` resolves → 200 with the plan and a no-store header) and the network/engine
 * failure path (`planFor` rejects → 502 with the error message, truncated to 300 chars). `@/lib/server` is
 * mocked wholesale so no real client, cache, or network call is ever constructed — `parseInput` is re-exported
 * from the real module (via importOriginal) so validation behaviour stays exactly what production uses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../app/api/plan/route";

const { planForMock } = vi.hoisted(() => ({ planForMock: vi.fn() }));

vi.mock("@/lib/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/server")>();
  return { ...actual, planFor: planForMock };
});

const KEY = "nsn_route_coverage_test_key_00000000000000";
const VALID_BODY = { chain: "ethereum", token: "PEPE", amount: "1" };
const post = (body: unknown) => POST(new Request("http://localhost/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("POST /api/plan — request body fields default via ?? when absent (not just empty)", () => {
  it("a body with no amount key at all (undefined, not '') still 400s as a non-positive amount", async () => {
    const res = await post({ chain: "ethereum", token: "PEPE" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/positive number/);
  });
});

describe("POST /api/plan — planFor success and failure paths (key set, input valid)", () => {
  let realKey: string | undefined;

  beforeEach(() => {
    realKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    planForMock.mockReset();
  });
  afterEach(() => {
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
  });

  it("planFor resolves → 200 with the plan body and a no-store cache-control header", async () => {
    const plan = { status: "ok", days: 3, calendar: [] };
    planForMock.mockResolvedValueOnce(plan);
    const res = await post(VALID_BODY);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual(plan);
    expect(planForMock).toHaveBeenCalledWith({ chain: "ethereum", token: "PEPE", amount: 1 });
  });

  it("planFor rejects with an Error → 502 with that error's message", async () => {
    planForMock.mockRejectedValueOnce(new Error("upstream Nansen call failed"));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upstream Nansen call failed");
  });

  it("an error message longer than 300 chars is truncated to exactly 300 chars in the response", async () => {
    const longMessage = "x".repeat(400);
    planForMock.mockRejectedValueOnce(new Error(longMessage));
    const res = await post(VALID_BODY);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toHaveLength(300);
    expect(body.error).toBe("x".repeat(300));
  });
});
