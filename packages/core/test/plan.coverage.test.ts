import { describe, it, expect } from "vitest";
import { computePlan, historyDays, applyQuotes, theta, CONCENTRATION_TOP1 } from "../src/plan";
import { pepeFacts, RESOLVED, NOW } from "./helpers";

const INPUT = { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 };

describe("computePlan — price fallback chain", () => {
  it("fdv_usd / total_supply is used when market_cap_usd/circulating_supply is unavailable", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, circulatingSupply: null, fdvUsd: 1_404_580_000, totalSupply: 420_690_000_000_000 }), INPUT, RESOLVED, NOW);
    expect(p.price.usd).toBeCloseTo(1_404_580_000 / 420_690_000_000_000, 12);
    expect(p.price.source).toBe("token-information fdv_usd / total_supply");
  });
  it("fdv path is skipped when total_supply is present but not positive (falls through to flows)", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, circulatingSupply: null, fdvUsd: 1_404_580_000, totalSupply: -5, flowsPriceUsd: 3.37e-6 }), INPUT, RESOLVED, NOW);
    expect(p.price.source).toBe("tgm/flows price_usd (latest bucket)");
  });
  it("tgm/flows price_usd is used when market-cap and fdv paths are both unavailable", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, circulatingSupply: null, fdvUsd: null, totalSupply: null, flowsPriceUsd: 3.37e-6 }), INPUT, RESOLVED, NOW);
    expect(p.price.usd).toBe(3.37e-6);
    expect(p.price.source).toBe("tgm/flows price_usd (latest bucket)");
  });
  it("flows path is skipped when flowsPriceUsd is not positive (falls through to search)", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, circulatingSupply: null, fdvUsd: null, totalSupply: null, flowsPriceUsd: 0 }), INPUT, RESOLVED, NOW, 3.4e-6);
    expect(p.price.usd).toBe(3.4e-6);
    expect(p.price.source).toBe("search/general price");
  });
  it("search/general price is the last resort, only when every Nansen field is unavailable", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, circulatingSupply: null, fdvUsd: null, totalSupply: null, flowsPriceUsd: null }), INPUT, RESOLVED, NOW, 3.4e-6);
    expect(p.price.usd).toBe(3.4e-6);
    expect(p.price.source).toBe("search/general price");
  });
  it("a non-positive search price still leaves the plan priceless", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, circulatingSupply: null, fdvUsd: null, totalSupply: null, flowsPriceUsd: null }), INPUT, RESOLVED, NOW, 0);
    expect(p.price.usd).toBeNull();
    expect(p.status).toBe("no-price");
  });
});

