# DEMO.md — reproduce every number in the README

All commands run from the repo root on Node ≥ 20. The only secret is `NANSEN_API_KEY` (an `nsn_…` key from https://app.nansen.ai/api). Offline steps need no key at all.

## 0. Setup (≈ 1 min)
```bash
git clone https://github.com/edycutjong/glidepath && cd glidepath
npm install
export NANSEN_API_KEY=nsn_...        # only for the live steps
```

## 1. The hero plan — PEPE, 12,000,000,000 tokens (live, 12 credits, ~2–3 s)
```bash
npm run glidepath -- PEPE --chain ethereum --amount 12000000000 --explain --ics pepe.ics --csv pepe.csv
```
Recorded output, 2026-09-16 14:18 UTC (`fixtures/0X6982508145--ETHEREUM.json`, plan `688239ac1d8c`):
```
PEPE on ethereum 0x6982508145454ce325ddbe47a25d4ec3d2311933
price $0.000003331 (token-information market_cap_usd / circulating_supply) · liquidity $13,790,405 · holders 400,472
organic buys $458,738/day = ($3,236,056 DEX buys 7d − $24,893 by Smart Money/Fund/Whale/Exchange/bot users [1 wallets]) / 7 · organic share 99.2% · 528 organic buyers
risk dial  k = 6.7% (liquidity-risk=medium, concentration-risk=low, btc-reflexivity=high)
today 2026-09-16  green (Smart Money net $5, exchange net $-1,724,177, θ_sm = $45,874, θ_ex = $458,738)
last 13 days ■■■■■■■■■■■■■  4 red of 13 (09-04 Exchange net deposits +$1,918,463; 09-10 +$1,574,265; 09-11 +$1,386,698; 09-14 +$499,032)

Dump today: $39,970 · est. cost $230.36 (constant-product) · you would be 9% of a day's organic buys

Glidepath: 2 tranches of ≤ $30,598 (6.7% of organic/day) · est. cost $147.90 (constant-product) · saves $82.46 · expect ~3 days at the 31% red-day rate
  2026-09-16  ████████████████████████    9,186,339,787 PEPE    $30,598
  2026-09-17  ███████                     2,813,660,213 PEPE     $9,372

12 credits · 8 calls (0 cached) · 1.5s · plan 688239ac1d8c
```
The same numbers on the web: `npm run dev` → http://localhost:3000 → click "PEPE · 12B". The BONK example shows a **red today** (exchange net deposits +$877,893 → first tranche halved) and real `trade/quote` route costs.

## 2. Offline proof — 13 recorded plans replay byte-for-byte (no key, no network, 0 credits)
```bash
npm run verify
```
```
✔ PEPE ethereum 12,000,000,000   688239ac1d8c  8 calls replayed · 2 tranches · recorded 2026-09-16T14:18Z · 1 · hero …
✔ BONK solana 20,000,000,000     d7c0aba968bb  11 calls replayed · 5 tranches, red today · … · 4 · real trade/quote route …
✔ SHIB2 ethereum 100,000,000     a1ecc466217e  8 calls replayed · no-organic-demand · … · 12 · $0 DEX buys in 7 days …
✔ XQZPLM ethereum 1              8ab45ff4e3fe  1 calls replayed · not-found · … · 13 · ticker that does not exist …
…
13/13 plans reproduced offline
```
Each fixture stores every raw Nansen response (keyed by request, byte-for-byte), the plan, and the clock it ran under; `verify.ts` replays with `NANSEN_OFFLINE=1`, so a network call or a spent credit is a failure.

## 3. Tests, typecheck, readiness
```bash
npm test          # 84 vitest tests (tranche sizing table, red-day rule, risk dial, impact model, hash stability, pagination cap, cache, client, exports, resolver, end-to-end on a fake Nansen, every fixture)
npm run typecheck
npm run check     # submission readiness: files, secrets, kitchen leaks, fixtures, verify, tests, README claims
```

## 4. Benchmark (live, ~270 credits for 3 runs)
```bash
npm run bench                 # or: npm run bench -- --runs 1
```
## Bench — 7 tokens × 3 runs, 2026-09-16T14:22Z

| metric | cold (fresh cache, live Nansen) | warm (second call, same cache) |
|---|---|---|
| p50 latency | 3.47 s | 5 ms |
| p95 latency | 5.95 s | 356 ms |
| credits / plan | 13.0 (min 10, max 15) | 0 |
| calls / plan | 9.3 | same, all cached |
| who-bought-sold pages / plan | 2.0 | — |
| failed calls | 7 of 195 | — |
| hash cold == warm | 20/21 | — |

| token | cold p50 | cold max | warm p50 | credits | calls |
|---|---|---|---|---|---|
| PEPE/ethereum | 1.4 s | 2.4 s | 2 ms | 11 | 8 |
| BONK/solana | 4.4 s | 4.6 s | 5 ms | 15 | 11 |
| BRETT/base | 6.0 s | 10.2 s | 7 ms | 15 | 11 |
| SHIB/ethereum | 3.5 s | 5.0 s | 2 ms | 12 | 8 |
| DEGEN/base | 5.2 s | 5.8 s | 4 ms | 15 | 11 |
| TURBO/ethereum | 1.4 s | 1.7 s | 2 ms | 12 | 8 |
| USDC/ethereum | 1.8 s | 1.8 s | 351 ms | 10 | 8 |

total credits this bench: 272

"Cold" = fresh cache, all 8–11 calls live (Nansen's own server cache may be warm). "Warm" = second call on the same process cache. The USDC warm run re-fetches the two `tgm/flows` calls because failures (422 "is a stablecoin") are never cached.

## 5. Re-record the fixtures (live, ~150 credits)
```bash
npm run seed                  # all 13
npm run seed -- PEPE BONK     # a subset
npm run verify
```

## 6. The spike that shaped the design (live, ~40 credits)
```bash
npm run spike
```
Pages `tgm/who-bought-sold` three ways for 8 tokens and probes `trade/quote`; the findings are in `docs/DX-REPORT.md`.

## Credits spent building this entry (from the `X-Nansen-Credits-Remaining` header)
| step | credits |
|---|---|
| endpoint probes before the spec (curl) | 12 |
| `npm run spike` + bot-label probe on 3 fresh Solana tokens | 87 |
| engine bring-up, live CLI runs | ≈ 60 |
| `npm run seed` (13 fixtures, twice for two of them) | 166 |
| `npm run bench` (7 tokens × 3 runs) | 272 |
| web app smoke tests, screenshots, Vercel preview checks, QA | ≈ 120 |
| **total** | **≈ 720 credits · ≈ 560 live calls** (balance 62,320 → see README) |
