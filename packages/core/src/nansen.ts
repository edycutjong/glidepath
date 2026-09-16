/**
 * Typed wrappers for the Nansen endpoints Glidepath uses. Request bodies follow docs/api openapi.json (2026-09-16)
 * and were verified live; response types list only the fields the engine reads.
 */
import type { NansenClient, CallOptions } from "./client";

/** Chains accepted by the TGM endpoints (OpenAPI `TGMChain` enum). */
export const TGM_CHAINS = [
  "arbitrum", "avalanche", "base", "bnb", "ethereum", "hyperevm", "injective", "iotaevm", "linea", "mantle", "mantra", "monad",
  "near", "optimism", "plasma", "polygon", "robinhood", "sei", "solana", "sonic", "starknet", "sui", "ton", "tron",
] as const;
export type Chain = (typeof TGM_CHAINS)[number];
export function isChain(s: string): s is Chain { return (TGM_CHAINS as readonly string[]).includes(s); }

/** Chains where `trade/quote` can price a route (OpenAPI trade/quote description). */
export const QUOTE_CHAINS = ["solana", "base"] as const;
export const USDC: Record<string, string> = {
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  base: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
};

/**
 * Labels that make a buyer "not organic": Nansen's Smart Money tiers, funds, whales, exchanges and the Telegram
 * sniper-bot user tags. From the OpenAPI `LabelType` enum; Public Figure / LP / miner labels are deliberately kept —
 * those are people, not the cohort a forced seller must avoid competing with.
 */
export const EXCLUDED_LABELS = [
  "Smart Trader", "30D Smart Trader", "90D Smart Trader", "180D Smart Trader", "Fund", "Whale", "Exchange",
  "Maestro Bot User", "Top Maestro Bot User", "BananaGun Bot User", "Top BananaGun Bot User",
] as const;

export type WhoBoughtSoldRow = {
  address: string;
  address_label?: string | null;
  bought_token_volume?: number | null;
  sold_token_volume?: number | null;
  bought_volume_usd?: number | null;
  sold_volume_usd?: number | null;
};
export type WhoBoughtSoldResponse = { data: WhoBoughtSoldRow[]; pagination: { page: number; per_page: number; is_last_page: boolean } };

export type TokenInformation = {
  data: {
    name?: string | null; symbol?: string | null; contract_address?: string | null; logo?: string | null;
    token_details?: {
      token_deployment_date?: string | null; market_cap_usd?: number | null; fdv_usd?: number | null;
      circulating_supply?: number | null; total_supply?: number | null;
    } | null;
    spot_metrics?: {
      volume_total_usd?: number | null; buy_volume_usd?: number | null; sell_volume_usd?: number | null;
      unique_buyers?: number | null; unique_sellers?: number | null; liquidity_usd?: number | null; total_holders?: number | null;
    } | null;
  };
};

export type FlowIntelligence = {
  data: Array<{
    smart_trader_net_flow_usd?: number | null; smart_trader_wallet_count?: number | null;
    whale_net_flow_usd?: number | null; exchange_net_flow_usd?: number | null;
    top_pnl_net_flow_usd?: number | null; fresh_wallets_net_flow_usd?: number | null;
  }>;
  warnings?: string[] | null;
};

export type FlowsRow = {
  date: string; bucket_end?: string | null; is_complete?: boolean | null; price_usd?: number | null;
  token_amount?: number | null; value_usd?: number | null; holders_count?: number | null;
  /** despite the name these are token AMOUNTS (verified live: PEPE exchange inflows 8.6e11 tokens/day) */
  total_inflows_count?: number | null; total_outflows_count?: number | null;
  total_inflows_cex?: number | null; total_outflows_cex?: number | null;
};
export type FlowsResponse = { data: FlowsRow[]; pagination: { is_last_page: boolean }; warnings?: string[] | null };

export type Indicator = { indicator_type: string; score?: string | null; signal?: number | null; signal_percentile?: number | null };
export type IndicatorsResponse = {
  token_info?: { market_cap_usd?: number | null; market_cap_group?: string | null; is_stablecoin?: boolean | null };
  risk_indicators: Indicator[]; reward_indicators: Indicator[];
};

export type SearchToken = { name: string; symbol: string; chain: string; address: string; price?: number | null; market_cap?: number | null; rank?: number | null };
export type SearchResponse = { tokens: SearchToken[]; total_results: number };

export type QuoteResponse = { quotes: Array<Record<string, unknown>> } & Record<string, unknown>;

export const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
/** Floor to the hour so the who-bought-sold window (and its cache key) is stable within the hour. */
export const floorHour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;
export const DAY = 86_400_000;

