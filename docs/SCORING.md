# SCORING.md — how Glidepath turns Nansen fields into a selling calendar

Every term below is a Nansen response field. The constants live in one place (`packages/core/src/plan.ts`) and every plan carries a provenance list (endpoint · fields used · credits · cached or live · ms) that the web app shows in the drawer and the CLI prints with `--explain`.

## The pipeline (one plan = 8–12 calls to 7 endpoints, 12–15 credits)

```
price            = market_cap_usd / circulating_supply                            tgm/token-information (7d)
positionUsd      = amount × price

totalBuy7dUsd    = spot_metrics.buy_volume_usd                                    tgm/token-information (7d, all DEX venues)
proBuy7dUsd      = Σ bought_volume_usd, BUY side, last 7 d,                       tgm/who-bought-sold, filters.include_smart_money_labels =
                   wallets carrying any PRO label                                   [Smart Trader, 30D/90D/180D Smart Trader, Fund, Whale, Exchange,
                                                                                     Maestro Bot User, Top Maestro Bot User, BananaGun Bot User, Top BananaGun Bot User]
organicBuy7dUsd  = totalBuy7dUsd − proBuy7dUsd
organicDailyUsd  = organicBuy7dUsd / 7
top1Share        = largest organic buyer / Σ page-1 organic buyers                tgm/who-bought-sold, filters.exclude_smart_money_labels (page 1 of 1000, sorted DESC)

risk dial        highs   = #{score == "high"}   over liquidity-risk, concentration-risk, btc-reflexivity     tgm/indicators (risk_indicators ∪ reward_indicators)
                 mediums = #{score == "medium" or missing}
                 k       = clamp(0.10 − 0.0233·highs − 0.010·mediums − 0.02·[top1Share > 0.25], 0.03, 0.10)

trancheUsd       = min(k × organicDailyUsd, 0.01 × liquidity_usd)                tgm/token-information spot_metrics.liquidity_usd
trancheTokens    = trancheUsd / price ;  N = ceil(amount / trancheTokens) ; capped at 90 days, remainder reported
tranche i        = UTC date(now + i days)

red-day rule     θ_sm = max($1,000, 0.10 × organicDailyUsd)     θ_ex = max($1,000, 1.00 × organicDailyUsd)
                 red(day) ⇔ smart_money_net < −θ_sm  ∨  exchange_net_deposits > +θ_ex
                 today   ← smart_trader_net_flow_usd, exchange_net_flow_usd        tgm/flow-intelligence (1d)
                 regime  ← the same fields over 7 d against 3·θ                    tgm/flow-intelligence (7d) — context line, never changes the hash
                 history ← (total_inflows_count + total_outflows_count) × price_usd per daily bucket, complete buckets only
                                                                                  tgm/flows label=smart_money and label=exchange, 14 d
                 a red today halves today's tranche;  expectedDays = ceil(N / (1 − 0.5 · redRate))

impact           constant product, both pool sides ≈ liquidity_usd / 2:  cost(V) = V² / (L/2 + V)
                 dumpTodayCost = cost(positionUsd) ;  glidepathCost = Σ cost(trancheUsd_i)
                 solana / base: GET trade/quote (USDC→token $5 probe for decimals, then token→USDC for one tranche and for the whole bag)
                                inUsdValue − outUsdValue replaces the model and the label reads "route quote"

honest states    organicDailyUsd < $50 ∨ organicBuyers < 5   → "no organic demand today" (numbers shown, no calendar)
                 N > 90                                        → "thin": calendar truncated, unsold remainder stated
                 price missing                                 → "no price"
                 ticker unknown on the chain                   → "not found", with the chains where the name exists
decision hash    sha256 of {chain, address, amount, status, price, organicDailyUsd, k, today, tranches, red history, costs, models}
                 — never cost/timing/cache metadata, so a replay of the same responses with the same clock is byte-identical
```

## Worked example — PEPE on ethereum, 12,000,000,000 tokens, recorded 2026-09-16 14:18 UTC (`fixtures/0X6982508145--ETHEREUM.json`, plan `688239ac1d8c`)

