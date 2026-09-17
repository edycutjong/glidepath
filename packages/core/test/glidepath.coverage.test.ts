import { describe, it, expect } from "vitest";
import { glidepath } from "../src/glidepath";
import { fakeClient, pepeRoutes, PEPE, NOW } from "./helpers";

describe("glidepath — coverage gap: resolveToken throws before returning a Resolution", () => {
  it("search/general returning a non-retryable HTTP error propagates through resolveToken and lands as not-found", async () => {
    // status 400 is neither 429 nor >=500, so client.post throws immediately (no retry delay) —
    // this exercises the catch(e) branch in glidepath() that never runs when resolveToken resolves normally.
    const c = fakeClient((e, b) => (e === "search/general" ? new Response('{"message":"search backend down"}', { status: 400 }) : pepeRoutes(e, b)));
    const p = await glidepath(c, { chain: "ethereum", token: "PEPE", amount: 1e9 }, { now: NOW });
    expect(p.status).toBe("not-found");
    expect(p.statusReason).toMatch(/^search\/general failed: .*search backend down/);
    // resolved falls back to the raw input token/ticker with viaSearch true, per the catch branch's `empty(...)` call
    expect(p.resolved.symbol).toBe("PEPE");
    expect(p.resolved.address).toBe("");
    // the failed search/general call itself is still recorded in provenance
    expect(p.provenance.some((x) => x.endpoint === "search/general" && !x.ok)).toBe(true);
    expect(p.hash).toHaveLength(64);
  });

  it("an address-shaped token input still goes through resolveToken (no HTTP call) so a thrown error there would be impossible — sanity check the happy path is unaffected", async () => {
    // looksLikeAddress short-circuits resolveToken before any fetch, so this path can never hit the catch(e) branch;
    // included only to confirm the coverage test above didn't change any other behaviour of glidepath().
    const c = fakeClient(pepeRoutes);
    const p = await glidepath(c, { chain: "ethereum", token: PEPE, amount: 1e9 }, { now: NOW });
    expect(p.status).toBe("ok");
  });
});

describe("glidepath — coverage gap: resolved symbol/name fall all the way to the address", () => {
  it("both facts.symbol and the search/resolved symbol are empty: resolved.symbol falls to the address prefix, resolved.name to res.name", async () => {
    // resolveToken's `same()` matches on symbol OR name, so a token can match the "PEPE" query purely via its
    // name while carrying an empty symbol — the only way an `ok: true` resolution yields a falsy res.symbol.
    const routes = (e: string, b: Record<string, unknown>) => {
      if (e === "search/general") return { tokens: [{ name: "PEPE", symbol: "", chain: "ethereum", address: PEPE, price: 3.34e-6, rank: 1 }], entities: [], total_results: 1 };
      const out = pepeRoutes(e, b) as { data?: Record<string, unknown> };
      if (e === "tgm/token-information") return { data: { ...out.data, symbol: "", name: "" } };
      return out;
    };
    const c = fakeClient(routes);
    const p = await glidepath(c, { chain: "ethereum", token: "PEPE", amount: 1e9 }, { now: NOW });
    // facts.symbol === "" (falsy) and res.symbol === "" (falsy) → falls through to res.address.slice(0, 6) + "…"
    expect(p.resolved.symbol).toBe(PEPE.slice(0, 6) + "…");
    // facts.name === "" (falsy) → falls through to res.name, which is "PEPE" here
    expect(p.resolved.name).toBe("PEPE");
  });
});

describe("glidepath — coverage gap: the one-tranche quote leg falls back to tranches[0] when every tranche is red", () => {
  it("a single-tranche plan whose only day is a red day: `.find(t => !t.red)` is undefined, so the one-tranche leg uses tranches[0] (itself red)", async () => {
    // Force today red via a very negative Smart Money 1d net flow, well past theta.smUsd for these organic-demand numbers.
    const routes = (e: string, b: Record<string, unknown>) => {
      if (e === "tgm/flow-intelligence" && b.timeframe === "1d")
        return { data: [{ smart_trader_net_flow_usd: -999_999_999, exchange_net_flow_usd: 0, whale_net_flow_usd: 0, smart_trader_wallet_count: 21 }], warnings: [] };
      return pepeRoutes(e, b);
    };
    const c = fakeClient(routes);
    // A base58 address on a quote-supported chain skips search entirely; a tiny amount guarantees the whole bag
    // fits inside the single (halved, red) day-0 tranche, so sizeTranches never reaches day 1.
    const solanaAddress = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const p = await glidepath(c, { chain: "solana", token: solanaAddress, amount: 100 }, { now: NOW });
    expect(p.status).toBe("ok");
    expect(p.tranches).toHaveLength(1);
    expect(p.tranches[0].red).toBe(true);
    expect(p.today.red).toBe(true);
    // route quotes still ran (chain is quote-supported) — the one-tranche leg was priced off tranches[0], not undefined
    expect(p.quotes?.legs.some((l) => l.label === "one-tranche")).toBe(true);
    expect(p.dumpToday.model).toBe("route-quote");
  });

  it("an amount below sizeTranches' 1e-12 dust floor produces zero tranches (not truncated): `one` is undefined, so the one-tranche leg falls back to 0 tokens", async () => {
    // amount > 0 passes glidepath's own guard, but sizeTranches' loop guard is `left > 1e-12`: at 1e-13 the loop
    // body never runs, so tranches stay [] with truncated:false (status stays "ok", not "thin"). That makes both
    // `plan.tranches.find(t => !t.red)` AND the `?? plan.tranches[0]` fallback undefined — the only way `one` itself
    // is undefined — which exercises the `one?.tokens ?? 0` branch on the very next line.
    const solanaAddress = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263";
    const c = fakeClient(pepeRoutes);
    const p = await glidepath(c, { chain: "solana", token: solanaAddress, amount: 1e-13 }, { now: NOW });
    expect(p.status).toBe("ok");
    expect(p.truncated).toBe(false);
    expect(p.tranches).toHaveLength(0);
    // the whole-bag leg still ran (amount is a positive, if dust, number); the one-tranche leg was skipped at 0 tokens
    expect(p.quotes?.legs.some((l) => l.label === "whole-bag")).toBe(true);
    expect(p.quotes?.legs.some((l) => l.label === "one-tranche")).toBe(false);
  });
});
