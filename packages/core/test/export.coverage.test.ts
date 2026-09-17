import { describe, it, expect } from "vitest";
import { toICS, toCSV } from "../src/export";
import type { Plan } from "../src/plan";

/**
 * Minimal fake Plan, built by hand (not via computePlan) so we can force field combinations
 * computePlan never actually produces in the fixture data — a null `organicDailyUsd`, a
 * sub-1000 token tranche, and a null `glidepath.model` — to reach every ternary/`??` arm in
 * export.ts without changing behaviour.
 */
function minimalPlan(overrides: {
  tranches: Plan["tranches"];
  organicDailyUsd?: number | null;
  model?: "constant-product" | "route-quote" | null;
}): Plan {
  return {
    resolved: { address: "0x" + "a".repeat(40), symbol: "TEST", name: "Test Token", viaSearch: false, logo: null },
    computedAt: "2026-09-16T00:00:00.000Z",
    days: overrides.tranches.length,
    tranches: overrides.tranches,
    today: { date: "2026-09-16", red: false, reason: null, smNetUsd: null, exNetUsd: null, theta: { smUsd: 1000, exUsd: 1000 } },
    risk: { scores: {}, highs: 0, mediums: 0, concentrated: false, k: 0.05 },
    organic: {
      totalBuy7dUsd: null,
      proBuy7dUsd: null,
      organicBuy7dUsd: null,
      organicDailyUsd: overrides.organicDailyUsd ?? null,
      organicShare: null,
      organicBuyers: null,
      proBuyers: null,
      proLabels: [],
      top1Share: null,
      top10Share: null,
    },
    glidepath: { costUsd: null, model: overrides.model ?? null, firstTrancheCostUsd: null, priceImpactPct: null },
    hash: "0123456789abcdef",
    // fields below are unused by toICS/toCSV; present only to satisfy the Plan type.
    input: { chain: "ethereum", token: "TEST", amount: 1 },
    status: "ok",
    statusReason: null,
    price: { usd: 1, source: "test" },
    positionUsd: null,
    liquidityUsd: null,
    marketCapUsd: null,
    totalHolders: null,
    regime: { red: false, reason: null, smNet7dUsd: null, exNet7dUsd: null },
    history: [],
    redRate: null,
    redDays: 0,
    completeDays: 0,
    expectedDays: overrides.tranches.length,
    truncated: false,
    remainderTokens: 0,
    remainderPct: 0,
    trancheUsd: null,
    trancheCapReason: null,
    dumpToday: { usd: null, costUsd: null, shareOfOrganicDay: null, model: null, priceImpactPct: null },
    savingsUsd: null,
    quotes: null,
    warnings: [],
    errors: {},
    now: Date.parse("2026-09-16T00:00:00.000Z"),
  } as Plan;
}

describe("export.ts branch coverage", () => {
  it("toICS formats a missing organicDailyUsd as '—' via fmtUsd's null branch", () => {
    const p = minimalPlan({
      tranches: [{ day: 0, date: "2026-09-16", tokens: 5000, usd: 10, red: false, reason: null, costUsd: 0 }],
      organicDailyUsd: null,
    });
    const ics = toICS(p);
    expect(ics).toContain("Sized to 5.0% of —/day organic buys");
  });

  it("toICS formats a sub-1000 token tranche with toPrecision(6) via fmtTok's small-number branch", () => {
    const p = minimalPlan({
      tranches: [{ day: 0, date: "2026-09-16", tokens: 0.5, usd: 10, red: false, reason: null, costUsd: 0 }],
      organicDailyUsd: 1000,
    });
    const ics = toICS(p);
    expect((0.5).toPrecision(6)).toBe("0.500000");
    expect(ics).toContain("Sell 0.500000 TEST");
  });

  it("toCSV renders an empty cost_model column when glidepath.model is null", () => {
    const p = minimalPlan({
      tranches: [{ day: 0, date: "2026-09-16", tokens: 1, usd: 1, red: false, reason: null, costUsd: 0 }],
      model: null,
    });
    const rows = toCSV(p).trim().split("\n");
    expect(rows).toEqual(["day,date,tokens,usd,red,reason,est_cost_usd,cost_model", "1,2026-09-16,1.000000,1.00,no,,0.00,"]);
  });
});
