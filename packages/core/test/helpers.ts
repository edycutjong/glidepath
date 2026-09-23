import { NansenClient, type ClientOptions } from "../src/client";
import { CachedNansenClient, MemoryCache, type CachedClientOptions } from "../src/cache";
import type { Facts } from "../src/facts";

export const KEY = "nsn_test_key_0000000000000000000000";
export const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";
export const NOW = Date.parse("2026-09-16T14:30:00Z");

export type Route = (endpoint: string, body: Record<string, unknown>, method: string) => unknown;

/** A fetch whose network is a lookup table: (endpoint, body) → JSON or a Response. Records requests. */
export function fakeFetch(routes: Route, log: Array<{ endpoint: string; body: Record<string, unknown>; method: string }> = []): typeof fetch {
  return async (url, init) => {
    const u = new URL(String(url));
    const endpoint = u.pathname.replace("/api/v1/", "");
    const method = init?.method ?? "GET";
    const body = method === "POST" ? JSON.parse(String(init?.body ?? "{}")) : Object.fromEntries(u.searchParams);
    log.push({ endpoint, body, method });
    const out = routes(endpoint, body, method);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), {
      status: 200,
      headers: { "content-type": "application/json", "x-nansen-credits-used": String(creditsFor(endpoint)), "x-nansen-credits-remaining": "60000" },
    });
  };
}
const creditsFor = (e: string) => (e === "search/general" ? 0 : e === "tgm/indicators" ? 5 : 1);

export function fakeClient(routes: Route, opts: ClientOptions = {}) {
  return new NansenClient(KEY, { fetchImpl: fakeFetch(routes), rps: 1000, ...opts });
}
export function fakeCachedClient(routes: Route, opts: CachedClientOptions = {}) {
  return new CachedNansenClient(KEY, { fetchImpl: fakeFetch(routes), rps: 1000, store: new MemoryCache(), ...opts });
}

/** Facts modelled on the live PEPE probe of 2026-09-16 (every number a real response field). */
export function pepeFacts(over: Partial<Facts> = {}): Facts {
  return {
    chain: "ethereum",
    address: PEPE,
    symbol: "PEPE",
    name: "Pepe",
    logo: null,
    deployedAt: "2023-04-14 14:51:35",
    marketCapUsd: 1_404_580_000,
    circulatingSupply: 420_690_000_000_000,
    fdvUsd: 1_404_580_000,
    totalSupply: 420_690_000_000_000,
    liquidityUsd: 13_790_405,
    totalHolders: 400_472,
    totalBuy7dUsd: 3_235_907,
    uniqueBuyers7d: 528,
    proBuy7dUsd: 24_893,
    proBuyers: 1,
    proPages: 1,
    proTruncated: false,
    proLabels: ["nftsindubai.eth"],
    organicPage1Usd: 1_657_674,
    organicPage1Rows: 407,
    organicTop10Usd: 1_340_000,
    organicTop1Usd: 349_588,
    smNet1dUsd: 5,
    exNet1dUsd: -1_724_177,
    whaleNet1dUsd: 0,
    smWallets1d: 21,
    smNet7dUsd: 29_948,
    exNet7dUsd: -1_895_861,
    history: [
      { date: "2026-09-03T00:00:00Z", complete: true, priceUsd: 3.49e-6, smNetUsd: 0, exNetUsd: 0 },
      { date: "2026-09-04T00:00:00Z", complete: true, priceUsd: 3.63e-6, smNetUsd: 0, exNetUsd: 1_918_463 },
      { date: "2026-09-05T00:00:00Z", complete: true, priceUsd: 3.54e-6, smNetUsd: 0, exNetUsd: 191_065 },
      { date: "2026-09-10T00:00:00Z", complete: true, priceUsd: 3.4e-6, smNetUsd: 0, exNetUsd: 1_574_265 },
      { date: "2026-09-11T00:00:00Z", complete: true, priceUsd: 3.4e-6, smNetUsd: 33_322, exNetUsd: 1_386_698 },
      { date: "2026-09-15T00:00:00Z", complete: true, priceUsd: 3.42e-6, smNetUsd: 5, exNetUsd: -1_172_207 },
      { date: "2026-09-16T00:00:00Z", complete: false, priceUsd: 3.37e-6, smNetUsd: 0, exNetUsd: -608_112 },
    ],
    flowsPriceUsd: 3.37e-6,
    indicatorScores: { "liquidity-risk": "medium", "concentration-risk": "low", "btc-reflexivity": "high" },
    marketCapGroup: "largecap",
    isStablecoin: false,
    errors: {},
    ...over,
  };
}

export const RESOLVED = { address: PEPE, symbol: "PEPE", name: "Pepe", viaSearch: false, logo: null };

