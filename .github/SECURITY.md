# Security Policy

## Supported Versions
| Version | Supported |
|---|---|
| latest (`main`, v1.x) | ✅ |

## The boundary this project guarantees — and tests
The Nansen API key lives on the server (`NANSEN_API_KEY`, or `~/.config/…` for the CLI) and travels in exactly one place: the `apikey` request header to `api.nansen.ai`. It never reaches a browser or a file:

- **Engine** (`packages/core/test/boundary.test.ts`): a full plan serialised to JSON, its provenance, and the ICS/CSV exports contain no `nsn_` key; an upstream error body that echoes the key back is redacted before it reaches `plan.errors`; the client refuses to start without a well-formed key, so a missing env var can never become an unauthenticated request.
- **Web API** (`apps/web/test/api-boundary.test.ts`): `/api/plan` validates input **before** the key check and before any network call — a malformed query is a 400 with the server holding no key and `fetch` never invoked; a well-formed query with no key is a 500 that names the variable, never a key.
- **Built app** (`e2e/`): the page HTML of `/`, `/judge`, `/p` and every API response is asserted key-free by Playwright against the production build started with `NANSEN_API_KEY=""`.
- **Repository**: `npm run check` greps the tree and the full git history for `nsn_…`; gitleaks (full history) and TruffleHog (verified secrets only) run in CI; recorded fixtures store response bodies, never request headers.

Glidepath plans; it never trades and never holds keys to a wallet.

**The key cannot be drained through the public route** (`apps/web/lib/guard.ts`, `apps/web/test/guard.test.ts`):
6 requests per minute per address (**429** + `Retry-After`) and 3,000 live credits per UTC day counted from each
plan's own total, after which the route answers an honest **503** before any Nansen call. Counters are per
instance — a ceiling, not accounting. Tunable with `GUARD_IP_PER_MIN` / `GUARD_DAILY_CREDITS`.

## Reporting a Vulnerability
Please **do not** open a public issue for security vulnerabilities. Instead,
report them privately:

- Email **edy.cu@live.com**, or
- Use GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security → Report a vulnerability).

You'll get an acknowledgment within 48 hours and a resolution timeline after
triage. Please give us a reasonable window to patch before public disclosure.
