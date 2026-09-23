import { sha256 } from "./client";
import { canonicalize } from "./cache";
import type { Facts, DayFlow } from "./facts";
import { RISK_INDICATORS } from "./facts";
import { constantProductCost, type RouteQuotes } from "./impact";
import { DAY } from "./nansen";

export type PlanInput = { chain: string; token: string; amount: number };

export type Tranche = {
  day: number;
  /** UTC calendar date YYYY-MM-DD */
  date: string;
  tokens: number;
  usd: number;
  red: boolean;
  reason: string | null;
  /** impact cost of this tranche under the model in `Plan.glidepath.model` */
  costUsd: number;
};

export type HistoryDay = { date: string; complete: boolean; red: boolean; reason: string | null; smNetUsd: number | null; exNetUsd: number | null };

export type PlanStatus = "ok" | "thin" | "no-organic-demand" | "no-price" | "not-found";

export type Plan = {
  input: PlanInput;
  resolved: { address: string; symbol: string; name: string; viaSearch: boolean; logo: string | null };
  status: PlanStatus;
  statusReason: string | null;
  price: { usd: number | null; source: string };
  positionUsd: number | null;
  organic: {
    totalBuy7dUsd: number | null;
    proBuy7dUsd: number | null;
    organicBuy7dUsd: number | null;
    organicDailyUsd: number | null;
    organicShare: number | null;
    organicBuyers: number | null;
    proBuyers: number | null;
    proLabels: string[];
    top1Share: number | null;
    top10Share: number | null;
  };
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  totalHolders: number | null;
  risk: { scores: Record<string, string | null>; highs: number; mediums: number; concentrated: boolean; k: number };
  today: { date: string; red: boolean; reason: string | null; smNetUsd: number | null; exNetUsd: number | null; theta: Theta };
  /** the 7-day cohort flows (flow-intelligence 7d) against 3× the daily thresholds: a week of distribution, not one bad day */
  regime: { red: boolean; reason: string | null; smNet7dUsd: number | null; exNet7dUsd: number | null };
  history: HistoryDay[];
  redRate: number | null;
  redDays: number;
  completeDays: number;
  tranches: Tranche[];
  days: number;
  expectedDays: number;
  truncated: boolean;
  remainderTokens: number;
  remainderPct: number;
  trancheUsd: number | null;
  trancheCapReason: "organic" | "liquidity" | null;
  dumpToday: { usd: number | null; costUsd: number | null; shareOfOrganicDay: number | null; model: "constant-product" | "route-quote" | null; priceImpactPct: number | null };
  glidepath: { costUsd: number | null; model: "constant-product" | "route-quote" | null; firstTrancheCostUsd: number | null; priceImpactPct: number | null };
  savingsUsd: number | null;
  quotes: RouteQuotes | null;
  warnings: string[];
  errors: Record<string, string>;
  now: number;
  computedAt: string;
  hash: string;
};

export const K_MAX = 0.1;
export const K_MIN = 0.03;
export const K_HIGH_STEP = (K_MAX - K_MIN) / 3; // three "high" scores land exactly on K_MIN
export const K_MEDIUM_STEP = 0.01;
export const K_CONCENTRATION_STEP = 0.02;
export const LIQUIDITY_CAP = 0.01;
export const MAX_DAYS = 90;
export const MIN_ORGANIC_DAILY_USD = 50;
export const MIN_ORGANIC_BUYERS = 5;
export const THETA_FLOOR_USD = 1000;
/** Smart Money net-selling worth 10% of a day's organic buys is a red day */
export const THETA_SM_SHARE = 0.1;
/** exchanges receiving net deposits worth a full day of organic buys is a red day */
export const THETA_EX_SHARE = 1.0;
/** one organic buyer supplying more than a quarter of page-1 organic volume = single-buyer dependence */
export const CONCENTRATION_TOP1 = 0.25;
export const RED_DAY_FACTOR = 0.5;

export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const round = (x: number, p: number) => Math.round(x * 10 ** p) / 10 ** p;

