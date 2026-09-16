import { describe, it, expect } from "vitest";
import { riskDial, redDay, theta, sizeTranches, historyDays, computePlan, applyQuotes, planHash, K_MIN, K_MAX, MAX_DAYS, LIQUIDITY_CAP, RED_DAY_FACTOR } from "../src/plan.js";
import { constantProductCost, toBaseUnits } from "../src/impact.js";
import { pepeFacts, RESOLVED, NOW } from "./helpers.js";

const INPUT = { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 };

describe("risk dial → k", () => {
  it.each([
    [{ "liquidity-risk": "low", "concentration-risk": "low", "btc-reflexivity": "low" }, null, 0.10],
    [{ "liquidity-risk": "medium", "concentration-risk": "low", "btc-reflexivity": "high" }, null, 0.0667],  // PEPE live
    [{ "liquidity-risk": "high", "concentration-risk": "high", "btc-reflexivity": "high" }, null, 0.03],
    [{ "liquidity-risk": "medium", "concentration-risk": "medium", "btc-reflexivity": "medium" }, null, 0.07],
    [{ "liquidity-risk": "low", "concentration-risk": "low", "btc-reflexivity": "low" }, 0.3, 0.08],           // single-buyer dependence
    [{ "liquidity-risk": "high", "concentration-risk": "high", "btc-reflexivity": "high" }, 0.9, 0.03],       // never below K_MIN
    [{}, null, 0.07],                                                                                        // missing = medium
  ])("scores %o top1=%s → k=%s", (scores, top1, k) => {
    expect(riskDial(scores as Record<string, string | null>, top1).k).toBeCloseTo(k, 4);
  });
  it("bounds are the published constants", () => {
    expect(K_MIN).toBe(0.03); expect(K_MAX).toBe(0.10);
    expect(riskDial({}, null).mediums).toBe(3);
  });
});

describe("red-day rule", () => {
  const th = theta(458_716); // PEPE organic/day
  it("θ_sm is 10% of organic/day and θ_ex a full day, both floored at $1,000", () => {
    expect(th.smUsd).toBeCloseTo(45_871.6, 0);
    expect(th.exUsd).toBeCloseTo(458_716, 0);
    expect(theta(10)).toEqual({ smUsd: 1000, exUsd: 1000 });
    expect(theta(null)).toEqual({ smUsd: 1000, exUsd: 1000 });
  });
  it("Smart Money net-selling past θ_sm is red with the amount in the reason", () => {
    expect(redDay(-50_000, 0, th)).toEqual({ red: true, reason: "Smart Money net −$50,000" });
    expect(redDay(-40_000, 0, th).red).toBe(false);
  });
  it("net exchange deposits past θ_ex are red; withdrawals never are", () => {
    expect(redDay(0, 1_918_463, th)).toEqual({ red: true, reason: "Exchange net deposits +$1,918,463" });
    expect(redDay(0, -1_724_177, th).red).toBe(false);
    expect(redDay(0, 191_065, th).red).toBe(false);
  });
  it("missing flows are never red", () => {
    expect(redDay(null, null, th).red).toBe(false);
  });
});

