<div align="center">

# 🛬 Glidepath

**You have to sell a token you never meant to own. Glidepath turns it into a dated selling calendar sized to the market's organic demand — so you are never the biggest seller on a day the pros are exiting.**

[![ci](https://github.com/edycutjong/glidepath/actions/workflows/ci.yml/badge.svg)](https://github.com/edycutjong/glidepath/actions/workflows/ci.yml) ![tests](https://img.shields.io/badge/tests-87%20passing-16a34a) ![fixtures](https://img.shields.io/badge/fixtures-13%2F13%20replay%20offline-16a34a) ![Nansen](https://img.shields.io/badge/Nansen%20API-8%20endpoints-111827) ![license](https://img.shields.io/badge/license-MIT-blue)

![PEPE plan](docs/screenshots/01-pepe-plan.png)

**[Live preview](https://glidepath-2515ws14u-edy-cus-projects.vercel.app)** · [DEMO.md](DEMO.md) · [SCORING.md](docs/SCORING.md) · [DX-REPORT.md](docs/DX-REPORT.md) · [ARCHITECTURE.md](ARCHITECTURE.md)

</div>

## What it does, in 30 seconds

A nonprofit's finance officer receives a $40K memecoin donation. A freelancer is paid in a project's token. They have never used a DEX, and they must turn the tokens into dollars without crashing the price or competing with the funds on the day the funds are dumping.

Paste **token · chain · amount held**. Glidepath:

1. Computes **organic daily buy volume** — DEX buys over the last 7 days by wallets that carry **none** of Nansen's Smart Money / Fund / Whale / Exchange / sniper-bot labels — via `tgm/who-bought-sold` label filters and `tgm/token-information`.
2. Prints the **dump-today line**: position value, estimated impact, and what share of a full day's organic buying you would be.
3. Sizes daily **tranches** to `k` × organic/day, where `k` slides from 10 % to 3 % as Nansen's peer-percentile risk indicators rise (`tgm/indicators`), capped at 1 % of `liquidity_usd`.
4. Flags **red days**: today from `tgm/flow-intelligence` (Smart Money net-selling, or net deposits to exchanges), the last 14 days from `tgm/flows` daily cohort history. A red today halves the first tranche; the observed red-day rate stretches the expected finish.
5. Shows **dump today vs glidepath cost** — constant-product from `liquidity_usd`, or a real routed `trade/quote` on solana/base, labelled as such.
6. Exports the plan as **ICS** (one calendar event per tranche, with the go/no-go rule inside) and **CSV**, plus a share card with an OG image.
7. Opens a **provenance drawer**: every Nansen call, the fields used, credits (from Nansen's response headers), cached or live, ms — and a "computed Ns ago" badge.

It plans. It never trades.

![BONK red day](docs/screenshots/02-bonk-red-day.png)

## Quickstart — runs in under 10 minutes

```bash
git clone https://github.com/edycutjong/glidepath && cd glidepath   # 0:10
npm install                                                          # 0:40  (Node ≥ 20)
export NANSEN_API_KEY=nsn_...                                        # from https://app.nansen.ai/api
npm run glidepath -- PEPE --chain ethereum --amount 12000000000      # 0:05  → the plan, 12 credits
npm run dev                                                          # 0:20  → http://localhost:3000, click "PEPE · 12B"
```

Timed on a clean clone (macOS, Node 22): 1 min 30 s to the first live plan; 2 min 10 s to the web app. Without a key, `npm run verify` replays the 13 recorded plans offline in 3 s.

CLI flags: `--json` (full plan + provenance) · `--explain` (every tranche and every call) · `--ics plan.ics` · `--csv plan.csv` · `--no-cache` · `--no-quotes`.

## Nansen integration — the data drives the logic

| endpoint | credits | fields used | what it drives |
|---|---|---|---|
| `search/general` | 0 | `tokens[].symbol/name/chain/address/rank` | ticker → address on the chosen chain; "exists on other chains" when not |
| `tgm/token-information` (7d) | 1 | `market_cap_usd`, `circulating_supply`, `buy_volume_usd`, `unique_buyers`, `liquidity_usd`, `total_holders`, `total_supply` | price, total DEX buys, liquidity cap, impact model, sanity warnings |
| `tgm/who-bought-sold` BUY 7d, `include_smart_money_labels` = pro labels | 1 | `data[].bought_volume_usd`, `address_label` | the pro share subtracted from total buys → **organic/day** |
| `tgm/who-bought-sold` BUY 7d, `exclude_smart_money_labels`, page 1 of 1000 | 1 | `data[].bought_volume_usd` | single-buyer dependence (top organic buyer > 25 %) → k − 2 pts |
| `tgm/flow-intelligence` 1d | 1 | `smart_trader_net_flow_usd`, `exchange_net_flow_usd` | **is today red** (halve tranche 1) |
| `tgm/flow-intelligence` 7d | 1 | same | regime shown in provenance |
| `tgm/flows` label `smart_money`, 14d | 1 | `date`, `is_complete`, `price_usd`, `total_inflows_count`, `total_outflows_count` | daily Smart Money net flow → red-day history |
| `tgm/flows` label `exchange`, 14d | 1 | same | daily exchange net deposits → red-day history and rate |
| `tgm/indicators` | 5 | `liquidity-risk`, `concentration-risk`, `btc-reflexivity` scores | the participation rate `k` (10 % → 3 %) |
| `trade/quote` ×3 (solana, base) | 1 each | `toTokenDecimals`, `inUsdValue`, `outUsdValue`, `priceImpactPct` | real routed cost of one tranche and of the whole bag |

12 credits per plan on EVM chains, 15 on solana/base, 0 on a cache hit. Formulas with the real PEPE numbers: [docs/SCORING.md](docs/SCORING.md).

## Why only Nansen

"Organic demand" is a **who**, not a **how much**. An RPC node or an explorer gives you volume; it cannot tell you which buyers are funds, Smart Money, exchanges or sniper-bot users. On Nansen that split exists as a server-side label filter on `tgm/who-bought-sold` — and the spike showed the filter acts on labels the row's `address_label` does not even display, so there is no client-side substitute. The red-day rule needs **cohort** net flows (`tgm/flows`, `tgm/flow-intelligence`); the risk dial needs **peer-percentile** scores (`tgm/indicators`); the route quote needs an aggregator that returns decimals with the price (`trade/quote`). Remove Nansen and Glidepath degrades to a TWAP calculator on raw volume — exactly the number a forced seller must not trust.

## Honesty: what the numbers are and are not

- **Every number traces to a named Nansen field** — the provenance drawer and `--explain` list them per call. Nothing is estimated silently; when a call fails, the term is null, the warning names the endpoint, and the plan degrades (no history strip, no route quote, k treated as medium) instead of inventing a value.
- **Honest states**: no organic demand (< $50/day or < 5 buyers) → "there is nobody to sell to at any pace", numbers shown, no calendar. Calendar beyond 90 days → "N % still unsold after 90 days". Ticker unknown on the chain → the chains where it exists.
- **Impact-model caveat**: the constant-product estimate treats `liquidity_usd` as one pool with the token on one side. It is optimistic for tokens whose depth sits in a single thin pool, and it ignores MEV and gas. On solana and base the routed `trade/quote` replaces it and the label changes to "route quote". Not financial advice.
- **The pro share is small.** On the 11 tokens tried, Smart Money / funds / whales / exchanges were 0–3.6 % of DEX buys — Glidepath shows that split rather than dramatising it ([DX-REPORT.md](docs/DX-REPORT.md)).
- **Future days cannot be known red or green.** Today is live; the last 14 days are real; each ICS event carries the rule to re-check on the morning.

## Tests, fixtures, benchmark

- **87 vitest tests** (`npm test`): tranche-sizing table, red-day rule, risk dial vs indicator scores, impact model, decision-hash stability, pagination cap (the 20,000-buyer case), cache and offline mode, client retries/timeouts/header credits, ICS/CSV, resolver, end-to-end on a fake Nansen, and one replay test per fixture.
- **13 fixtures, 13/13 reproduced offline** (`npm run verify`): each stores the raw Nansen responses byte-for-byte, the plan and the clock; replay must match the hash with zero network calls and zero credits.
- **Bench** (`npm run bench`, 7 tokens × 3 runs): cold **p50 3.5 s / p95 6.0 s**, warm **p50 5 ms / p95 356 ms**, **13.0 credits/plan**, 9.3 calls/plan, 2.0 who-bought-sold pages/plan, 7 of 195 calls failed (6 deterministic: `tgm/flows` refuses stablecoins). Full table and reproduce steps: [DEMO.md](DEMO.md).

## Screenshots

| | |
|---|---|
| ![provenance](docs/screenshots/03-provenance-drawer.png) | ![mobile](docs/screenshots/04-mobile-thin.png) |
| ![share card](docs/screenshots/05-share-card.png) | |

## Repository

```
packages/core   engine (client, cache, facts, plan, impact, export, fixtures)   packages/cli   the CLI
apps/web        Next.js 15 planner (/api/plan, /api/export, /api/og, /p)       scripts/       spike · seed · verify · bench · check
fixtures/       13 recorded live runs                                           docs/          SCORING.md · DX-REPORT.md · screenshots
```

`npm run check` runs the submission-readiness audit (files, secrets, kitchen leaks, fixtures, verify, tests, README claims). CI runs typecheck, tests, verify and check on every push — no key needed.

## License

MIT — see [LICENSE](LICENSE). Built for the Nansen Meridian Buildathon (Sep 2026) by [@edycutjong](https://x.com/edycutjong).
