import type { NansenClient } from "./client";
import {
  EXCLUDED_LABELS, tokenInformation, whoBoughtPaged, flowIntelligence, flows, indicators,
  type FlowsRow, type Indicator,
} from "./nansen";

/** One day of cohort flow history from tgm/flows: net token amount × that day's median price. */
export type DayFlow = { date: string; complete: boolean; priceUsd: number | null; smNetUsd: number | null; exNetUsd: number | null };

/** Everything the plan needs, each term nullable with the failure named in `errors` — never silently zero. */
export type Facts = {
  chain: string;
  address: string;
  symbol: string | null;
  name: string | null;
  logo: string | null;
  deployedAt: string | null;
  marketCapUsd: number | null;
  circulatingSupply: number | null;
  fdvUsd: number | null;
  totalSupply: number | null;
  liquidityUsd: number | null;
  totalHolders: number | null;
  /** token-information 7d, all DEX venues */
  totalBuy7dUsd: number | null;
  uniqueBuyers7d: number | null;
  /** who-bought-sold 7d, include pro labels */
  proBuy7dUsd: number | null;
  proBuyers: number | null;
  proPages: number | null;
  proLabels: string[];
  /** who-bought-sold 7d, exclude pro labels, page 1 (top-1000 organic buyers by USD) */
  organicPage1Usd: number | null;
  organicPage1Rows: number | null;
  organicTop10Usd: number | null;
  organicTop1Usd: number | null;
  /** flow-intelligence 1d / 7d */
  smNet1dUsd: number | null;
  exNet1dUsd: number | null;
  whaleNet1dUsd: number | null;
  smWallets1d: number | null;
  smNet7dUsd: number | null;
  exNet7dUsd: number | null;
  /** tgm/flows 14d daily history (smart_money + exchange merged by date) */
  history: DayFlow[] | null;
  /** latest price seen in tgm/flows (today's bucket uses spot) */
  flowsPriceUsd: number | null;
  /** tgm/indicators */
  indicatorScores: Record<string, string | null> | null;
  marketCapGroup: string | null;
  isStablecoin: boolean | null;
  /** term → why it is missing (endpoint + error) */
  errors: Record<string, string>;
};

export const RISK_INDICATORS = ["liquidity-risk", "concentration-risk", "btc-reflexivity"] as const;
export const LABELS = EXCLUDED_LABELS;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const topN = <T extends { bought_volume_usd?: number | null }>(rows: T[], n: number) => [...rows].sort((a, b) => (num(b.bought_volume_usd) ?? 0) - (num(a.bought_volume_usd) ?? 0)).slice(0, n);
const errMsg = (e: unknown) => (e instanceof Error ? (e.name === "AbortError" ? "timeout" : e.message.slice(0, 140)) : String(e));

