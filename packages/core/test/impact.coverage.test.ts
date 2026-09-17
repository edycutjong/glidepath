import { describe, it, expect } from "vitest";
import { fetchRouteQuotes, quoteSupported } from "../src/impact";
import { fakeClient, type Route } from "./helpers";

const TOKEN = "TokenMintAddress11111111111111111111111111";

/** Feeds canned trade/quote responses (or throws) to successive calls, in call order. */
function scripted(steps: Array<{ data: unknown } | { throw: unknown }>): Route {
  let i = 0;
  return (endpoint) => {
    if (endpoint !== "trade/quote") throw new Error("unexpected endpoint: " + endpoint);
    const step = steps[i++];
    if (!step) throw new Error("scripted(): ran out of steps at call #" + i);
    if ("throw" in step) throw step.throw;
    return step.data;
  };
}

describe("quoteSupported", () => {
  it("true for solana and base, false for every other chain", () => {
    expect(quoteSupported("solana")).toBe(true);
    expect(quoteSupported("base")).toBe(true);
    expect(quoteSupported("ethereum")).toBe(false);
    expect(quoteSupported("")).toBe(false);
  });
});

describe("fetchRouteQuotes — unsupported chain", () => {
  it("returns null without making any client call", async () => {
    const client = fakeClient(() => {
      throw new Error("must not be called for an unsupported chain");
    });
    const result = await fetchRouteQuotes(client, "ethereum", TOKEN, [{ label: "all", tokens: 100 }]);
    expect(result).toBeNull();
  });
});

describe("fetchRouteQuotes — probe failures", () => {
  it("probe request failure (plain Error) records 'probe: <message>' and returns with no legs", async () => {
    const client = fakeClient(
      scripted([{ throw: new Error("connection reset by peer, and then some extra text past the one-sixty cutoff that should never appear because it is not sliced here") }]),
    );
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [{ label: "tranche 1", tokens: 1000 }]);
    expect(result).not.toBeNull();
    expect(result!.errors[0]).toMatch(/^probe: connection reset by peer/);
    expect(result!.legs).toEqual([]);
    expect(result!.decimals).toBe(0);
    expect(result!.spotPriceUsd).toBeNull();
  });

  it("probe timeout (AbortError-named Error) records 'probe: timeout'", async () => {
    const client = fakeClient(scripted([{ throw: Object.assign(new Error("aborted"), { name: "AbortError" }) }]));
    const result = await fetchRouteQuotes(client, "solana", TOKEN, []);
    expect(result!.errors).toEqual(["probe: timeout"]);
  });

  it("probe failure with a non-Error thrown value falls back to String(e)", async () => {
    const client = fakeClient(scripted([{ throw: "socket hang up" }]));
    const result = await fetchRouteQuotes(client, "solana", TOKEN, []);
    expect(result!.errors).toEqual(["probe: socket hang up"]);
  });

  it("probe succeeds but the quotes array is empty → 'probe returned no toTokenDecimals'", async () => {
    const client = fakeClient(scripted([{ data: { quotes: [], success: true } }]));
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [{ label: "x", tokens: 1 }]);
    expect(result!.errors).toEqual(["probe returned no toTokenDecimals"]);
    expect(result!.decimals).toBe(0);
    expect(result!.legs).toEqual([]);
  });

  it("probe response missing 'quotes' entirely also falls back to no toTokenDecimals (?? [] path)", async () => {
    const client = fakeClient(scripted([{ data: { success: true } }]));
    const result = await fetchRouteQuotes(client, "solana", TOKEN, []);
    expect(result!.errors).toEqual(["probe returned no toTokenDecimals"]);
  });
});