/** Participation rate: 10% of organic daily buys, shrinking toward 3% as Nansen's peer-percentile risk scores rise. */
export function riskDial(scores: Record<string, string | null>, top1Share: number | null): Plan["risk"] {
  let highs = 0,
    mediums = 0;
  const filled: Record<string, string | null> = {};
  for (const t of RISK_INDICATORS) {
    const s = scores[t] ?? null;
    filled[t] = s;
    if (s === "high") highs++;
    else if (s === "low") {
      /* no penalty */
    } else mediums++; // "medium" and missing both count as medium
  }
  const concentrated = top1Share != null && top1Share > CONCENTRATION_TOP1;
  const k = clamp(K_MAX - K_HIGH_STEP * highs - K_MEDIUM_STEP * mediums - (concentrated ? K_CONCENTRATION_STEP : 0), K_MIN, K_MAX);
  return { scores: filled, highs, mediums, concentrated, k: round(k, 4) };
}

export type Theta = { smUsd: number; exUsd: number };

/** Red-day test: Smart Money net-selling past θ_sm, or net deposits to exchanges past θ_ex. */
export function redDay(smNetUsd: number | null, exNetUsd: number | null, th: Theta): { red: boolean; reason: string | null } {
  const fmt = (v: number) => `${v < 0 ? "−" : "+"}$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
  if (smNetUsd != null && smNetUsd < -th.smUsd) return { red: true, reason: `Smart Money net ${fmt(smNetUsd)}` };
  if (exNetUsd != null && exNetUsd > th.exUsd) return { red: true, reason: `Exchange net deposits ${fmt(exNetUsd)}` };
  return { red: false, reason: null };
}

export function theta(organicDailyUsd: number | null): Theta {
  const d = organicDailyUsd ?? 0;
  return { smUsd: Math.max(THETA_FLOOR_USD, THETA_SM_SHARE * d), exUsd: Math.max(THETA_FLOOR_USD, THETA_EX_SHARE * d) };
}

/** Split `amount` into daily tranches of `trancheTokens`; a red day 0 is halved. Capped at MAX_DAYS with the remainder reported. */
export function sizeTranches(
  amount: number,
  trancheTokens: number,
  price: number,
  now: number,
  todayRed: { red: boolean; reason: string | null },
): Pick<Plan, "tranches" | "days" | "truncated" | "remainderTokens" | "remainderPct"> {
  const tranches: Tranche[] = [];
  // a tranche of zero tokens (liquidity cap underflowing at a dust price) would otherwise emit MAX_DAYS empty rows:
  // nothing can be sold at this pace, so the calendar is empty and the whole bag is the unsold remainder
  if (!(trancheTokens > 0)) return { tranches, days: 0, truncated: true, remainderTokens: amount, remainderPct: 1 };
  let left = amount;
  for (let day = 0; left > 1e-12 && day < MAX_DAYS; day++) {
    const isRed = day === 0 && todayRed.red;
    const size = Math.min(left, isRed ? trancheTokens * RED_DAY_FACTOR : trancheTokens);
    tranches.push({ day, date: utcDate(now + day * DAY), tokens: size, usd: size * price, red: isRed, reason: isRed ? todayRed.reason : null, costUsd: 0 });
    left -= size;
  }
  const truncated = left > 1e-12;
  return { tranches, days: tranches.length, truncated, remainderTokens: truncated ? left : 0, remainderPct: truncated ? left / amount : 0 };
}

export function historyDays(history: DayFlow[] | null, th: Theta, todayDate: string): { history: HistoryDay[]; redDays: number; completeDays: number; redRate: number | null } {
  const rows: HistoryDay[] = (history ?? [])
    .filter((d) => d.date.slice(0, 10) < todayDate)
    .map((d) => ({ date: d.date.slice(0, 10), complete: d.complete, smNetUsd: d.smNetUsd, exNetUsd: d.exNetUsd, ...redDay(d.smNetUsd, d.exNetUsd, th) }));
  const complete = rows.filter((r) => r.complete && (r.smNetUsd != null || r.exNetUsd != null));
  const redDays = complete.filter((r) => r.red).length;
  return { history: rows, redDays, completeDays: complete.length, redRate: complete.length ? redDays / complete.length : null };
}

/** The decision, and only the decision: same Nansen responses + same `now` ⇒ same hash. Costs, timing, cache state excluded. */
export function planHash(p: Plan): string {
  const cents = (v: number | null) => (v == null ? null : Math.round(v * 100));
  const body = {
    chain: p.input.chain,
    address: p.resolved.address,
    amount: p.input.amount,
    status: p.status,
    priceE12: p.price.usd == null ? null : Math.round(p.price.usd * 1e12),
    organicDailyUsdCents: cents(p.organic.organicDailyUsd),
    k: p.risk.k,
    today: { date: p.today.date, red: p.today.red },
    tranches: p.tranches.map((t) => ({ date: t.date, tokens: round(t.tokens, 6), usdCents: cents(t.usd), red: t.red })),
    history: p.history.map((h) => ({ date: h.date, red: h.red })),
    truncated: p.truncated,
    remainderTokens: round(p.remainderTokens, 6),
    dumpCents: cents(p.dumpToday.costUsd),
    glideCents: cents(p.glidepath.costUsd),
    models: [p.dumpToday.model, p.glidepath.model],
  };
  return sha256(JSON.stringify(canonicalize(body)));
}

/** Pure: facts + input + clock → plan (before route quotes). */
export function computePlan(facts: Facts, input: PlanInput, resolved: Plan["resolved"], now: number, searchPrice?: number | null): Plan {
  const warnings: string[] = [];
  const errors = { ...facts.errors };
  const todayDate = utcDate(now);

  // price — every source is a Nansen field
  let priceUsd: number | null = null,
    priceSource = "unavailable";
  if (facts.marketCapUsd && facts.circulatingSupply && facts.circulatingSupply > 0) {
    priceUsd = facts.marketCapUsd / facts.circulatingSupply;
    priceSource = "token-information market_cap_usd / circulating_supply";
  } else if (facts.fdvUsd && facts.totalSupply && facts.totalSupply > 0) {
    priceUsd = facts.fdvUsd / facts.totalSupply;
    priceSource = "token-information fdv_usd / total_supply";
  } else if (facts.flowsPriceUsd && facts.flowsPriceUsd > 0) {
    priceUsd = facts.flowsPriceUsd;
    priceSource = "tgm/flows price_usd (latest bucket)";
  } else if (searchPrice && searchPrice > 0) {
    priceUsd = searchPrice;
    priceSource = "search/general price";
  }
  const positionUsd = priceUsd == null ? null : input.amount * priceUsd;
  if (facts.totalSupply != null && facts.totalSupply > 0 && input.amount > facts.totalSupply)
    warnings.push(`amount exceeds the token's total supply (${facts.totalSupply.toLocaleString("en-US")}) — check the units`);
  if (positionUsd != null && facts.liquidityUsd != null && facts.liquidityUsd > 0 && positionUsd > 10 * facts.liquidityUsd)
    warnings.push(
      `position (${Math.round(positionUsd).toLocaleString("en-US")} USD at the quoted price) is ${Math.round(positionUsd / facts.liquidityUsd)}× the pool liquidity — the price is nominal, not realisable`,
    );

  // organic demand
  const totalBuy7dUsd = facts.totalBuy7dUsd;
  const proBuy7dUsd = facts.proBuy7dUsd;
  let organicBuy7dUsd: number | null = null,
    organicShare: number | null = null;
  if (totalBuy7dUsd != null) {
    if (proBuy7dUsd == null) {
      organicBuy7dUsd = totalBuy7dUsd;
      organicShare = null;
      warnings.push("pro-buyer split unavailable (who-bought-sold failed) — organic = all DEX buys");
    } else {
      organicBuy7dUsd = Math.max(0, totalBuy7dUsd - proBuy7dUsd);
      organicShare = totalBuy7dUsd > 0 ? organicBuy7dUsd / totalBuy7dUsd : null;
    }
  }
  // from the pager's own flag: a list that ends exactly on page 3 is complete, not truncated
  if (facts.proTruncated) warnings.push(`pro-buyer list truncated at ${facts.proPages} pages — organic volume is an upper bound`);
  const organicDailyUsd = organicBuy7dUsd == null ? null : organicBuy7dUsd / 7;
  const organicBuyers = facts.uniqueBuyers7d == null ? null : Math.max(0, facts.uniqueBuyers7d - (facts.proBuyers ?? 0));
  const pageUsd = facts.organicPage1Usd;
  const top10Share = pageUsd && pageUsd > 0 && facts.organicTop10Usd != null ? facts.organicTop10Usd / pageUsd : null;
  const top1Share = pageUsd && pageUsd > 0 && facts.organicTop1Usd != null ? facts.organicTop1Usd / pageUsd : null;
  if (top1Share == null && errors["organic-breadth"]) warnings.push(`buyer breadth unavailable (${errors["organic-breadth"]}) — concentration not applied`);

  // risk dial
  const risk = riskDial(facts.indicatorScores ?? {}, top1Share);
  for (const t of RISK_INDICATORS) if (risk.scores[t] == null) warnings.push(`indicator ${t} missing — treated as medium`);
  // risk.concentrated is `top1Share != null && top1Share > CONCENTRATION_TOP1` on this same top1Share (riskDial's
  // first arg), so whenever this branch runs top1Share is provably non-null — no `?? 0` fallback is needed.
  if (risk.concentrated) warnings.push(`one organic buyer is ${Math.round(top1Share! * 100)}% of page-1 organic volume — single-buyer dependence, k reduced by 2 pts`);

  // red-day rule
  const th = theta(organicDailyUsd);
  const todayRed = redDay(facts.smNet1dUsd, facts.exNet1dUsd, th);
  if (facts.smNet1dUsd == null && facts.exNet1dUsd == null) warnings.push("today's cohort flows unavailable (flow-intelligence 1d failed) — today not red-tested");
  const hist = historyDays(facts.history, th, todayDate);
  const regimeTest = redDay(facts.smNet7dUsd, facts.exNet7dUsd, { smUsd: th.smUsd * 3, exUsd: th.exUsd * 3 });
  const regime = { red: regimeTest.red, reason: regimeTest.red ? `${regimeTest.reason} over 7 days` : null, smNet7dUsd: facts.smNet7dUsd, exNet7dUsd: facts.exNet7dUsd };
  if (facts.history == null) warnings.push("14-day cohort history unavailable (tgm/flows failed)");

  // status
  let status: PlanStatus = "ok",
    statusReason: string | null = null;
  if (priceUsd == null) {
    status = "no-price";
    statusReason = `no price for this token (token-information: ${errors["token-information"] ?? "no market cap / supply"})`;
  } else if (organicDailyUsd == null) {
    status = "no-organic-demand";
    statusReason = `buy volume unavailable (${errors["token-information"] ?? "token-information returned no spot metrics"})`;
  } else if (organicDailyUsd < MIN_ORGANIC_DAILY_USD || (organicBuyers != null && organicBuyers < MIN_ORGANIC_BUYERS)) {
    status = "no-organic-demand";
    statusReason = `organic buys are $${Math.round(organicDailyUsd).toLocaleString("en-US")}/day from ${organicBuyers ?? "?"} buyers over 7 days — below the $${MIN_ORGANIC_DAILY_USD}/day, ${MIN_ORGANIC_BUYERS}-buyer floor; there is nobody to sell to at any pace`;
  }

  // tranches
  let trancheUsd: number | null = null,
    trancheCapReason: Plan["trancheCapReason"] = null;
  let sized: ReturnType<typeof sizeTranches> = { tranches: [], days: 0, truncated: false, remainderTokens: 0, remainderPct: 0 };
  if (status === "ok" && priceUsd != null && organicDailyUsd != null) {
    const byOrganic = risk.k * organicDailyUsd;
    const byLiquidity = facts.liquidityUsd != null && facts.liquidityUsd > 0 ? LIQUIDITY_CAP * facts.liquidityUsd : Infinity;
    trancheUsd = Math.min(byOrganic, byLiquidity);
    trancheCapReason = byLiquidity < byOrganic ? "liquidity" : "organic";
    if (facts.liquidityUsd == null) warnings.push("liquidity_usd unavailable — no liquidity cap on tranches and no impact estimate");
    else if (facts.liquidityUsd <= 0) warnings.push("liquidity_usd is 0 for this token on Nansen — no liquidity cap on tranches and no impact estimate");
    sized = sizeTranches(input.amount, trancheUsd / priceUsd, priceUsd, now, todayRed);
    if (sized.truncated) {
      status = "thin";
      statusReason = `${Math.round(sized.remainderPct * 100)}% of the position is still unsold after ${MAX_DAYS} days at this pace`;
    }
  }

  // costs (model; route quotes may replace them later)
  const L = facts.liquidityUsd;
  const modelOk = L != null && L > 0 && positionUsd != null;
  const dumpCost = modelOk ? constantProductCost(positionUsd!, L!) : null;
  for (const t of sized.tranches) t.costUsd = modelOk ? constantProductCost(t.usd, L!) : 0;
  const glideCost = modelOk && sized.tranches.length ? sized.tranches.reduce((n, t) => n + t.costUsd, 0) : null;

  const plan: Plan = {
    input,
    resolved,
    status,
    statusReason,
    price: { usd: priceUsd, source: priceSource },
    positionUsd,
    organic: { totalBuy7dUsd, proBuy7dUsd, organicBuy7dUsd, organicDailyUsd, organicShare, organicBuyers, proBuyers: facts.proBuyers, proLabels: facts.proLabels, top1Share, top10Share },
    liquidityUsd: L,
    marketCapUsd: facts.marketCapUsd,
    totalHolders: facts.totalHolders,
    risk,
    today: { date: todayDate, ...todayRed, smNetUsd: facts.smNet1dUsd, exNetUsd: facts.exNet1dUsd, theta: th },
    regime,
    history: hist.history,
    redRate: hist.redRate,
    redDays: hist.redDays,
    completeDays: hist.completeDays,
    ...sized,
    // a one-tranche plan sells today, whose colour is already known — the red-day rate only stretches multi-day calendars
    expectedDays: sized.days <= 1 ? sized.days : Math.ceil(sized.days / (1 - RED_DAY_FACTOR * (hist.redRate ?? 0))),
    trancheUsd,
    trancheCapReason,
    dumpToday: {
      usd: positionUsd,
      costUsd: dumpCost,
      shareOfOrganicDay: positionUsd != null && organicDailyUsd ? positionUsd / organicDailyUsd : null,
      model: modelOk ? "constant-product" : null,
      priceImpactPct: null,
    },
    glidepath: { costUsd: glideCost, model: modelOk && sized.tranches.length ? "constant-product" : null, firstTrancheCostUsd: sized.tranches[0]?.costUsd ?? null, priceImpactPct: null },
    savingsUsd: dumpCost != null && glideCost != null ? dumpCost - glideCost : null,
    quotes: null,
    warnings,
    errors,
    now,
    computedAt: new Date(now).toISOString(),
    hash: "",
  };
  plan.hash = planHash(plan);
  return plan;
}

