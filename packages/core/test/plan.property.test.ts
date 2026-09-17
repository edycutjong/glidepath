/**
 * Property-based verification of the decision function (fast-check).
 *
 * `computePlan` is the one function that must never be wrong: it turns Nansen facts into the tranche calendar a
 * forced seller will follow. Example tests pin the PEPE numbers; these properties hold over the whole input space —
 * any price, any organic demand, any liquidity, any risk scores, any cohort flows, any bag size.
 *
 * PROPERTY_RUNS × 6 properties = the case count published in README.md and JUDGE.md.
 */
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { computePlan, planHash, sizeTranches, K_MIN, K_MAX, LIQUIDITY_CAP, MAX_DAYS, RED_DAY_FACTOR, type Plan, type PlanStatus } from "../src/plan";
import type { Facts } from "../src/facts";
import { pepeFacts, RESOLVED, NOW } from "./helpers";

export const PROPERTY_RUNS = 10_000;
const REL = 1e-9; // float tolerance on sums and bounds
/** sizeTranches stops once the residue is below 1e-12 tokens (dust, never sold): Σ + remainder may fall short of the bag by that much */
const DUST = 1e-12;

const score = fc.constantFrom<string | null>("low", "medium", "high", null);
const usd = (max: number) => fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true });
const maybe = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: null });

/** Facts drawn from the space the live endpoints can produce, on top of the recorded PEPE shape. */
const arbFacts = fc
  .record({
    price: fc.double({ min: 1e-12, max: 1e4, noNaN: true, noDefaultInfinity: true }),
    organic7d: usd(1e9),
    pro7d: maybe(usd(1e8)),
    buyers: maybe(fc.integer({ min: 0, max: 50_000 })),
    proBuyers: maybe(fc.integer({ min: 0, max: 500 })),
    liquidity: maybe(usd(1e9)),
    scores: fc.record({ "liquidity-risk": score, "concentration-risk": score, "btc-reflexivity": score }),
    top1: maybe(fc.double({ min: 0, max: 1, noNaN: true })),
    smNet1d: maybe(fc.double({ min: -1e8, max: 1e8, noNaN: true })),
    exNet1d: maybe(fc.double({ min: -1e8, max: 1e8, noNaN: true })),
    withHistory: fc.boolean(),
  })
  .map((r): Facts =>
    pepeFacts({
      marketCapUsd: r.price * 1e9,
      circulatingSupply: 1e9,
      fdvUsd: null,
      totalSupply: null,
      totalBuy7dUsd: r.organic7d + (r.pro7d ?? 0),
      proBuy7dUsd: r.pro7d,
      uniqueBuyers7d: r.buyers,
      proBuyers: r.proBuyers,
      liquidityUsd: r.liquidity,
      indicatorScores: r.scores,
      organicPage1Usd: 1_000_000,
      organicTop1Usd: r.top1 == null ? null : r.top1 * 1_000_000,
      smNet1dUsd: r.smNet1d,
      exNet1dUsd: r.exNet1d,
      history: r.withHistory ? pepeFacts().history : null,
    }),
  );

const arbAmount = fc.double({ min: 1e-6, max: 1e15, noNaN: true, noDefaultInfinity: true });
const arbInput = arbAmount.map((amount) => ({ chain: "ethereum", token: "PEPE", amount }));
const arbNow = fc.integer({ min: NOW - 400 * 86_400_000, max: NOW + 400 * 86_400_000 });

const plan = (f: Facts, amount: number, now = NOW): Plan => computePlan(f, { chain: "ethereum", token: "PEPE", amount }, RESOLVED, now);
const STATUSES: PlanStatus[] = ["ok", "thin", "no-organic-demand", "no-price", "not-found"];