| step | Nansen field(s) | value |
|---|---|---|
| price | `market_cap_usd` 1,401,231,652 / `circulating_supply` 420,690,000,000,000 | $0.000003331 |
| position | 12,000,000,000 × price | **$39,970** |
| total DEX buys, 7 d | `spot_metrics.buy_volume_usd` | $3,236,056 (528 `unique_buyers`) |
| pro buys, 7 d | Σ `bought_volume_usd` with `include_smart_money_labels` | $24,893 — one wallet, shown as `nftsindubai.eth` |
| organic buys / day | (3,236,056 − 24,893) / 7 | **$458,738** (99.2 % organic) |
| single-buyer dependence | top organic buyer / page-1 organic volume | 22 % → not concentrated |
| risk dial | liquidity-risk **medium**, concentration-risk **low**, btc-reflexivity **high** | k = 0.10 − 0.0233 − 0.010 = **6.67 %** |
| tranche | min(0.0667 × 458,738, 0.01 × 13,790,405) | **$30,598** (organic-bound; the liquidity cap would be $137,904) |
| calendar | ceil(39,970 / 30,598) | **2 tranches**: Sep 16 $30,598 · Sep 17 $9,372 |
| today | `smart_trader_net_flow_usd` +$5 · `exchange_net_flow_usd` −$1,724,177 (withdrawals) | **green** (θ_sm $45,874 · θ_ex $458,738) |
| history | `tgm/flows` daily exchange net deposits | **4 red of 13**: Sep 4 +$1.92M · Sep 10 +$1.57M · Sep 11 +$1.39M · Sep 14 +$499K |
| expected days | ceil(2 / (1 − 0.5 × 0.31)) | 3 |
| dump today | 39,970² / (6,895,202 + 39,970) | **$230.36** (0.58 %) · 8.7 % of a day's organic buys |
| glidepath | 30,598²/(6,895,202+30,598) + 9,372²/(6,895,202+9,372) | **$147.90** — saves $82.46 |
| cost | 8 live calls (search skipped: address input) | 12 credits · 1.5 s cold · 0 credits / 2 ms warm |

The same query typed as `PEPE` (ticker) adds one `search/general` call at 0 credits and produces the identical hash — `fixtures/PEPE--ETHEREUM--TICKER.json`.

## Why these shapes
- **Organic = total − pros, not Σ organic rows.** The spike (`docs/DX-REPORT.md`) found hot tokens with more than 20,000 buyers in 7 days: paging the organic side costs 20 credits and 110 s. The pro side is 0–67 wallets and one page. Both numbers are Nansen's; only the subtraction is ours.
- **θ_ex is a full day of organic buys** because exchange flows for CEX-listed tokens are routinely ±$1M of internal shuffling; "more tokens deposited to exchanges than organic buyers absorb in a day" is the level at which a seller is genuinely competing with the pros. θ_sm is 10 % because Smart Money is a narrow cohort and $46K of net selling by 21 wallets is a signal.
- **A red today halves rather than pauses**, so a distribution regime never strands the seller; the observed 14-day red rate stretches the expected finish instead.
- **k shrinks with peer-percentile risk**, not with our own opinion: three "high" scores land exactly on 3 %, three "low" on 10 %, and a missing indicator is treated as medium and named in the warnings.
- **The impact model is stated, not hidden.** `liquidity_usd` aggregates every pool, so the constant-product number is optimistic for tokens whose depth sits in one thin pool. Where Nansen can route (solana, base) the real `trade/quote` replaces it and the label changes.

## What the data taught us (2026-09-16)
- `exclude_smart_money_labels` / `include_smart_money_labels` partition the buyer set exactly (8/8 tokens) and act on labels the row's `address_label` does not show — organic vs pro exists only as a server-side filter.
- Pros are 0–3.6 % of DEX buy volume on every token tried (majors 98.5–100 % organic, 5–7-day-old Solana launches 96.4–96.7 %). The four bot-user labels matched zero rows even on pump.fun launches.
- `tgm/flows` `total_inflows_count` / `total_outflows_count` are token amounts, not counts (PEPE exchange inflows 8.6 × 10¹¹ tokens/day), and its `smart_money` cohort (18 PEPE holders) is narrower than flow-intelligence's `smart_trader` (21 wallets) — history and today use different cohort definitions.
- `tgm/flows` returns 422 for stablecoins ("is a stablecoin"); USDC plans run without history and say so.
- `tgm/indicators` files `concentration-risk` under `reward_indicators`; the engine scans both arrays by `indicator_type`.
- `trade/quote` costs 1 credit, returns `toTokenDecimals`, so a $5 USDC→token probe gives the decimals needed to size the sell-side quotes.
