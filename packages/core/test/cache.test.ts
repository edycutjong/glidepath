import { describe, it, expect } from "vitest";
import { cacheKey, canonicalize, MemoryCache, LayeredCache, CachedNansenClient } from "../src/cache.js";
import { fakeCachedClient, fakeFetch, KEY } from "./helpers.js";

describe("cache", () => {
  it("cacheKey is order-independent at every depth and distinguishes GET from POST", () => {
    const a = cacheKey("tgm/flows", { chain: "ethereum", date: { from: "a", to: "b" } });
    const b = cacheKey("tgm/flows", { date: { to: "b", from: "a" }, chain: "ethereum" });
    expect(a).toBe(b);
    expect(cacheKey("trade/quote", { x: 1 }, "GET")).not.toBe(cacheKey("trade/quote", { x: 1 }, "POST"));
    expect(canonicalize({ b: [{ z: 1, y: 2 }], a: 1 })).toEqual({ a: 1, b: [{ y: 2, z: 1 }] });
  });
  it("a second identical call is served from cache: 0 credits, cached=true, oldestHit set, network hit once", async () => {
    let n = 0;
    const c = fakeCachedClient(() => ({ n: n++ }));
    const first = await c.post("tgm/token-information", { chain: "ethereum", token_address: "0x1", timeframe: "7d" });
    const second = await c.post("tgm/token-information", { token_address: "0x1", chain: "ethereum", timeframe: "7d" });
    expect(first).toEqual(second);
    expect(n).toBe(1);
    expect(c.calls[1]).toMatchObject({ cached: true, credits: 0 });
    expect(c.creditsSpent).toBe(1);
    expect(c.oldestHit).toBeTruthy();
  });
  it("ttlMs: 0 bypasses reads (--no-cache) but still writes", async () => {
    let n = 0;
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, { fetchImpl: fakeFetch(() => ({ n: n++ })), store, ttlMs: 0, rps: 1000 });
    await c.post("tgm/flows", { a: 1 });
    await c.post("tgm/flows", { a: 1 });
    expect(n).toBe(2);
    expect(store.size).toBe(1);
  });
  it("offline mode serves any age and never touches the network; a miss throws", async () => {
    const store = new MemoryCache();
    store.set(cacheKey("tgm/flows", { a: 1 }), { storedAt: "2020-01-01T00:00:00Z", ttlMs: 1, endpoint: "tgm/flows", body: { a: 1 }, text: '{"old":true}' });
    let n = 0;
    const c = new CachedNansenClient(KEY, { fetchImpl: fakeFetch(() => ({ n: n++ })), store, offline: true, rps: 1000 });
    expect(await c.post("tgm/flows", { a: 1 })).toEqual({ old: true });
    await expect(c.post("tgm/flows", { a: 2 })).rejects.toThrow(/NANSEN_OFFLINE/);
    expect(n).toBe(0);
  });
  it("a failed live call is recorded in provenance and not cached", async () => {
    const store = new MemoryCache();
    const c = new CachedNansenClient(KEY, { fetchImpl: fakeFetch(() => new Response("x", { status: 400 })), store, rps: 1000 });
    await expect(c.post("tgm/flows", { a: 1 })).rejects.toThrow(/HTTP 400/);
    expect(c.calls[0].ok).toBe(false);
    expect(store.size).toBe(0);
  });
  it("LayeredCache reads through to the second layer and promotes the hit", () => {
    const mem = new MemoryCache(), disk = new MemoryCache();
    const entry = { storedAt: "2026-01-01T00:00:00Z", ttlMs: 1, endpoint: "e", body: {}, text: "{}" };
    disk.set("k", entry);
    const l = new LayeredCache([mem, disk]);
    expect(l.get("k")).toEqual(entry);
    expect(mem.get("k")).toEqual(entry);
    expect(l.get("missing")).toBeUndefined();
  });
});
