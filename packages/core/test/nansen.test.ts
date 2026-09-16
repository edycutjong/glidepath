import { describe, it, expect } from "vitest";
import { whoBoughtPaged, EXCLUDED_LABELS, floorHour, iso, flows } from "../src/nansen.js";
import { fakeClient, NOW } from "./helpers.js";

describe("whoBoughtPaged", () => {
  const page = (n: number, last: boolean) => ({ data: Array.from({ length: 3 }, (_, i) => ({ address: `p${n}-${i}`, bought_volume_usd: 10 })), pagination: { page: n, per_page: 1000, is_last_page: last } });
  it("sends BUY, a 7-day hour-floored window, per_page 1000, the exclude filter and a DESC sort", async () => {
    const bodies: Record<string, unknown>[] = [];
    const c = fakeClient((_e, b) => { bodies.push(b); return page(1, true); });
    await whoBoughtPaged(c, "ethereum", "0x1", NOW, { exclude: EXCLUDED_LABELS }, 20);
    const b = bodies[0] as { buy_or_sell: string; date: { from: string; to: string }; pagination: { per_page: number }; filters: { exclude_smart_money_labels: string[] }; order_by: unknown[] };
    expect(b.buy_or_sell).toBe("BUY");
    expect(b.date.to).toBe(iso(floorHour(NOW)));
    expect(Date.parse(b.date.to) - Date.parse(b.date.from)).toBe(7 * 86_400_000);
    expect(b.pagination.per_page).toBe(1000);
    expect(b.filters.exclude_smart_money_labels).toEqual([...EXCLUDED_LABELS]);
    expect(b.order_by).toEqual([{ field: "bought_volume_usd", direction: "DESC" }]);
  });
  it("stops at is_last_page and reports the page count", async () => {
    const c = fakeClient((_e, b) => { const p = (b.pagination as { page: number }).page; return page(p, p === 3); });
    const r = await whoBoughtPaged(c, "solana", "X", NOW, { include: EXCLUDED_LABELS }, 20);
    expect(r.pages).toBe(3);
    expect(r.rows).toHaveLength(9);
    expect(r.truncated).toBe(false);
  });
  it("caps at maxPages and flags truncation — the 20,000-buyer case from the spike", async () => {
    const c = fakeClient((_e, b) => page((b.pagination as { page: number }).page, false));
    const r = await whoBoughtPaged(c, "solana", "X", NOW, { exclude: EXCLUDED_LABELS }, 20);
    expect(r.pages).toBe(20);
    expect(r.truncated).toBe(true);
    expect(c.creditsSpent).toBe(20);
  });
  it("an empty page ends pagination even when is_last_page is missing", async () => {
    const c = fakeClient(() => ({ data: [], pagination: {} }));
    const r = await whoBoughtPaged(c, "base", "0x2", NOW, {}, 5);
    expect(r.pages).toBe(1);
    expect(r.rows).toEqual([]);
  });
  it("the same clock within one hour produces the same body (stable cache key)", () => {
    expect(floorHour(NOW + 20 * 60_000)).toBe(floorHour(NOW));
    expect(floorHour(NOW + 61 * 60_000)).not.toBe(floorHour(NOW));
  });
});

describe("flows", () => {
  it("asks for 14 daily buckets starting at 00:00Z with the cohort label and ascending dates", async () => {
    let body: Record<string, unknown> = {};
    const c = fakeClient((_e, b) => { body = b; return { data: [], pagination: { is_last_page: true } }; });
    await flows(c, "ethereum", "0x1", "exchange", NOW, 14);
    expect(body.label).toBe("exchange");
    expect((body.date as { from: string }).from).toMatch(/T00:00:00Z$/);
    expect(body.order_by).toEqual([{ field: "date", direction: "ASC" }]);
  });
});