describe(`tranche planner — properties (${PROPERTY_RUNS.toLocaleString("en-US")} generated cases each)`, () => {
  it("Σ tranche tokens + unsold remainder = amount held, to within float rounding; a calendar exists iff the status is ok or thin", () => {
    fc.assert(
      fc.property(arbFacts, arbInput, (f, input) => {
        const p = plan(f, input.amount);
        const sum = p.tranches.reduce((n, t) => n + t.tokens, 0);
        if (p.tranches.length) {
          expect(Math.abs(sum + p.remainderTokens - input.amount)).toBeLessThanOrEqual(input.amount * REL + DUST);
          expect(p.tranches.every((t) => t.tokens > 0)).toBe(true);
          expect(["ok", "thin"]).toContain(p.status);
        } else if (p.status === "thin") {
          // the zero-tranche guard: nothing sells at this pace, the whole bag is the remainder
          expect(p.remainderPct).toBe(1);
          expect(p.remainderTokens).toBe(input.amount);
        } else {
          expect(["no-organic-demand", "no-price", "not-found"]).toContain(p.status);
        }
        expect(STATUSES).toContain(p.status);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("every tranche ≤ k × organic/day and ≤ 1% of liquidity_usd, with k inside [K_MIN, K_MAX]", () => {
    fc.assert(
      fc.property(arbFacts, arbInput, (f, input) => {
        const p = plan(f, input.amount);
        expect(p.risk.k).toBeGreaterThanOrEqual(K_MIN);
        expect(p.risk.k).toBeLessThanOrEqual(K_MAX);
        if (!p.tranches.length) return;
        const byOrganic = p.risk.k * p.organic.organicDailyUsd!;
        const byLiquidity = p.liquidityUsd != null && p.liquidityUsd > 0 ? LIQUIDITY_CAP * p.liquidityUsd : Infinity;
        expect(p.trancheUsd!).toBeLessThanOrEqual(byOrganic * (1 + REL));
        expect(p.trancheUsd!).toBeLessThanOrEqual(byLiquidity * (1 + REL));
        expect(p.trancheCapReason).toBe(byLiquidity < byOrganic ? "liquidity" : "organic");
        for (const t of p.tranches) expect(t.usd).toBeLessThanOrEqual(p.trancheUsd! * (1 + REL) + 1e-9);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("a red today halves tranche 1 and only tranche 1; future days are never marked red", () => {
    fc.assert(
      fc.property(arbFacts, arbInput, (f, input) => {
        const p = plan(f, input.amount);
        if (!p.tranches.length) return;
        const first = p.tranches[0];
        expect(first.red).toBe(p.today.red);
        if (first.red) {
          expect(first.usd).toBeLessThanOrEqual(p.trancheUsd! * RED_DAY_FACTOR * (1 + REL) + 1e-9);
          expect(first.reason).toBe(p.today.reason);
        }
        for (const t of p.tranches.slice(1)) {
          expect(t.red).toBe(false);
          expect(t.reason).toBeNull();
        }
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("the calendar is consecutive UTC dates from today, never longer than MAX_DAYS, and expectedDays ≥ days ≥ 1", () => {
    fc.assert(
      fc.property(arbFacts, arbInput, arbNow, (f, input, now) => {
        const p = plan(f, input.amount, now);
        if (!p.tranches.length) {
          expect(p.days).toBe(0);
          expect(p.expectedDays).toBe(0);
          return;
        }
        expect(p.days).toBe(p.tranches.length);
        expect(p.days).toBeLessThanOrEqual(MAX_DAYS);
        expect(p.truncated).toBe(p.days === MAX_DAYS && p.remainderTokens > 0);
        expect(p.expectedDays).toBeGreaterThanOrEqual(p.days);
        expect(p.expectedDays).toBeGreaterThanOrEqual(1);
        expect(p.tranches[0].date).toBe(new Date(now).toISOString().slice(0, 10));
        for (let i = 1; i < p.tranches.length; i++) {
          expect(Date.parse(p.tranches[i].date + "T00:00:00Z") - Date.parse(p.tranches[i - 1].date + "T00:00:00Z")).toBe(86_400_000);
        }
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("the decision hash is deterministic and invariant to timing, cost-of-call and context fields", () => {
    fc.assert(
      fc.property(arbFacts, arbInput, fc.string(), fc.double({ noNaN: true }), (f, input, junk, junkNumber) => {
        const p = plan(f, input.amount);
        expect(p.hash).toMatch(/^[0-9a-f]{64}$/);
        expect(plan(f, input.amount).hash).toBe(p.hash);
        const perturbed: Plan = {
          ...p,
          computedAt: junk,
          now: junkNumber,
          warnings: [junk],
          errors: { [junk]: junk },
          regime: { red: !p.regime.red, reason: junk, smNet7dUsd: junkNumber, exNet7dUsd: junkNumber },
          marketCapUsd: junkNumber,
          totalHolders: junkNumber,
          quotes: null,
        };
        expect(planHash(perturbed)).toBe(p.hash);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it("sizeTranches alone: any positive bag, tranche size and price → Σ + remainder = bag, each tranche ≤ size (½ on a red day 0)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1e-9, max: 1e18, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1e-9, max: 1e18, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1e-12, max: 1e6, noNaN: true, noDefaultInfinity: true }),
        fc.boolean(),
        (amount, size, price, red) => {
          const r = sizeTranches(amount, size, price, NOW, { red, reason: red ? "Smart Money net −$1" : null });
          const sum = r.tranches.reduce((n, t) => n + t.tokens, 0);
          expect(Math.abs(sum + r.remainderTokens - amount)).toBeLessThanOrEqual(amount * REL + DUST);
          expect(r.days).toBe(r.tranches.length);
          expect(r.days).toBeGreaterThanOrEqual(1);
          expect(r.days).toBeLessThanOrEqual(MAX_DAYS);
          for (const t of r.tranches) expect(t.tokens).toBeLessThanOrEqual((t.day === 0 && red ? size * RED_DAY_FACTOR : size) * (1 + REL));
          expect(r.tranches[0].red).toBe(red);
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
