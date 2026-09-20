import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { glidepath } from "../src/glidepath";
import { fakeCachedClient, fakeClient, pepeRoutes, PEPE, NOW } from "./helpers";

// A footgun fix: a real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — every
// fakeCachedClient below is meant to hit its fake network, so the ambient env is neutralized for each test.
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

describe("glidepath end to end (fake Nansen)", () => {
  it("PEPE on ethereum: 9 calls, 12 credits, plan ok, provenance lists every endpoint with fields", async () => {
    const c = fakeCachedClient(pepeRoutes);
    const p = await glidepath(c, { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 }, { now: NOW });
    expect(p.status).toBe("ok");
    expect(p.resolved.address).toBe(PEPE);
    expect(p.calls).toBe(9);
    expect(p.credits).toBe(12);
    expect(new Set(p.provenance.map((x) => x.endpoint))).toEqual(new Set(["search/general", "tgm/token-information", "tgm/who-bought-sold", "tgm/flow-intelligence", "tgm/flows", "tgm/indicators"]));
    expect(p.provenance.every((x) => x.fieldsUsed.length > 0)).toBe(true);
    expect(p.quotes).toBeNull(); // ethereum: no route quotes
    expect(p.dumpToday.model).toBe("constant-product");
  });
  it("a second run on the same client is fully cached: 0 credits, same hash, asOf set", async () => {
    const c = fakeCachedClient(pepeRoutes);
    const a = await glidepath(c, { chain: "ethereum", token: PEPE, amount: 12_000_000_000 }, { now: NOW });
    const b = await glidepath(c, { chain: "ethereum", token: PEPE, amount: 12_000_000_000 }, { now: NOW });
    expect(b.credits).toBe(0);
    expect(b.cachedCalls).toBe(b.calls);
    expect(b.hash).toBe(a.hash);
    expect(b.asOf).toBeTruthy();
  });
  it("solana: three trade/quote GETs (probe, one tranche, whole bag) relabel the costs as route quotes", async () => {
    const routes = (e: string, b: Record<string, unknown>) => pepeRoutes(e, e === "search/general" ? b : b);
    const c = fakeCachedClient((e, b) => {
      if (e === "search/general")
        return { tokens: [{ name: "Bonk", symbol: "BONK", chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", rank: 1 }], entities: [], total_results: 1 };
      return routes(e, b);
    });
    const p = await glidepath(c, { chain: "solana", token: "BONK", amount: 500_000_000 }, { now: NOW });
    const quotes = p.provenance.filter((x) => x.endpoint === "trade/quote");
    expect(quotes).toHaveLength(3);
    expect(quotes[0].method).toBe("GET");
    expect(p.quotes?.decimals).toBe(5);
    expect(p.dumpToday.model).toBe("route-quote");
    expect(p.glidepath.model).toBe("route-quote");
  });
  it("one failing endpoint never crashes the plan: the term is null, the error is named, the rest proceeds", async () => {
    const c = fakeCachedClient((e, b) => (e === "tgm/indicators" ? new Response('{"error":"not found"}', { status: 404 }) : pepeRoutes(e, b)));
    const p = await glidepath(c, { chain: "ethereum", token: PEPE, amount: 1e9 }, { now: NOW });
    expect(p.status).toBe("ok");
    expect(p.errors.indicators).toMatch(/HTTP 404/);
    expect(p.risk.k).toBeCloseTo(0.07, 4);
    expect(p.provenance.find((x) => x.endpoint === "tgm/indicators")!.ok).toBe(false);
  });
  it("unknown chain / bad amount / unknown ticker are not-found with a reason, never a throw", async () => {
    const c = fakeClient(pepeRoutes);
    expect((await glidepath(c, { chain: "mars", token: "PEPE", amount: 1 })).statusReason).toMatch(/unknown chain "mars"/);
    expect((await glidepath(c, { chain: "ethereum", token: "PEPE", amount: -3 })).statusReason).toMatch(/positive number/);
    const nf = await glidepath(c, { chain: "solana", token: "PEPE", amount: 1 });
    expect(nf.status).toBe("not-found");
    expect(nf.warnings[0]).toMatch(/PEPE exists on ethereum/);
    expect(nf.hash).toHaveLength(64);
  });
});

describe("qa round 1 — symbol fallback", () => {
  it("an empty symbol from token-information falls back to the search symbol, then a short address", async () => {
    const c = fakeCachedClient((e, b) => {
      const out = pepeRoutes(e, b) as { data?: Record<string, unknown> };
      if (e === "tgm/token-information") return { data: { ...out.data, symbol: "", name: "" } };
      return out;
    });
    const viaTicker = await glidepath(c, { chain: "ethereum", token: "PEPE", amount: 1e9 }, { now: NOW });
    expect(viaTicker.resolved.symbol).toBe("PEPE");
    const viaAddress = await glidepath(c, { chain: "ethereum", token: PEPE, amount: 1e9 }, { now: NOW });
    expect(viaAddress.resolved.symbol).toBe("0x6982…");
  });
});