describe("tranche sizing", () => {
  const green = { red: false, reason: null };
  it("exact division: 4 equal tranches on consecutive UTC dates", () => {
    const r = sizeTranches(400, 100, 2, NOW, green);
    expect(r.days).toBe(4);
    expect(r.tranches.map((t) => t.tokens)).toEqual([100, 100, 100, 100]);
    expect(r.tranches.map((t) => t.date)).toEqual(["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]);
    expect(r.tranches[0].usd).toBe(200);
    expect(r.truncated).toBe(false);
  });
  it("remainder becomes a smaller last tranche", () => {
    const r = sizeTranches(250, 100, 1, NOW, green);
    expect(r.tranches.map((t) => t.tokens)).toEqual([100, 100, 50]);
  });
  it("a red today halves the first tranche only and carries the reason", () => {
    const r = sizeTranches(300, 100, 1, NOW, { red: true, reason: "Exchange net deposits +$877,893" });
    expect(r.tranches.map((t) => t.tokens)).toEqual([100 * RED_DAY_FACTOR, 100, 100, 50]);
    expect(r.tranches[0]).toMatchObject({ red: true, reason: "Exchange net deposits +$877,893" });
    expect(r.tranches[1].red).toBe(false);
  });
  it("stops at MAX_DAYS and reports the unsold remainder", () => {
    const r = sizeTranches(1000, 1, 1, NOW, green);
    expect(r.days).toBe(MAX_DAYS);
    expect(r.truncated).toBe(true);
    expect(r.remainderTokens).toBe(910);
    expect(r.remainderPct).toBeCloseTo(0.91);
  });
  it("a bag smaller than one tranche is one tranche", () => {
    const r = sizeTranches(5, 100, 1, NOW, green);
    expect(r.days).toBe(1);
    expect(r.tranches[0].tokens).toBe(5);
  });
});

describe("history", () => {
  it("classifies complete past days only; today and incomplete buckets are excluded from the rate", () => {
    const h = historyDays(pepeFacts().history, theta(458_716), "2026-09-16");
    expect(h.history.map((d) => d.date)).not.toContain("2026-09-16");
    expect(h.completeDays).toBe(6);
    expect(h.redDays).toBe(3); // 09-04, 09-10, 09-11
    expect(h.redRate).toBeCloseTo(0.5);
    expect(h.history.find((d) => d.date === "2026-09-11")!.reason).toBe("Exchange net deposits +$1,386,698");
  });
  it("no history → empty, rate null", () => {
    expect(historyDays(null, theta(1), "2026-09-16")).toEqual({ history: [], redDays: 0, completeDays: 0, redRate: null });
  });
});

describe("impact model", () => {
  it("constant product: cost(V) = V²/(L/2+V); PEPE $40,073 into $13.79M ≈ $231.5", () => {
    expect(constantProductCost(40_073, 13_790_405)).toBeCloseTo(231.5, 0);
    expect(constantProductCost(0, 1e6)).toBe(0);
    expect(constantProductCost(100, 0)).toBe(0);
  });
  it("splitting always costs less than dumping (convex)", () => {
    const L = 1e6, V = 50_000;
    const split = Array.from({ length: 5 }, () => constantProductCost(V / 5, L)).reduce((a, b) => a + b, 0);
    expect(split).toBeLessThan(constantProductCost(V, L));
  });
  it("toBaseUnits handles 18-decimal amounts without float overflow", () => {
    expect(toBaseUnits(1.5, 6)).toBe("1500000");
    expect(toBaseUnits(12_000_000_000, 18)).toBe("12000000000000000000000000000");
    expect(toBaseUnits(0.000123, 5)).toBe("12");
    expect(toBaseUnits(0, 9)).toBe("0");
  });
});

describe("computePlan — the PEPE hero (facts from the 2026-09-16 probe)", () => {
  const p = computePlan(pepeFacts(), INPUT, RESOLVED, NOW);
  it("price from market cap / circulating supply; organic = total − pros; share and buyers", () => {
    expect(p.price.usd).toBeCloseTo(3.3388e-6, 9);
    expect(p.price.source).toMatch(/market_cap_usd/);
    expect(p.positionUsd).toBeCloseTo(40_065, 0);
    expect(p.organic.organicBuy7dUsd).toBe(3_235_907 - 24_893);
    expect(p.organic.organicDailyUsd).toBeCloseTo(458_716, 0);
    expect(p.organic.organicShare).toBeCloseTo(0.9923, 3);
    expect(p.organic.organicBuyers).toBe(527);
    expect(p.organic.top1Share).toBeCloseTo(0.2109, 3);
  });
  it("k = 6.67% (medium, low, high), tranche = k × organic/day, 2 tranches, today green", () => {
    expect(p.risk.k).toBeCloseTo(0.0667, 4);
    expect(p.trancheCapReason).toBe("organic");
    expect(p.trancheUsd).toBeCloseTo(0.0667 * 458_716, -1);
    expect(p.status).toBe("ok");
    expect(p.days).toBe(2);
    expect(p.today.red).toBe(false);
    expect(p.tranches[0].tokens + p.tranches[1].tokens).toBeCloseTo(INPUT.amount, 3);
  });
  it("dump-today vs glidepath costs under the constant-product model, savings positive", () => {
    expect(p.dumpToday.model).toBe("constant-product");
    expect(p.dumpToday.costUsd).toBeCloseTo(231.5, 0);
    expect(p.glidepath.costUsd!).toBeLessThan(p.dumpToday.costUsd!);
    expect(p.savingsUsd!).toBeGreaterThan(0);
    expect(p.dumpToday.shareOfOrganicDay).toBeCloseTo(40_065 / 458_716, 3);
  });
  it("expected days include the observed red-day rate", () => {
    expect(p.redRate).toBeCloseTo(0.5);
    expect(p.expectedDays).toBe(Math.ceil(2 / (1 - 0.5 * 0.5)));
  });
});

describe("computePlan — honest states", () => {
  it("no price → status no-price, no tranches, reason names the endpoint", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, fdvUsd: null, flowsPriceUsd: null, errors: { "token-information": "HTTP 500" } }), INPUT, RESOLVED, NOW);
    expect(p.status).toBe("no-price");
    expect(p.tranches).toEqual([]);
    expect(p.statusReason).toMatch(/HTTP 500/);
  });
  it("below the organic floor → no-organic-demand with the numbers in the reason", () => {
    const p = computePlan(pepeFacts({ totalBuy7dUsd: 200, uniqueBuyers7d: 3, proBuy7dUsd: 0, proBuyers: 0 }), INPUT, RESOLVED, NOW);
    expect(p.status).toBe("no-organic-demand");
    expect(p.statusReason).toMatch(/\$29\/day from 3 buyers/);
    expect(p.tranches).toEqual([]);
    expect(p.dumpToday.costUsd).not.toBeNull(); // the dump line still prints
  });
  it("pro split unavailable → organic = all buys, warned, share null", () => {
    const p = computePlan(pepeFacts({ proBuy7dUsd: null, proBuyers: null, errors: { "pro-buyers": "timeout" } }), INPUT, RESOLVED, NOW);
    expect(p.organic.organicBuy7dUsd).toBe(3_235_907);
    expect(p.organic.organicShare).toBeNull();
    expect(p.warnings.join()).toMatch(/pro-buyer split unavailable/);
  });
  it("missing indicators → medium each, three warnings, k = 7%", () => {
    const p = computePlan(pepeFacts({ indicatorScores: null, errors: { indicators: "HTTP 404" } }), INPUT, RESOLVED, NOW);
    expect(p.risk.k).toBeCloseTo(0.07, 4);
    expect(p.warnings.filter((w) => /missing — treated as medium/.test(w))).toHaveLength(3);
  });
  it("thin liquidity caps the tranche at 1% of liquidity and a huge bag is truncated at 90 days as status thin", () => {
    const p = computePlan(pepeFacts({ liquidityUsd: 50_000 }), { ...INPUT, amount: 4e12 }, RESOLVED, NOW);
    expect(p.trancheCapReason).toBe("liquidity");
    expect(p.trancheUsd).toBeCloseTo(LIQUIDITY_CAP * 50_000);
    expect(p.status).toBe("thin");
    expect(p.days).toBe(MAX_DAYS);
    expect(p.truncated).toBe(true);
    expect(p.statusReason).toMatch(/still unsold after 90 days/);
  });
  it("a red today halves tranche 1 and names the cohort", () => {
    const p = computePlan(pepeFacts({ exNet1dUsd: 877_893 }), INPUT, RESOLVED, NOW);
    expect(p.today).toMatchObject({ red: true, reason: "Exchange net deposits +$877,893" });
    expect(p.tranches[0].red).toBe(true);
    expect(p.tranches[0].usd).toBeCloseTo(p.trancheUsd! * RED_DAY_FACTOR, 0);
  });
  it("no liquidity → no impact model, tranche by organic only, warned", () => {
    const p = computePlan(pepeFacts({ liquidityUsd: null }), INPUT, RESOLVED, NOW);
    expect(p.dumpToday.model).toBeNull();
    expect(p.glidepath.costUsd).toBeNull();
    expect(p.trancheCapReason).toBe("organic");
    expect(p.warnings.join()).toMatch(/liquidity_usd unavailable/);
  });
});

