# DX-REPORT.md — Nansen API friction log (2026-09-16, live)

Everything here was hit for real while building Glidepath. Numbers come from `npm run spike`, `npm run seed` and `npm run bench`.

## What was great
- **`X-Nansen-Credits-Used` / `X-Nansen-Credits-Remaining` on every response.** The client reads them, so the credit counter in the provenance drawer is what Nansen charged, not a table we maintain. The static table is only a fallback.
- **`per_page: 1000` on `tgm/who-bought-sold`.** PEPE's whole 7-day buyer list is one page (408 rows). The docs example default of 10 hides this.
- **Label filters do exactly what they say.** `exclude_smart_money_labels` + `include_smart_money_labels` with the same list partition the buyer set exactly, on all 8 tokens tried.
- **`tgm/flows` gives real daily cohort history for 1 credit** — daily buckets with `price_usd`, per label. This is the whole red-day history.
- **`trade/quote` returns `toTokenDecimals`** — a $5 USDC→token probe is enough to size base-unit sell quotes without any other decimals source.
- Latency is fine for a sequential-free design: with all 8 calls in `Promise.all`, a cold plan is 1.4–6 s (bench p50 3.5 s, p95 6.0 s).

## Surprises (each one cost time)
1. **`address_label` does not carry the label the filter matched.** The one PEPE buyer removed by `exclude_smart_money_labels` shows `address_label: "nftsindubai.eth"`; excluded rows elsewhere show `High Balance`, `STONK Whale`, `<X> Token Deployer`. You cannot compute the organic/pro split client-side from the rows — only the server-side filter knows. Documenting that `address_label` is a display label (one string) would save the first hour.
2. **Buyer counts explode on hot tokens.** 5–7-day-old Solana launches had > 20,000 BUY addresses in 7 days: 20 pages × 1000, 110 s, 20 credits, still truncated. BONK cold took 84 s for 4 pages; the second pass took 20 s (server cache). We redesigned to never page the organic side: organic = `token-information.buy_volume_usd` − Σ pro rows (pros are ≤ 67 wallets everywhere we looked). A `sum_bought_volume_usd` aggregate in the response, or a `min bought_volume_usd` default, would make the endpoint usable per-request on big tokens.
3. **The four bot-user labels (`Maestro Bot User`, `Top Maestro Bot User`, `BananaGun Bot User`, `Top BananaGun Bot User`) matched zero rows** on 11 tokens including pump.fun launches with 20,000+ buyers. Either they are Ethereum-only Telegram-bot labels, or not applied to DEX trade rows. We kept them in the exclusion list but make no claim about them.
4. **Pros are a tiny share of DEX buying: 0–3.6 %.** The idea that "organic demand" is a small fraction of headline volume did not survive contact with data for these tokens. The product shows the split honestly instead of dramatising it.
5. **`tgm/token-information` requires `timeframe`** although the schema marks it optional (422 "Missing field" without it — same finding as the sibling project).
6. **Two "buy volume" numbers disagree.** PEPE 7 d: `token-information.buy_volume_usd` $3,236,056 / 528 unique buyers vs `who-bought-sold` Σ `bought_volume_usd` $1,682,566 / 408 rows. Presumably venue coverage. The engine uses token-information as the total and who-bought-sold only for the pro subset; a note on coverage in the docs would settle it.
7. **`tgm/flows` `total_inflows_count` / `total_outflows_count` are token amounts**, not counts (PEPE exchange inflows 8.6 × 10¹¹ per day), and outflows are negative. Net flow = inflows + outflows.
8. **`tgm/flows` refuses stablecoins with 422** ("Token … is a stablecoin"). Reasonable, but it is not in the schema; USDC plans lose the history strip and say so.
9. **`tgm/indicators` puts `concentration-risk` in `reward_indicators`** while the description lists it under risk; `cex-flows` appears under risk. We scan both arrays by `indicator_type`.
10. **`tgm/flows` `smart_money` cohort ≠ flow-intelligence `smart_trader` cohort** (PEPE: 18 holders vs 21 wallets, different net flows). Today's red test and the history use different definitions of "Smart Money"; the docs could say which labels each aggregates.
11. **One transient `tgm/flows` failure in 195 bench calls** (PEPE, run 1) — the plan degraded to "history unavailable" and the warm re-run fetched it. Failures are never cached.
12. **`search/general` returns `hyperliquid` perp markets as tokens** (e.g. `PEPE` on hyperliquid); TGM endpoints reject the chain. The resolver ignores them.
13. **Rate-limit headers are present but the plan-notice header says "Free tier"** on a paid-credit account (`x-nansen-plan-notice: Free tier gets 10 free credits every day`). Cosmetic, mildly alarming mid-build.

## Cost of one plan (measured)
| chain | calls | credits | why |
|---|---|---|---|
| ethereum / bnb / … | 8 (+1 `search/general` at 0 for a ticker) | 12 | token-information 1 · who-bought-sold ×2 · flow-intelligence ×2 · flows ×2 · indicators 5 |
| solana / base | 11 | 15 | + three `trade/quote` GETs at 1 each |
| stablecoin | 8 | 10 | the two `tgm/flows` calls fail at 0 credits |

Total spent building this entry (spike + seeds + bench + QA): see `DEMO.md`.
