import type { NansenClient, Call } from "./client";
import { CachedNansenClient } from "./cache";
import { resolveToken } from "./resolve";
import { fetchFacts } from "./facts";
import { fetchRouteQuotes, quoteSupported } from "./impact";
import { computePlan, applyQuotes, planHash, type Plan, type PlanInput } from "./plan";
import { isChain, TGM_CHAINS } from "./nansen";

export type PlanResult = Plan & {
  provenance: Call[];
  credits: number;
  calls: number;
  cachedCalls: number;
  ms: number;
  /** ISO time of the oldest cached response used, for the "computed Ns ago" badge (undefined = all live) */
  asOf: string | null;
};

export type GlidepathOptions = { now?: number; quotes?: boolean };

/** The one flow: resolve → facts (parallel) → plan → route quotes (solana/base) → costs → hash. */
export async function glidepath(client: NansenClient, input: PlanInput, opts: GlidepathOptions = {}): Promise<PlanResult> {
  const t0 = Date.now();
  const now = opts.now ?? t0;
  const startCall = client.calls.length;
  const chain = input.chain.trim().toLowerCase();
  const amount = Number(input.amount);
  const finish = (plan: Plan): PlanResult => {
    const provenance = client.calls.slice(startCall);
    return {
      ...plan,
      provenance,
      credits: provenance.reduce((n, c) => n + c.credits, 0),
      calls: provenance.length,
      cachedCalls: provenance.filter((c) => c.cached).length,
      ms: Date.now() - t0,
      asOf: client instanceof CachedNansenClient ? (client.oldestHit ?? null) : null,
    };
  };
  const empty = (status: Plan["status"], reason: string, resolved: Plan["resolved"]): Plan => {
    const p: Plan = {
      input: { chain, token: input.token, amount },
      resolved,
      status,
      statusReason: reason,
      price: { usd: null, source: "unavailable" },
      positionUsd: null,
      organic: {
        totalBuy7dUsd: null,
        proBuy7dUsd: null,
        organicBuy7dUsd: null,
        organicDailyUsd: null,
        organicShare: null,
        organicBuyers: null,
        proBuyers: null,
        proLabels: [],
        top1Share: null,
        top10Share: null,
      },
      liquidityUsd: null,
      marketCapUsd: null,
      totalHolders: null,
      risk: { scores: {}, highs: 0, mediums: 0, concentrated: false, k: 0 },
      today: { date: new Date(now).toISOString().slice(0, 10), red: false, reason: null, smNetUsd: null, exNetUsd: null, theta: { smUsd: 0, exUsd: 0 } },
      regime: { red: false, reason: null, smNet7dUsd: null, exNet7dUsd: null },
      history: [],
      redRate: null,
      redDays: 0,
      completeDays: 0,
      tranches: [],
      days: 0,
      expectedDays: 0,
      truncated: false,
      remainderTokens: 0,
      remainderPct: 0,
      trancheUsd: null,
      trancheCapReason: null,
      dumpToday: { usd: null, costUsd: null, shareOfOrganicDay: null, model: null, priceImpactPct: null },
      glidepath: { costUsd: null, model: null, firstTrancheCostUsd: null, priceImpactPct: null },
      savingsUsd: null,
      quotes: null,
      warnings: [],
      errors: {},
      now,
      computedAt: new Date(now).toISOString(),
      hash: "",
    };
    p.hash = planHash(p);
    return p;
  };

  if (!isChain(chain))
    return finish(
      empty("not-found", `unknown chain "${input.chain}" — Nansen TGM chains: ${TGM_CHAINS.join(", ")}`, { address: "", symbol: input.token, name: input.token, viaSearch: false, logo: null }),
    );
  if (!(amount > 0) || !Number.isFinite(amount))
    return finish(empty("not-found", "amount must be a positive number of tokens", { address: "", symbol: input.token, name: input.token, viaSearch: false, logo: null }));

  let res;
  try {
    res = await resolveToken(client, chain, input.token);
  } catch (e) {
    return finish(empty("not-found", `search/general failed: ${(e as Error).message.slice(0, 120)}`, { address: "", symbol: input.token, name: input.token, viaSearch: true, logo: null }));
  }
  if (!res.ok) {
    const p = empty("not-found", res.reason, { address: "", symbol: input.token, name: input.token, viaSearch: true, logo: null });
    p.warnings = res.elsewhere.map((e) => `${e.symbol} exists on ${e.chain}: ${e.address}`);
    p.hash = planHash(p);
    return finish(p);
  }

  const facts = await fetchFacts(client, chain, res.address, now);
  const resolved: Plan["resolved"] = {
    address: res.address,
    symbol: facts.symbol || res.symbol || res.address.slice(0, 6) + "…",
    name: facts.name || res.name,
    viaSearch: res.viaSearch,
    logo: facts.logo,
  };
  let plan = computePlan(facts, { chain, token: input.token, amount }, resolved, now, res.searchPrice);

  if (plan.status !== "no-price" && plan.status !== "no-organic-demand" && quoteSupported(chain) && opts.quotes !== false) {
    const one = plan.tranches.find((t) => !t.red) ?? plan.tranches[0];
    const legs = [
      { label: "one-tranche", tokens: one?.tokens ?? 0 },
      { label: "whole-bag", tokens: amount },
    ];
    const quotes = await fetchRouteQuotes(client, chain, res.address, legs);
    plan = applyQuotes(plan, quotes);
  }
  return finish(plan);
}
