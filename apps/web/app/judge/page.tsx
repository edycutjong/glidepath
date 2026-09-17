import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Shell";

/**
 * /judge — no auth, no cookies, no key, no network: a static page for exactly one reader.
 * JUDGE.md at the repo root mirrors this page word for word; keep the two in sync.
 */
export const dynamic = "force-static";

const LIVE = "https://glidepath.edycu.dev";
const REPO = "https://github.com/edycutjong/glidepath";

const CLAIM =
  "You have to sell a token you never meant to own. Glidepath turns it into a dated selling calendar sized to the market's organic demand — so you are never the biggest seller on a day the pros are exiting.";

export const metadata: Metadata = {
  title: "Glidepath — for the judge",
  description: "One claim, a 30-second click path, the real-run receipts, the reproduce command and the honest limits.",
  robots: { index: false },
};

export default function JudgePage() {
  return (
    <>
      <SiteHeader current="judge" />
      <main className="wrap judge">
        <p className="judge-kicker">
          <Link href="/">← the planner</Link> · for judges · no login, no key, no setup
        </p>
        <h1>For the judge</h1>
        <p className="judge-lede">Everything below is verifiable in the repo or on the live app. No account, no wallet, no key needed to read this page or to click the path.</p>

        <section>
          <h2>The claim</h2>
          <p className="claim">{CLAIM}</p>
          <p className="judge-kicker">Nansen labels decide what counts as organic. It plans; it never trades.</p>
        </section>

        <section>
          <h2>The 30-second path</h2>
          <ol>
            <li>
              Open <a href={LIVE}>{LIVE}</a> and click <strong>PEPE · 12B (a $40K donation)</strong> — a two-tranche calendar in ≈3 s cold (12 live Nansen credits; 0 on a cache hit). Read the{" "}
              <em>Dump today</em> line: position, estimated impact, and what share of a full day&apos;s organic buys you would be.
            </li>
            <li>
              Click <strong>BONK · 20B on solana</strong> — when exchanges are net-receiving BONK, <em>today is red</em>: the first tranche is halved and the reason is printed. Costs come from a real{" "}
              <code>trade/quote</code> route, labelled as such.
            </li>
            <li>
              Click <strong>Every Nansen call (11)</strong> under the plan — the provenance drawer: every Nansen call, the fields used, credits from the response headers, cached or live, and
              milliseconds.
            </li>
            <li>
              Click <strong>ICS</strong> — one calendar event per tranche with the go/no-go rule inside; <strong>CSV</strong> for the spreadsheet.
            </li>
            <li>
              Open the share page <a href={`${LIVE}/p?chain=solana&token=BONK&amount=20000000000`}>/p?chain=solana&amp;token=BONK&amp;amount=20000000000</a> — server-rendered, with an OG image at{" "}
              <a href={`${LIVE}/api/og?chain=solana&token=BONK&amount=20000000000`}>/api/og</a>.
            </li>
          </ol>
        </section>

        <section>
          <h2>Receipts (real runs, not estimates)</h2>
          <table className="judge-table">
            <tbody>
              <tr>
                <th>Hero plan</th>
                <td>
                  PEPE · 12,000,000,000 on ethereum — <strong>12 credits · 8 calls · 1.5 s</strong>, plan <code>688239ac1d8c</code>, recorded 2026-09-16 14:18 UTC (
                  <code>fixtures/0X6982508145--ETHEREUM.json</code>)
                </td>
              </tr>
              <tr>
                <th>Bench</th>
                <td>
                  7 tokens × 3 runs, 2026-09-16 14:22 UTC — cold <strong>p50 3.47 s / p95 5.95 s</strong>, warm <strong>p50 5 ms / p95 356 ms</strong>, <strong>13.0 credits/plan</strong>, 9.3
                  calls/plan, 2.0 who-bought-sold pages/plan, 7 of 195 calls failed (6 deterministic: <code>tgm/flows</code> refuses stablecoins), 272 credits total
                </td>
              </tr>
              <tr>
                <th>Credits spent building</th>
                <td>≈ 800 credits · ≈ 700 live Nansen calls (header balance 62,320 → 59,360 across the build; table in DEMO.md)</td>
              </tr>
              <tr>
                <th>Nansen surface</th>
                <td>7 endpoints · 11 calls per plan · 12 credits on EVM chains, 15 on solana/base, 0 on a cache hit</td>
              </tr>
              <tr>
                <th>Tests</th>
                <td>
                  <strong>231 vitest tests</strong> (unit, end-to-end on a fake Nansen, one replay per fixture, key-boundary) · <strong>13/13 recorded plans reproduce offline</strong> byte-for-byte
                </td>
              </tr>
              <tr>
                <th>Property-based verification</th>
                <td>
                  <strong>60,000 generated cases</strong> (fast-check, 6 properties × 10,000) on the tranche planner: Σ tranches + remainder = amount held; every tranche ≤ k × organic/day and ≤ 1% of
                  liquidity; a red today halves tranche 1 and only tranche 1; consecutive UTC dates, ≤ 90 of them, expectedDays ≥ days ≥ 1; the decision hash is deterministic and invariant to timing
                  and context fields. It found one real defect (a zero-token tranche emitted 90 empty rows) — fixed and pinned.
                </td>
              </tr>
              <tr>
                <th>E2E</th>
                <td>
                  4 Playwright suites (home, planner flow, responsive 320/375/768/1440, this page) — run in CI with no key; the built app is asserted to never contain an <code>nsn_</code> key
                </td>
              </tr>
              <tr>
                <th>Clean clone</th>
                <td>
                  ≈ 15 s from <code>git clone</code> to the first live plan (independent reviewer, 2026-09-16 23:51 UTC, warm npm cache) — budget 10 minutes on a cold cache
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section>
          <h2>Reproduce</h2>
          <p className="judge-kicker">The real path — live Nansen, real credits:</p>
          <pre>{`git clone ${REPO} && cd glidepath && npm install
export NANSEN_API_KEY=nsn_...     # https://app.nansen.ai/api
npm run glidepath -- PEPE --chain ethereum --amount 12000000000 --explain   # 12 credits, ~2–3 s
npm run bench                                                              # ~270 credits, 7 tokens × 3 runs`}</pre>
          <p className="judge-kicker">CI / deterministic replay — no key, no network, 0 credits (this is proof the engine is a pure function of the recorded responses, not the product):</p>
          <pre>{`npm run verify        # 13/13 plans reproduced offline (NANSEN_OFFLINE=1 inside the script)
npm test              # 231 tests incl. 60,000 property cases
npm run check         # submission-readiness audit`}</pre>
        </section>

        <section>
          <h2>Honest limits</h2>
          <ul>
            <li>
              <strong>The impact model is an approximation.</strong> Constant-product on Nansen&apos;s <code>liquidity_usd</code> as one pool with the token on one side — optimistic for a single thin
              pool, no MEV, no gas. Only solana and base get a real routed <code>trade/quote</code>; EVM chains show the model, labelled.
            </li>
            <li>
              <strong>The pro share is small on real tokens.</strong> Across 11 tokens, Smart Money / funds / whales / exchanges were 0–3.6 % of DEX buys, so the headline label filter moves
              &ldquo;organic&rdquo; by a few percent. Glidepath shows the split instead of dramatising it; the red-day rule (cohort flows) is where Nansen data visibly changes the calendar.
            </li>
            <li>
              <strong>A slow Nansen day is visible.</strong> Cold plans take 2–10 s; the organic-breadth page has a 12 s ceiling and timed out once in review (plan took 14.8 s with a red
              &ldquo;failed: timeout&rdquo; provenance row, concentration not applied). Failures are never cached and never invented — the term is null and the warning names the endpoint.
            </li>
          </ul>
        </section>

        <section>
          <h2>Links</h2>
          <div className="links">
            <a className="btn primary" href={LIVE}>
              Live app
            </a>
            <a className="btn" href={REPO}>
              Repository
            </a>
            <a className="btn" href={`${REPO}/blob/main/DEMO.md`}>
              DEMO.md — reproduce every number
            </a>
            <a className="btn" href={`${REPO}/blob/main/docs/SCORING.md`}>
              SCORING.md — formulas with the PEPE numbers
            </a>
            <a className="btn" href={`${REPO}/releases/tag/v1.1.0`}>
              Release v1.1.0
            </a>
            <a className="btn" href="https://x.com/edycutjong">
              @edycutjong — the demo clip is posted here at submission
            </a>
          </div>
          <p className="judge-kicker">Built for the Nansen Meridian Buildathon (14–27 Sep 2026). Not financial advice.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