/** Full fake Nansen for the PEPE flow (search + 8 POST endpoints + quotes for solana). */
export function pepeRoutes(endpoint: string, body: Record<string, unknown>): unknown {
  const chain = String(body.chain ?? "");
  if (endpoint === "search/general") {
    return {
      tokens: [
        { name: "Pepe", symbol: "PEPE", chain: "ethereum", address: PEPE, price: 3.34e-6, market_cap: 1.4e9, rank: 1 },
        { name: "Pepe", symbol: "PEPE", chain: "base", address: "0x" + "b".repeat(40), price: 1e-8, market_cap: 1e5, rank: 3 },
        { name: "Pepe X", symbol: "PEPEX", chain: "solana", address: "Fuzzy", rank: 5 },
      ],
      entities: [],
      total_results: 3,
    };
  }
  if (endpoint === "tgm/token-information")
    return {
      data: {
        name: "Pepe",
        symbol: "PEPE",
        contract_address: PEPE,
        logo: null,
        token_details: {
          token_deployment_date: "2023-04-14 14:51:35",
          market_cap_usd: 1_404_580_000,
          fdv_usd: 1_404_580_000,
          circulating_supply: 420_690_000_000_000,
          total_supply: 420_690_000_000_000,
        },
        spot_metrics: {
          volume_total_usd: 6_788_322,
          buy_volume_usd: 3_235_907,
          sell_volume_usd: 3_552_454,
          unique_buyers: 528,
          unique_sellers: 859,
          liquidity_usd: 13_790_405,
          total_holders: 400_472,
        },
      },
    };
  if (endpoint === "tgm/who-bought-sold") {
    const f = (body.filters ?? {}) as Record<string, unknown>;
    if (f.include_smart_money_labels)
      return { data: [{ address: "0xae12", address_label: "nftsindubai.eth", bought_volume_usd: 24_893, bought_token_volume: 7.4e9 }], pagination: { page: 1, per_page: 1000, is_last_page: true } };
    return {
      data: [
        { address: "0x0c0e", address_label: "High Balance", bought_volume_usd: 349_588 },
        { address: "0x1", address_label: "", bought_volume_usd: 341_000 },
        { address: "0x2", address_label: "", bought_volume_usd: 223_192 },
        ...Array.from({ length: 50 }, (_, i) => ({ address: `0x${i}`, address_label: "", bought_volume_usd: 14_000 })),
      ],
      pagination: { page: 1, per_page: 1000, is_last_page: true },
    };
  }
  if (endpoint === "tgm/flow-intelligence") {
    const tf = body.timeframe;
    return {
      data: [
        tf === "1d"
          ? { smart_trader_net_flow_usd: 5, exchange_net_flow_usd: -1_724_177, whale_net_flow_usd: 0, smart_trader_wallet_count: 21 }
          : { smart_trader_net_flow_usd: 29_948, exchange_net_flow_usd: -1_895_861, whale_net_flow_usd: 0, smart_trader_wallet_count: 38 },
      ],
      warnings: ["exchange_wallet_count is always 0"],
    };
  }
  if (endpoint === "tgm/flows") {
    const label = body.label;
    const day = (d: string, inflow: number, outflow: number, complete = true) => ({
      date: `${d}T00:00:00Z`,
      bucket_end: `${d}T00:00:00Z`,
      is_complete: complete,
      price_usd: 3.4e-6,
      token_amount: 1e14,
      value_usd: 3.4e8,
      holders_count: 100,
      total_inflows_count: inflow,
      total_outflows_count: -outflow,
    });
    const rows =
      label === "smart_money"
        ? [day("2026-09-10", 0, 0), day("2026-09-11", 1e10, 2e8), day("2026-09-12", 0, 0), day("2026-09-15", 0, 0), day("2026-09-16", 0, 0, false)]
        : [day("2026-09-10", 8e11, 3.4e11), day("2026-09-11", 8e11, 4e11), day("2026-09-12", 1e11, 1e11), day("2026-09-15", 1e12, 1.4e12), day("2026-09-16", 7e11, 9e11, false)];
    return { data: rows, pagination: { page: 1, per_page: 100, is_last_page: true }, warnings: null };
  }
  if (endpoint === "tgm/indicators")
    return {
      token_address: body.token_address,
      chain,
      token_info: { market_cap_usd: 1.4e9, market_cap_group: "largecap", is_stablecoin: false },
      risk_indicators: [
        { indicator_type: "btc-reflexivity", score: "high", signal: 1.45, signal_percentile: 73 },
        { indicator_type: "liquidity-risk", score: "medium", signal: 0.0099, signal_percentile: 51 },
      ],
      reward_indicators: [{ indicator_type: "concentration-risk", score: "low", signal: 0.07, signal_percentile: 33 }],
    };
  if (endpoint === "trade/quote") {
    const amt = Number(body.amount);
    if (String(body.from_token).startsWith("EPjF"))
      return {
        quotes: [
          {
            aggregator: "okx",
            inAmount: "5000000",
            outAmount: "198075386149",
            priceImpactPct: "0.11",
            inUsdValue: "5",
            outUsdValue: "4.9677",
            toTokenPrice: "0.000002508",
            fromTokenDecimals: "6",
            toTokenDecimals: "5",
          },
        ],
        success: true,
      };
    const inUsd = (amt / 1e5) * 2.5e-6;
    return {
      quotes: [
        {
          aggregator: "okx",
          inAmount: String(amt),
          outAmount: "1",
          priceImpactPct: "0.29",
          inUsdValue: String(inUsd),
          outUsdValue: String(inUsd * 0.99),
          fromTokenDecimals: "5",
          toTokenDecimals: "6",
        },
      ],
      success: true,
    };
  }
  throw new Error("unexpected " + endpoint);
}