export function searchTokens(client: NansenClient, query: string, chain?: string, opts?: CallOptions) {
  return client.post<SearchResponse>("search/general", { search_query: query, result_type: "token", ...(chain ? { chain } : {}), limit: 25 },
    ["tokens[].symbol", "tokens[].name", "tokens[].chain", "tokens[].address", "tokens[].rank", "tokens[].price"], opts);
}

export function tokenInformation(client: NansenClient, chain: string, token: string, timeframe: "1d" | "7d" = "7d", opts?: CallOptions) {
  return client.post<TokenInformation>("tgm/token-information", { chain, token_address: token, timeframe },
    ["data.symbol", "data.name", "token_details.market_cap_usd", "token_details.circulating_supply", "token_details.fdv_usd", "token_details.total_supply",
      "token_details.token_deployment_date", "spot_metrics.buy_volume_usd", "spot_metrics.unique_buyers", "spot_metrics.liquidity_usd", "spot_metrics.total_holders"], opts);
}

export type WhoBoughtSoldPage = { rows: WhoBoughtSoldRow[]; pages: number; truncated: boolean };

/**
 * Page `tgm/who-bought-sold` (BUY side, last 7 days ending at the hour) with a label filter, 1000 rows per page,
 * stopping at `is_last_page` or `maxPages`. Every page is one credit.
 */
export async function whoBoughtPaged(
  client: NansenClient, chain: string, token: string, now: number,
  filter: { exclude?: readonly string[]; include?: readonly string[] }, maxPages: number, opts?: CallOptions,
): Promise<WhoBoughtSoldPage> {
  const to = floorHour(now);
  const from = to - 7 * DAY;
  const filters: Record<string, unknown> = {};
  if (filter.exclude) filters.exclude_smart_money_labels = [...filter.exclude];
  if (filter.include) filters.include_smart_money_labels = [...filter.include];
  const rows: WhoBoughtSoldRow[] = [];
  let pages = 0;
  for (let page = 1; page <= maxPages; page++) {
    const res = await client.post<WhoBoughtSoldResponse>("tgm/who-bought-sold", {
      chain, token_address: token, buy_or_sell: "BUY", date: { from: iso(from), to: iso(to) },
      pagination: { page, per_page: 1000 }, filters, order_by: [{ field: "bought_volume_usd", direction: "DESC" }],
    }, ["data[].bought_volume_usd", "data[].bought_token_volume", "data[].address_label", "pagination.is_last_page"], opts);
    pages++;
    rows.push(...(res.data ?? []));
    if (res.pagination?.is_last_page !== false || (res.data ?? []).length === 0) return { rows, pages, truncated: false };
  }
  return { rows, pages, truncated: true };
}

export function flowIntelligence(client: NansenClient, chain: string, token: string, timeframe: "1d" | "7d", opts?: CallOptions) {
  return client.post<FlowIntelligence>("tgm/flow-intelligence", { chain, token_address: token, timeframe },
    ["data[0].smart_trader_net_flow_usd", "data[0].exchange_net_flow_usd", "data[0].whale_net_flow_usd", "data[0].smart_trader_wallet_count"], opts);
}

/** Daily cohort flows for the last `days` days (buckets are daily for ranges over 7 days). */
export function flows(client: NansenClient, chain: string, token: string, label: "smart_money" | "exchange", now: number, days = 14, opts?: CallOptions) {
  const toMs = floorHour(now);
  const fromMs = Math.floor((toMs - days * DAY) / DAY) * DAY;
  return client.post<FlowsResponse>("tgm/flows", {
    chain, token_address: token, date: { from: iso(fromMs), to: iso(toMs) }, label,
    pagination: { page: 1, per_page: 100 }, order_by: [{ field: "date", direction: "ASC" }],
  }, ["data[].date", "data[].is_complete", "data[].price_usd", "data[].total_inflows_count", "data[].total_outflows_count"], opts);
}

export function indicators(client: NansenClient, chain: string, token: string, opts?: CallOptions) {
  return client.post<IndicatorsResponse>("tgm/indicators", { chain, token_address: token },
    ["risk_indicators[].indicator_type", "risk_indicators[].score", "reward_indicators[].indicator_type", "reward_indicators[].score"], opts);
}

/** A neutral wallet for quote personalisation (the quote never executes; a wallet is required by the endpoint). */
export const QUOTE_WALLET: Record<string, string> = {
  solana: "11111111111111111111111111111111",
  base: "0x000000000000000000000000000000000000dEaD",
};

export function quote(client: NansenClient, chain: string, fromToken: string, toToken: string, amountBase: string, opts?: CallOptions) {
  return client.get<QuoteResponse>("trade/quote", { chain, from_token: fromToken, to_token: toToken, amount: amountBase, wallet_address: QUOTE_WALLET[chain], slippage: 50 },
    ["quotes[].to_amount / out amount"], opts);
}