describe("fetchRouteQuotes — legs, happy path and edge values", () => {
  it("skips non-positive-token legs, tolerates a numeric (non-string) decimals field, a missing spot price, ties broken by outUsdValue, and an aggregator-less winner falls back to null", async () => {
    const client = fakeClient(
      scripted([
        // probe: toTokenDecimals as a raw number (not a string) and no toTokenPrice at all
        { data: { quotes: [{ toTokenDecimals: 6, aggregator: "jupiter" }] } },
        // leg "tranche": two candidate quotes, one missing outUsdValue (sort must tolerate the null via `?? 0`)
        {
          data: {
            quotes: [
              { outUsdValue: "500", inUsdValue: "550", priceImpactPct: "1.2" },
              { aggregator: "okx", outUsdValue: undefined, inUsdValue: "10", priceImpactPct: "0.5" },
            ],
          },
        },
      ]),
    );
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [
      { label: "skip-me", tokens: 0 },
      { label: "tranche", tokens: 500 },
    ]);
    expect(result!.decimals).toBe(6);
    expect(result!.spotPriceUsd).toBeNull();
    expect(result!.errors).toEqual([]);
    expect(result!.legs).toEqual([{ label: "tranche", tokens: 500, outUsd: 500, inUsd: 550, costUsd: 50, priceImpactPct: 1.2, aggregator: null }]);
  });

  it("leg quote missing outUsdValue records '<label>: quote had no USD values' and keeps other legs going", async () => {
    const client = fakeClient(
      scripted([
        { data: { quotes: [{ toTokenDecimals: "6" }] } },
        { data: { quotes: [{ inUsdValue: "10" }] } }, // no outUsdValue
      ]),
    );
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [{ label: "tranche", tokens: 100 }]);
    expect(result!.errors).toEqual(["tranche: quote had no USD values"]);
    expect(result!.legs).toEqual([]);
  });

  it("leg quote missing inUsdValue also records 'quote had no USD values' (right operand of the OR)", async () => {
    const client = fakeClient(
      scripted([
        { data: { quotes: [{ toTokenDecimals: "6" }] } },
        { data: { quotes: [{ outUsdValue: "10" }] } }, // no inUsdValue
      ]),
    );
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [{ label: "tranche", tokens: 100 }]);
    expect(result!.errors).toEqual(["tranche: quote had no USD values"]);
  });

  it("leg quote response missing 'quotes' entirely also yields 'no USD values' (?? [] path on the leg side)", async () => {
    const client = fakeClient(
      scripted([
        { data: { quotes: [{ toTokenDecimals: "6" }] } },
        { data: {} }, // no quotes field at all
      ]),
    );
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [{ label: "tranche", tokens: 100 }]);
    expect(result!.errors).toEqual(["tranche: quote had no USD values"]);
  });

  it("a leg quote failure records '<label>: <message>' and subsequent legs still run, including one with a real aggregator", async () => {
    const client = fakeClient(
      scripted([
        { data: { quotes: [{ toTokenDecimals: "6" }] } },
        { throw: new Error("rate limited") },
        { data: { quotes: [{ aggregator: "raydium", outUsdValue: "300", inUsdValue: "310", priceImpactPct: "0.8" }] } },
      ]),
    );
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [
      { label: "tranche 1", tokens: 100 },
      { label: "tranche 2", tokens: 200 },
    ]);
    expect(result!.errors).toEqual(["tranche 1: rate limited"]);
    expect(result!.legs).toEqual([{ label: "tranche 2", tokens: 200, outUsd: 300, inUsd: 310, costUsd: 10, priceImpactPct: 0.8, aggregator: "raydium" }]);
  });

  it("a tie between two candidates both missing outUsdValue exercises the '?? 0' fallback on both sides of the sort", async () => {
    const client = fakeClient(
      scripted([
        { data: { quotes: [{ toTokenDecimals: "6" }] } },
        { data: { quotes: [{ inUsdValue: "1" }, { inUsdValue: "2" }] } }, // neither entry has outUsdValue
      ]),
    );
    const result = await fetchRouteQuotes(client, "solana", TOKEN, [{ label: "tranche", tokens: 100 }]);
    expect(result!.errors).toEqual(["tranche: quote had no USD values"]);
  });

  it("base chain is also supported end to end", async () => {
    const client = fakeClient(
      scripted([{ data: { quotes: [{ toTokenDecimals: "18", toTokenPrice: "1.5" }] } }, { data: { quotes: [{ outUsdValue: "9", inUsdValue: "10" }] } }]),
    );
    const result = await fetchRouteQuotes(client, "base", TOKEN, [{ label: "all", tokens: 5 }]);
    expect(result!.decimals).toBe(18);
    expect(result!.spotPriceUsd).toBe(1.5);
    expect(result!.legs[0].costUsd).toBe(1);
  });
});