/** Replace model costs with route quotes where a leg succeeded; the label on screen changes accordingly. */
export function applyQuotes(plan: Plan, quotes: RouteQuotes | null): Plan {
  if (!quotes) return plan;
  const p: Plan = { ...plan, quotes, warnings: [...plan.warnings], tranches: plan.tranches.map((t) => ({ ...t })) };
  for (const e of quotes.errors) p.warnings.push(`route quote: ${e}`);
  const bag = quotes.legs.find((l) => l.label === "whole-bag");
  const one = quotes.legs.find((l) => l.label === "one-tranche");
  const pctOf = (v: number | null) => (v == null ? null : Math.round(Math.abs(v) * 100) / 100);
  if (bag) p.dumpToday = { ...p.dumpToday, costUsd: bag.costUsd, model: "route-quote", priceImpactPct: pctOf(bag.priceImpactPct) };
  if (one && p.tranches.length) {
    // one quoted tranche scales to the calendar: full-size tranches carry the quoted cost, the partial ones scale by (size/full)²
    const full = one.tokens;
    for (const t of p.tranches) {
      const r = t.tokens / full;
      t.costUsd = one.costUsd * r * r;
    }
    p.glidepath = { costUsd: p.tranches.reduce((n, t) => n + t.costUsd, 0), model: "route-quote", firstTrancheCostUsd: p.tranches[0].costUsd, priceImpactPct: pctOf(one.priceImpactPct) };
  }
  // one leg quoted, the other on the model: a route quote carries aggregator fees the model does not, so the two
  // costs are not comparable — show both, labelled, but never subtract them into a "savings" figure
  const mixed = p.dumpToday.model != null && p.glidepath.model != null && p.dumpToday.model !== p.glidepath.model;
  if (mixed) p.warnings.push(`dump-today cost is a ${p.dumpToday.model}, the glidepath cost a ${p.glidepath.model} — different models, so no savings figure`);
  p.savingsUsd = !mixed && p.dumpToday.costUsd != null && p.glidepath.costUsd != null ? p.dumpToday.costUsd - p.glidepath.costUsd : null;
  p.hash = planHash(p);
  return p;
}
