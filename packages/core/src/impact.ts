import type { NansenClient } from "./client";
import { quote, USDC, QUOTE_CHAINS } from "./nansen";

/**
 * Constant-product impact model. `liquidityUsd` is the pool's total (both sides), so the token side is ≈ L/2.
 * Selling V dollars of token into reserves worth L/2 each returns V·(L/2)/(L/2+V); the shortfall is the cost:
 *   cost(V) = V² / (L/2 + V)
 * Optimistic when a token's depth sits in one thin pool while liquidity_usd sums several — stated in the README.
 */
export function constantProductCost(sellUsd: number, liquidityUsd: number): number {
  if (!(sellUsd > 0) || !(liquidityUsd > 0)) return 0;
  const half = liquidityUsd / 2;
  return (sellUsd * sellUsd) / (half + sellUsd);
}

export type QuoteLeg = {
  label: string;
  tokens: number;
  /** what the route pays out (USDC) */
  outUsd: number;
  /** spot value of the input at the aggregator's price */
  inUsd: number;
  costUsd: number;
  priceImpactPct: number | null;
  aggregator: string | null;
};

export type RouteQuotes = {
  decimals: number;
  spotPriceUsd: number | null;
  legs: QuoteLeg[];
  /** why a leg (or the whole probe) fell back to the model */
  errors: string[];
};

type RawQuote = {
  aggregator?: string;
  inAmount?: string;
  outAmount?: string;
  priceImpactPct?: string | number;
  inUsdValue?: string | number;
  outUsdValue?: string | number;
  fromTokenPrice?: string | number;
  toTokenPrice?: string | number;
  fromTokenDecimals?: string | number;
  toTokenDecimals?: string | number;
};

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};
const errMsg = (e: unknown) => (e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message.slice(0, 160)) : String(e));

/** Token amount → base-unit integer string (BigInt; avoids float overflow on 18-decimal tokens). */
export function toBaseUnits(tokens: number, decimals: number): string {
  if (!(tokens > 0)) return "0";
  const s = tokens.toFixed(Math.min(decimals, 20));
  const [int, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const digits = (int + fracPadded).replace(/^0+(?=\d)/, "");
  return BigInt(digits || "0").toString();
}

export function quoteSupported(chain: string): boolean {
  return (QUOTE_CHAINS as readonly string[]).includes(chain);
}

/**
 * Real route prices on solana/base via trade/quote (1 credit each):
 *   1. $5 USDC → token: learns `toTokenDecimals` and the aggregator's spot price.
 *   2. for each leg (one tranche, the whole bag): token → USDC, in base units → outUsdValue vs inUsdValue.
 * Any failure is recorded and the caller keeps the constant-product estimate for that leg.
 */
export async function fetchRouteQuotes(client: NansenClient, chain: string, token: string, legs: Array<{ label: string; tokens: number }>): Promise<RouteQuotes | null> {
  if (!quoteSupported(chain)) return null;
  const out: RouteQuotes = { decimals: 0, spotPriceUsd: null, legs: [], errors: [] };
  let probe: RawQuote | undefined;
  try {
    const q = await quote(client, chain, USDC[chain], token, "5000000", { timeoutMs: 12000, retries: 0 });
    probe = (q.quotes ?? [])[0] as RawQuote | undefined;
  } catch (e) {
    out.errors.push(`probe: ${errMsg(e)}`);
    return out;
  }
  const decimals = n(probe?.toTokenDecimals);
  if (decimals == null) {
    out.errors.push("probe returned no toTokenDecimals");
    return out;
  }
  out.decimals = decimals;
  out.spotPriceUsd = n(probe?.toTokenPrice);
  for (const leg of legs) {
    if (!(leg.tokens > 0)) continue;
    try {
      const q = await quote(client, chain, token, USDC[chain], toBaseUnits(leg.tokens, decimals), { timeoutMs: 12000, retries: 0 });
      const best = (q.quotes ?? []).map((x) => x as RawQuote).sort((a, b) => (n(b.outUsdValue) ?? 0) - (n(a.outUsdValue) ?? 0))[0];
      const outUsd = n(best?.outUsdValue),
        inUsd = n(best?.inUsdValue);
      if (outUsd == null || inUsd == null) {
        out.errors.push(`${leg.label}: quote had no USD values`);
        continue;
      }
      out.legs.push({ label: leg.label, tokens: leg.tokens, outUsd, inUsd, costUsd: Math.max(0, inUsd - outUsd), priceImpactPct: n(best?.priceImpactPct), aggregator: best?.aggregator ?? null });
    } catch (e) {
      out.errors.push(`${leg.label}: ${errMsg(e)}`);
    }
  }
  return out;
}
