# For the judge

Live version of this page: **https://glidepath-lilac.vercel.app/judge** (no auth, no cookies, no key, no network needed to read it).

Everything below is verifiable in the repo or on the live app. No account, no wallet, no key needed to click the path.

## The claim

> You have to sell a token you never meant to own. Glidepath turns it into a dated selling calendar sized to the market's organic demand — so you are never the biggest seller on a day the pros are exiting.

Nansen labels decide what counts as organic. It plans; it never trades.

## The 30-second path

1. Open **https://glidepath-lilac.vercel.app** and click **PEPE · 12B (a $40K donation)** — a two-tranche calendar in ≈3 s cold (12 live Nansen credits; 0 on a cache hit). Read the *Dump today* line: position, estimated impact, and what share of a full day's organic buys you would be.
2. Click **BONK · 20B on solana** — when exchanges are net-receiving BONK, *today is red*: the first tranche is halved and the reason is printed. Costs come from a real `trade/quote` route, labelled as such.
3. Click **Every Nansen call (11)** under the plan — the provenance drawer: every Nansen call, the fields used, credits from the response headers, cached or live, and milliseconds.
4. Click **ICS** — one calendar event per tranche with the go/no-go rule inside; **CSV** for the spreadsheet.
5. Open the share page https://glidepath-lilac.vercel.app/p?chain=solana&token=BONK&amount=20000000000 — server-rendered, with an OG image at https://glidepath-lilac.vercel.app/api/og?chain=solana&token=BONK&amount=20000000000.

## Receipts (real runs, not estimates)

| | |
|---|---|
| **Hero plan** | PEPE · 12,000,000,000 on ethereum — **12 credits · 8 calls · 1.5 s**, plan `688239ac1d8c`, recorded 2026-09-16 14:18 UTC (`fixtures/0X6982508145--ETHEREUM.json`) |
| **Bench** | 7 tokens × 3 runs, 2026-09-16 14:22 UTC — cold **p50 3.47 s / p95 5.95 s**, warm **p50 5 ms / p95 356 ms**, **13.0 credits/plan**, 9.3 calls/plan, 2.0 who-bought-sold pages/plan, 7 of 195 calls failed (6 deterministic: `tgm/flows` refuses stablecoins), 272 credits total |
| **Credits spent building** | ≈ 800 credits · ≈ 700 live Nansen calls (header balance 62,320 → 59,360 across the build; table in [DEMO.md](DEMO.md)) |
| **Nansen surface** | 7 endpoints · 11 calls per plan · 12 credits on EVM chains, 15 on solana/base, 0 on a cache hit |
| **Tests** | **231 vitest tests** (unit, end-to-end on a fake Nansen, one replay per fixture, key-boundary) · **13/13 recorded plans reproduce offline** byte-for-byte |
| **Property-based verification** | **60,000 generated cases** (fast-check, 6 properties × 10,000) on the tranche planner: Σ tranches + remainder = amount held; every tranche ≤ k × organic/day and ≤ 1% of liquidity; a red today halves tranche 1 and only tranche 1; consecutive UTC dates, ≤ 90 of them, expectedDays ≥ days ≥ 1; the decision hash is deterministic and invariant to timing and context fields. It found one real defect (a zero-token tranche emitted 90 empty rows) — fixed and pinned. `packages/core/test/plan.property.test.ts` |
| **E2E** | 4 Playwright suites (home, planner flow, responsive 320/375/768/1440, this page) — run in CI with no key; the built app is asserted to never contain an `nsn_` key |
| **Clean clone** | ≈ 15 s from `git clone` to the first live plan (independent reviewer, 2026-09-16 23:51 UTC, warm npm cache) — budget 10 minutes on a cold cache |

## Reproduce

The real path — live Nansen, real credits:

```bash
git clone https://github.com/edycutjong/glidepath && cd glidepath && npm install
export NANSEN_API_KEY=nsn_...     # https://app.nansen.ai/api
npm run glidepath -- PEPE --chain ethereum --amount 12000000000 --explain   # 12 credits, ~2–3 s
npm run bench                                                              # ~270 credits, 7 tokens × 3 runs
```

CI / deterministic replay — no key, no network, 0 credits (this is proof the engine is a pure function of the recorded responses, not the product):

```bash
npm run verify        # 13/13 plans reproduced offline (NANSEN_OFFLINE=1 inside the script)
npm test              # 231 tests incl. 60,000 property cases
npm run check         # submission-readiness audit
```

## Honest limits

- **The impact model is an approximation.** Constant-product on Nansen's `liquidity_usd` as one pool with the token on one side — optimistic for a single thin pool, no MEV, no gas. Only solana and base get a real routed `trade/quote`; EVM chains show the model, labelled.
- **The pro share is small on real tokens.** Across 11 tokens, Smart Money / funds / whales / exchanges were 0–3.6 % of DEX buys, so the headline label filter moves "organic" by a few percent. Glidepath shows the split instead of dramatising it; the red-day rule (cohort flows) is where Nansen data visibly changes the calendar.
- **A slow Nansen day is visible.** Cold plans take 2–10 s; the organic-breadth page has a 12 s ceiling and timed out once in review (plan took 14.8 s with a red "failed: timeout" provenance row, concentration not applied). Failures are never cached and never invented — the term is null and the warning names the endpoint.

## Links

- Live app: https://glidepath-lilac.vercel.app
- Repository: https://github.com/edycutjong/glidepath
- [DEMO.md](DEMO.md) — reproduce every number · [docs/SCORING.md](docs/SCORING.md) — formulas with the PEPE numbers · [ARCHITECTURE.md](ARCHITECTURE.md)
- Release: https://github.com/edycutjong/glidepath/releases/tag/v1.1.0
- Demo clip: posted from [@edycutjong](https://x.com/edycutjong) on X at submission

Built for the Nansen Meridian Buildathon (14–27 Sep 2026). Not financial advice.