describe("decision hash", () => {
  it("is stable across runs and independent of cost/timing metadata", () => {
    const a = computePlan(pepeFacts(), INPUT, RESOLVED, NOW);
    const b = computePlan(pepeFacts(), INPUT, RESOLVED, NOW);
    expect(a.hash).toBe(b.hash);
    expect(planHash({ ...a, computedAt: "x", warnings: ["y"] })).toBe(a.hash);
  });
  it("changes when the decision changes: amount, clock (dates), a red day, k", () => {
    const base = computePlan(pepeFacts(), INPUT, RESOLVED, NOW).hash;
    expect(computePlan(pepeFacts(), { ...INPUT, amount: 1 }, RESOLVED, NOW).hash).not.toBe(base);
    expect(computePlan(pepeFacts(), INPUT, RESOLVED, NOW + 86_400_000).hash).not.toBe(base);
    expect(computePlan(pepeFacts({ exNet1dUsd: 9e6 }), INPUT, RESOLVED, NOW).hash).not.toBe(base);
    expect(computePlan(pepeFacts({ indicatorScores: { "liquidity-risk": "low", "concentration-risk": "low", "btc-reflexivity": "low" } }), INPUT, RESOLVED, NOW).hash).not.toBe(base);
  });
});

describe("applyQuotes", () => {
  const base = computePlan(pepeFacts(), INPUT, RESOLVED, NOW);
  it("replaces model costs with route quotes and relabels; partial tranches scale quadratically", () => {
    const one = base.tranches[0].tokens;
    const q = { decimals: 18, spotPriceUsd: 3.3e-6, errors: [], legs: [
      { label: "one-tranche", tokens: one, outUsd: 30_000, inUsd: 30_300, costUsd: 300, priceImpactPct: 1, aggregator: "okx" },
      { label: "whole-bag", tokens: INPUT.amount, outUsd: 39_000, inUsd: 40_000, costUsd: 1000, priceImpactPct: 2.5, aggregator: "okx" },
    ] };
    const p = applyQuotes(base, q);
    expect(p.dumpToday).toMatchObject({ costUsd: 1000, model: "route-quote", priceImpactPct: 2.5 });
    expect(p.glidepath.model).toBe("route-quote");
    expect(p.tranches[0].costUsd).toBe(300);
    const r = p.tranches[1].tokens / one;
    expect(p.tranches[1].costUsd).toBeCloseTo(300 * r * r, 6);
    expect(p.savingsUsd).toBeCloseTo(1000 - p.glidepath.costUsd!, 6);
    expect(p.hash).not.toBe(base.hash);
    expect(base.glidepath.model).toBe("constant-product"); // input untouched
  });
  it("a failed probe keeps the model and surfaces the reason as a warning", () => {
    const p = applyQuotes(base, { decimals: 0, spotPriceUsd: null, legs: [], errors: ["probe: HTTP 400 no route"] });
    expect(p.dumpToday.model).toBe("constant-product");
    expect(p.warnings.join()).toMatch(/route quote: probe: HTTP 400/);
    expect(p.hash).toBe(base.hash);
  });
  it("null quotes (chain unsupported) is a no-op", () => {
    expect(applyQuotes(base, null)).toBe(base);
  });
});
