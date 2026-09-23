# ARCHITECTURE.md

```
                       ┌────────────────────────────── Nansen API (apikey header, POST JSON / GET quote) ──────────────────────────────┐
                       │ search/general · tgm/token-information · tgm/who-bought-sold ×2 · tgm/flow-intelligence ×2 · tgm/flows ×2 · tgm/indicators · trade/quote ×3 │
                       └──────────────────────────────────────────────────────────────┬──────────────────────────────────────────────────┘
                                                                                      │ raw text, sha256'd, credits from response headers
  packages/core/src                                                                   ▼
  ├─ client.ts       NansenClient: token bucket (8 rps) · timeout · 1 retry on 429/5xx/timeout/socket error (honours Retry-After) · a non-JSON 200 is a failed call · Call log · onCall observer (CallEvent start/end)
  ├─ cache.ts        CachedNansenClient: read-through cache keyed by (method, endpoint, canonical body); hit = 0 credits; only parsed JSON is stored; NANSEN_OFFLINE=1 never touches the network
  ├─ nansen.ts       typed request bodies (verified against openapi.json) · EXCLUDED_LABELS · whoBoughtPaged (per_page 1000, cap) · flows · indicators · quote
  ├─ resolve.ts      address passes through; ticker → search/general (0 credits), exact symbol/name on the chain, lowest rank
  ├─ facts.ts        one Promise.all over 8 calls; every failure lands in errors[term], fields stay null
  ├─ plan.ts         the formulas: price → organic/day → risk dial k → tranches → red-day rule (today + 14-day history) → impact → decision hash
  ├─ impact.ts       constant-product cost(V) = V²/(L/2+V) · trade/quote legs (USDC probe for decimals, then one tranche + whole bag)
  ├─ glidepath.ts    resolve → facts → computePlan → applyQuotes → provenance/credits/ms/asOf
  ├─ export.ts       ICS (one all-day VEVENT per tranche, go/no-go rule in the description) · CSV
  └─ fixtures.ts     Fixture = {input, now, raw responses, plan}; seed.ts records live, verify.ts replays offline

  packages/cli/src/cli.ts        npm run glidepath -- <token> --chain <chain> --amount <n> [--json --explain --csv f --ics f --no-cache --no-quotes]

  apps/web (Next.js 15, App Router, plain CSS)
  ├─ app/page.tsx                three inputs → POST /api/plan?stream=1 → <Glidepath> (cards, drawer) + <Rail> (the live call log on the right)
  ├─ app/api/plan/route.ts       server-side key; CachedNansenClient with memory (≤ 1,000 responses) + disk (/tmp on Vercel) cache, 1 h TTL; ?stream=1 = NDJSON start · call · plan lines
  ├─ lib/guard.ts                admit(): the spend guard in front of every route that can spend credits (plan, export, /p, og) — per-IP window per route (429), shared daily credit ceiling (503)
  ├─ app/api/export/route.ts     ?format=ics|csv, served from the same cache so the file matches the screen; guarded, plain-text 4xx/5xx on failure
  ├─ app/p/page.tsx              share page (?chain&token&amount) with OG/Twitter meta → /api/og (1200×630 card); guarded, a failure is a banner, never a 500
  ├─ components/Glidepath.tsx    dump line · facts · 14-day red/green strip + live today · tranche bars · cost line · exports · provenance drawer · "computed Ns ago"
  └─ components/Rail.tsx         the Nansen call rail: one row per CallEvent (pending → live/cached/error), credits · ms · sha256; replayed example on load; session totals

  scripts/  spike.ts (day-one pagination + filter spike) · seed.ts · verify.ts · bench.ts · check_submission_readiness.ts
```

## Data flow for one plan
1. **Resolve** — `looksLikeAddress()` or `search/general` (0 credits). Unknown chain, bad amount or unknown ticker return a `not-found` plan with a reason, never an exception.
2. **Facts** — eight calls in parallel (`Promise.all` over individually caught promises). Timeouts are per call (12–20 s); the organic-breadth page has no retry so it can never stall a plan.
3. **Plan** — pure function of `(facts, input, now)`. Every branch that lacks data adds a warning naming the endpoint; the status is one of `ok · thin · no-organic-demand · no-price · not-found`.
4. **Quotes** — solana/base only, after the tranche size is known: three `GET trade/quote` calls; any failure keeps the constant-product number and says so.
5. **Hash** — sha256 over the decision only; the CLI, the web app and `verify.ts` show the first 12 hex chars.
6. **Stream** — the web route attaches an `onCall` observer to the client; each `start` event (a call leaving) and `end` event (the recorded `Call`) is written as one NDJSON line while the plan is still computing, so the page's call rail shows the truth as it arrives. The drawer prints `plan.provenance` afterwards — the same objects — so the two can never disagree.

## Caching and the recording
Cache key = sha256(method + endpoint + canonical JSON body). The who-bought-sold and flows windows are floored to the hour, so a token re-planned within the hour is a full cache hit (0 credits, ≈ 2–5 ms). A hit is still a `Call` in provenance (`cached: true`, 0 credits) and the oldest hit's timestamp drives the "computed Ns ago" badge. Failures are never cached. The web deployment uses a per-instance memory cache plus `/tmp` disk, so a warm Vercel function stays warm.

## Determinism
`now` is an explicit input. Fixtures record it, so a replay a week later computes the same calendar dates, the same red history, the same hash. `verify.ts` also asserts zero network calls and zero credits on replay, and that every response served came from the recorded run (sha256 match).

## What it deliberately does not do
No wallet, no signing, no execution (`trade/quote` is read-only pricing), no accounts, no database, no price prediction. The impact model is a stated approximation (see README caveat); the route quote is used wherever Nansen can route.