describe("computePlan — warnings on the fringes", () => {
  it("amount exceeding total supply warns with the units check", () => {
    const p = computePlan(pepeFacts(), { ...INPUT, amount: 420_690_000_000_000 + 1 }, RESOLVED, NOW);
    expect(p.warnings.join()).toMatch(/amount exceeds the token's total supply \(420,690,000,000,000\) — check the units/);
  });
  it("pro-buyer list truncated at 3 pages warns that organic volume is an upper bound", () => {
    const p = computePlan(pepeFacts({ proPages: 3, proTruncated: true }), INPUT, RESOLVED, NOW);
    expect(p.warnings.join()).toMatch(/pro-buyer list truncated at 3 pages/);
  });
  it("regression (audit 2026-09-23): a pro list that ends exactly on page 3 is complete — no truncation warning", () => {
    const p = computePlan(pepeFacts({ proPages: 3, proTruncated: false }), INPUT, RESOLVED, NOW);
    expect(p.warnings.join()).not.toMatch(/truncated/);
  });
  it("organicTop10Usd missing keeps top10Share null without throwing", () => {
    const p = computePlan(pepeFacts({ organicTop10Usd: null }), INPUT, RESOLVED, NOW);
    expect(p.organic.top10Share).toBeNull();
  });
  it("buyer breadth unavailable (organic-breadth error) is warned when top1Share is null", () => {
    const p = computePlan(pepeFacts({ organicPage1Usd: null, errors: { "organic-breadth": "HTTP 503" } }), INPUT, RESOLVED, NOW);
    expect(p.organic.top1Share).toBeNull();
    expect(p.warnings.join()).toMatch(/buyer breadth unavailable \(HTTP 503\) — concentration not applied/);
  });
  it("single-buyer dependence over the concentration threshold is warned with the percentage and k penalty", () => {
    const p = computePlan(pepeFacts({ organicPage1Usd: 1_000_000, organicTop1Usd: 300_000 }), INPUT, RESOLVED, NOW);
    expect(p.organic.top1Share).toBeGreaterThan(CONCENTRATION_TOP1);
    expect(p.risk.concentrated).toBe(true);
    expect(p.warnings.join()).toMatch(/one organic buyer is 30% of page-1 organic volume — single-buyer dependence, k reduced by 2 pts/);
  });
  it("organicShare is null (not a divide-by-zero) when total 7d buys are zero", () => {
    const p = computePlan(pepeFacts({ totalBuy7dUsd: 0, proBuy7dUsd: 0 }), INPUT, RESOLVED, NOW);
    expect(p.organic.organicBuy7dUsd).toBe(0);
    expect(p.organic.organicShare).toBeNull();
  });
  it("organicBuyers subtracts zero pro-buyers when proBuyers is unrecorded", () => {
    const p = computePlan(pepeFacts({ proBuyers: null }), INPUT, RESOLVED, NOW);
    expect(p.organic.organicBuyers).toBe(528); // uniqueBuyers7d (528) - 0, not 528 - proBuyers(1)
  });
  it("no-price statusReason falls back to the generic message when token-information has no recorded error", () => {
    const p = computePlan(pepeFacts({ marketCapUsd: null, circulatingSupply: null, fdvUsd: null, totalSupply: null, flowsPriceUsd: null, errors: {} }), INPUT, RESOLVED, NOW);
    expect(p.status).toBe("no-price");
    expect(p.statusReason).toMatch(/no price for this token \(token-information: no market cap \/ supply\)/);
  });
  it("no-organic-demand from a null organicDailyUsd (not a below-floor one) names the missing endpoint", () => {
    const p = computePlan(pepeFacts({ totalBuy7dUsd: null, errors: { "token-information": "HTTP 502" } }), INPUT, RESOLVED, NOW);
    expect(p.organic.organicDailyUsd).toBeNull();
    expect(p.status).toBe("no-organic-demand");
    expect(p.statusReason).toBe("buy volume unavailable (HTTP 502)");
  });
  it("that same null-organicDailyUsd status falls back to the generic reason with no recorded error", () => {
    const p = computePlan(pepeFacts({ totalBuy7dUsd: null, errors: {} }), INPUT, RESOLVED, NOW);
    expect(p.statusReason).toBe("buy volume unavailable (token-information returned no spot metrics)");
  });
  it("today's cohort flows unavailable warns when both smNet1dUsd and exNet1dUsd are null", () => {
    const p = computePlan(pepeFacts({ smNet1dUsd: null, exNet1dUsd: null }), INPUT, RESOLVED, NOW);
    expect(p.today.red).toBe(false);
    expect(p.warnings.join()).toMatch(/today's cohort flows unavailable \(flow-intelligence 1d failed\) — today not red-tested/);
  });
  it("one flow present (the other null) does not trigger the 'both unavailable' warning", () => {
    const p = computePlan(pepeFacts({ smNet1dUsd: null, exNet1dUsd: -1_000 }), INPUT, RESOLVED, NOW);
    expect(p.warnings.join()).not.toMatch(/today's cohort flows unavailable/);
  });
  it("no history (tgm/flows failed) warns, and a multi-day calendar with no observed red-day rate uses 0 (not NaN) — expectedDays equals days", () => {
    const p = computePlan(pepeFacts({ history: null }), INPUT, RESOLVED, NOW);
    expect(p.warnings.join()).toMatch(/14-day cohort history unavailable \(tgm\/flows failed\)/);
    expect(p.redRate).toBeNull();
    expect(p.days).toBeGreaterThan(1);
    expect(p.expectedDays).toBe(p.days);
  });
  it("below-floor statusReason shows '?' buyers when organicBuyers itself is unrecorded", () => {
    const p = computePlan(pepeFacts({ totalBuy7dUsd: 200, proBuy7dUsd: 0, uniqueBuyers7d: null }), INPUT, RESOLVED, NOW);
    expect(p.status).toBe("no-organic-demand");
    expect(p.organic.organicBuyers).toBeNull();
    expect(p.statusReason).toMatch(/from \? buyers over 7 days/);
  });
});

describe("historyDays — complete-row filter", () => {
  it("a complete day with a null smNetUsd still counts as complete via a non-null exNetUsd", () => {
    const h = historyDays([{ date: "2026-09-10T00:00:00Z", complete: true, priceUsd: 1, smNetUsd: null, exNetUsd: 500 }], theta(1000), "2026-09-16");
    expect(h.completeDays).toBe(1);
    expect(h.history[0].smNetUsd).toBeNull();
  });
});

describe("applyQuotes — edge arms", () => {
  it("a null priceImpactPct on a route leg round-trips as null, not zero", () => {
    const base = computePlan(pepeFacts(), INPUT, RESOLVED, NOW);
    const one = base.tranches[0].tokens;
    const p = applyQuotes(base, {
      decimals: 18,
      spotPriceUsd: 3.3e-6,
      errors: [],
      legs: [
        { label: "one-tranche", tokens: one, outUsd: 30_000, inUsd: 30_300, costUsd: 300, priceImpactPct: null, aggregator: "okx" },
        { label: "whole-bag", tokens: INPUT.amount, outUsd: 39_000, inUsd: 40_000, costUsd: 1000, priceImpactPct: null, aggregator: "okx" },
      ],
    });
    expect(p.dumpToday.priceImpactPct).toBeNull();
    expect(p.glidepath.priceImpactPct).toBeNull();
  });
  it("savingsUsd stays null when a quoted probe leaves both costs null (no liquidity model, no matching legs)", () => {
    const base = computePlan(pepeFacts({ liquidityUsd: null }), INPUT, RESOLVED, NOW);
    expect(base.dumpToday.costUsd).toBeNull();
    expect(base.glidepath.costUsd).toBeNull();
    const p = applyQuotes(base, { decimals: 0, spotPriceUsd: null, legs: [], errors: ["probe: HTTP 400 no route"] });
    expect(p.dumpToday.costUsd).toBeNull();
    expect(p.glidepath.costUsd).toBeNull();
    expect(p.savingsUsd).toBeNull();
  });
});
