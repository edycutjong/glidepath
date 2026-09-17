import { describe, it, expect } from "vitest";
import { searchTokens, whoBoughtPaged, EXCLUDED_LABELS } from "../src/nansen";
import { fakeClient, NOW } from "./helpers";

describe("searchTokens — remaining coverage gaps", () => {
  it("with no chain: the body omits the chain field entirely", async () => {
    let body: Record<string, unknown> = {};
    const c = fakeClient((_e, b) => {
      body = b;
      return { tokens: [], total_results: 0 };
    });
    await searchTokens(c, "pepe");
    expect("chain" in body).toBe(false);
    expect(body.search_query).toBe("pepe");
    expect(body.limit).toBe(25);
  });
  it("with a chain: the body carries that chain alongside the query", async () => {
    let body: Record<string, unknown> = {};
    const c = fakeClient((_e, b) => {
      body = b;
      return { tokens: [], total_results: 0 };
    });
    await searchTokens(c, "pepe", "base");
    expect(body.chain).toBe("base");
  });
});

describe("whoBoughtPaged — remaining coverage gaps", () => {
  it("a response with no data field at all is treated as an empty page (nullish fallback) and stops pagination", async () => {
    const c = fakeClient(() => ({ pagination: { page: 1, per_page: 1000, is_last_page: true } }));
    const r = await whoBoughtPaged(c, "ethereum", "0x1", NOW, { exclude: EXCLUDED_LABELS }, 5);
    expect(r.rows).toEqual([]);
    expect(r.pages).toBe(1);
    expect(r.truncated).toBe(false);
  });
  it("a response with no pagination field at all still stops (optional-chained is_last_page reads as undefined, not false)", async () => {
    const c = fakeClient(() => ({ data: [{ address: "0xabc", bought_volume_usd: 1 }] }));
    const r = await whoBoughtPaged(c, "ethereum", "0x1", NOW, {}, 5);
    expect(r.pages).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.truncated).toBe(false);
  });
  it("is_last_page explicitly false but the data page is empty still stops (the OR's second operand alone decides)", async () => {
    const c = fakeClient(() => ({ data: [], pagination: { page: 1, per_page: 1000, is_last_page: false } }));
    const r = await whoBoughtPaged(c, "ethereum", "0x1", NOW, {}, 5);
    expect(r.pages).toBe(1);
    expect(r.rows).toEqual([]);
    expect(r.truncated).toBe(false);
  });
  it("is_last_page explicitly false with no data field at all still stops (nullish fallback feeds the OR's second operand)", async () => {
    const c = fakeClient(() => ({ pagination: { page: 1, per_page: 1000, is_last_page: false } }));
    const r = await whoBoughtPaged(c, "ethereum", "0x1", NOW, {}, 5);
    expect(r.pages).toBe(1);
    expect(r.rows).toEqual([]);
    expect(r.truncated).toBe(false);
  });
});
