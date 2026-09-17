# Contributing

Thanks for your interest in improving Glidepath! 🛬

## Getting Started
1. Fork the repo and branch from `main`: `git checkout -b feat/your-feature`
2. Install dependencies (Node ≥ 20): `npm install`
3. Copy the env template: `cp .env.example .env.local` — only the live steps need a key; `npm run verify` replays the 13 recorded plans offline
4. Start the planner: `npm run dev` → http://localhost:3000 — or the CLI: `npm run glidepath -- PEPE --chain ethereum --amount 12000000000`

## Before You Open a PR
- `npm run ci` passes — audit (production deps), prettier, eslint, tsc (engine + web), vitest with coverage (incl. 60,000 property cases), the offline replay (`verify`) and the readiness check.
- `npm run e2e` passes — Playwright against the built app with no key (`npx playwright install chromium` once).
- If you changed the engine's output for the same Nansen responses, re-derive the fixtures offline (`npm run seed -- --rederive`) and make sure `npm run verify` is 13/13. Re-recording live (`npm run seed`) costs ~150 credits — say so in the PR.
- Add or update tests for any behaviour change; name a regression test after the defect it pins.
- Keep commits conventional — `feat:` bumps the minor version, `fix:`/`perf:` the patch, `docs:`/`test:`/`ci:`/`chore:`/`style:` do not release.

## Reporting Bugs / Requesting Features
Open an issue using the provided templates. Include the token, chain and amount, the plan hash from the provenance drawer (or `--json`), expected vs. actual behaviour, and your Node version.