function mergeHistory(sm: FlowsRow[] | null, ex: FlowsRow[] | null): DayFlow[] {
  const byDate = new Map<string, DayFlow>();
  const net = (r: FlowsRow) => (num(r.total_inflows_count) ?? 0) + (num(r.total_outflows_count) ?? 0);
  for (const r of sm ?? []) {
    const p = num(r.price_usd);
    byDate.set(r.date, { date: r.date, complete: r.is_complete !== false, priceUsd: p, smNetUsd: p == null ? null : net(r) * p, exNetUsd: null });
  }
  for (const r of ex ?? []) {
    const p = num(r.price_usd);
    const d = byDate.get(r.date) ?? { date: r.date, complete: r.is_complete !== false, priceUsd: p, smNetUsd: null, exNetUsd: null };
    d.complete = d.complete && r.is_complete !== false;
    d.priceUsd = d.priceUsd ?? p;
    d.exNetUsd = p == null ? null : net(r) * p;
    byDate.set(r.date, d);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Fetch every Nansen fact for one token in parallel. Each call is independent: a failure lands in `errors[term]`
 * and the corresponding fields stay null. The plan decides what it can still say.
 */
export async function fetchFacts(client: NansenClient, chain: string, address: string, now: number): Promise<Facts> {
  const errors: Record<string, string> = {};
  const settle = async <T,>(term: string, p: Promise<T>): Promise<T | null> => {
    try { return await p; } catch (e) { errors[term] = errMsg(e); return null; }
  };
  const [info, pros, organic, fi1, fi7, fsm, fex, ind] = await Promise.all([
    settle("token-information", tokenInformation(client, chain, address, "7d", { timeoutMs: 12000 })),
    settle("pro-buyers", whoBoughtPaged(client, chain, address, now, { include: EXCLUDED_LABELS }, 3, { timeoutMs: 20000 })),
    settle("organic-breadth", whoBoughtPaged(client, chain, address, now, { exclude: EXCLUDED_LABELS }, 1, { timeoutMs: 12000, retries: 0 })),
    settle("flow-1d", flowIntelligence(client, chain, address, "1d", { timeoutMs: 12000 })),
    settle("flow-7d", flowIntelligence(client, chain, address, "7d", { timeoutMs: 12000 })),
    settle("flows-smart-money", flows(client, chain, address, "smart_money", now, 14, { timeoutMs: 12000 })),
    settle("flows-exchange", flows(client, chain, address, "exchange", now, 14, { timeoutMs: 12000 })),
    settle("indicators", indicators(client, chain, address, { timeoutMs: 15000 })),
  ]);

  const d = info?.data;
  const td = d?.token_details ?? null;
  const sm = d?.spot_metrics ?? null;
  const proRows = pros?.rows ?? null;
  const orgRows = organic?.rows ?? null;
  const usdOf = (rows: Array<{ bought_volume_usd?: number | null }>) => rows.reduce((n, r) => n + (num(r.bought_volume_usd) ?? 0), 0);
  const f1 = fi1?.data?.[0] ?? null;
  const f7 = fi7?.data?.[0] ?? null;

  let indicatorScores: Record<string, string | null> | null = null;
  if (ind) {
    indicatorScores = {};
    const all: Indicator[] = [...(ind.risk_indicators ?? []), ...(ind.reward_indicators ?? [])];
    for (const t of RISK_INDICATORS) {
      const hit = all.find((i) => i.indicator_type === t);
      indicatorScores[t] = hit?.score ?? null;
    }
  }
  const history = fsm || fex ? mergeHistory(fsm?.data ?? null, fex?.data ?? null) : null;
  const latest = history?.length ? history[history.length - 1] : null;

  return {
    chain, address,
    symbol: d?.symbol ?? null, name: d?.name ?? null, logo: d?.logo ?? null,
    deployedAt: td?.token_deployment_date ?? null,
    marketCapUsd: num(td?.market_cap_usd), circulatingSupply: num(td?.circulating_supply), fdvUsd: num(td?.fdv_usd), totalSupply: num(td?.total_supply),
    liquidityUsd: num(sm?.liquidity_usd), totalHolders: num(sm?.total_holders),
    totalBuy7dUsd: num(sm?.buy_volume_usd), uniqueBuyers7d: num(sm?.unique_buyers),
    proBuy7dUsd: proRows ? usdOf(proRows) : null, proBuyers: proRows ? proRows.length : null, proPages: pros?.pages ?? null,
    proLabels: proRows ? [...new Set(proRows.map((r) => r.address_label).filter((l): l is string => !!l))].slice(0, 8) : [],
    organicPage1Usd: orgRows ? usdOf(orgRows) : null, organicPage1Rows: orgRows ? orgRows.length : null,
    organicTop10Usd: orgRows ? usdOf(topN(orgRows, 10)) : null,
    organicTop1Usd: orgRows ? usdOf(topN(orgRows, 1)) : null,
    smNet1dUsd: num(f1?.smart_trader_net_flow_usd), exNet1dUsd: num(f1?.exchange_net_flow_usd), whaleNet1dUsd: num(f1?.whale_net_flow_usd), smWallets1d: num(f1?.smart_trader_wallet_count),
    smNet7dUsd: num(f7?.smart_trader_net_flow_usd), exNet7dUsd: num(f7?.exchange_net_flow_usd),
    history, flowsPriceUsd: latest?.priceUsd ?? null,
    indicatorScores, marketCapGroup: ind?.token_info?.market_cap_group ?? null, isStablecoin: ind?.token_info?.is_stablecoin ?? null,
    errors,
  };
}
