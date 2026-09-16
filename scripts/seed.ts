/**
 * Record the fixture set: run each query LIVE once, write every raw Nansen response the plan touched plus the plan
 * itself to fixtures/<TOKEN>--<chain>[--tag].json. Responses are stored byte-for-byte and never edited.
 * `npm run verify` replays them offline and must reproduce every decision hash.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run seed          # all (~150 credits)
 *   npm run seed -- PEPE BONK                                                    # a subset by token
 */
import { CachedNansenClient, MemoryCache, glidepath, writeFixture, type Fixture, type PlanInput } from "../packages/core/src/index";

export const FIXTURE_SET: Array<{ input: PlanInput; edge: string; tag?: string }> = [
  { input: { chain: "ethereum", token: "0x6982508145454ce325ddbe47a25d4ec3d2311933", amount: 12_000_000_000 }, edge: "1 · hero — PEPE 12B (≈$40K donation); large, liquid; exchange-driven red days in history" },
  { input: { chain: "ethereum", token: "0x6982508145454ce325ddbe47a25d4ec3d2311933", amount: 400_000_000_000 }, tag: "BIG", edge: "2 · big bag on the hero — long calendar, impact gap visible" },
  { input: { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 }, tag: "TICKER", edge: "3 · ticker input resolved by search/general (0 credits) — same decision as #1" },
  { input: { chain: "solana", token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", amount: 20_000_000_000 }, edge: "4 · BONK on solana — real trade/quote route for one tranche and the whole bag" },
  { input: { chain: "solana", token: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", amount: 200_000 }, edge: "5 · WIF on solana — route-quoted; thinner than BONK" },
  { input: { chain: "base", token: "0x532f27101965dd16442e59d40670faf5ebb142e4", amount: 3_000_000 }, edge: "6 · BRETT on base — route-quoted, 18-decimal base units" },
  { input: { chain: "ethereum", token: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", amount: 2_000_000_000 }, edge: "7 · SHIB on ethereum — quote unsupported chain → labelled constant-product estimate" },
  { input: { chain: "base", token: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", amount: 5_000_000 }, edge: "8 · DEGEN on base — thin organic demand ($1.6K/day in the spike): long calendar, liquidity cap" },
  { input: { chain: "ethereum", token: "0xa35923162c49cf95e6bf26623385eb431ad920d3", amount: 50_000_000 }, edge: "9 · TURBO on ethereum — smaller meme, few buyers" },
  { input: { chain: "ethereum", token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: 50_000 }, edge: "10 · USDC — huge organic demand, k at its ceiling, one tranche" },
  { input: { chain: "ethereum", token: "0x4dfae3690b93c47470b03036a17b23c1be05127c", amount: 3_000 }, edge: "11 · OG Pepe (2020, 37K total supply, 5 buyers/7d, no indicators) — thin: unsold remainder after 90 days, single-buyer dependence" },
  { input: { chain: "ethereum", token: "0x2de7b02ae3b1f11d51ca7b2495e9094874a064c0", amount: 100_000_000 }, edge: "12 · SHIB2 — $0 DEX buys in 7 days → no organic demand, no calendar, numbers still shown" },
  { input: { chain: "ethereum", token: "XQZPLM", amount: 1 }, edge: "13 · ticker that does not exist → not-found, zero credits" },
];

const wanted = process.argv.slice(2).map((q) => q.toUpperCase());
const set = wanted.length ? FIXTURE_SET.filter((f) => wanted.some((w) => f.input.token.toUpperCase().includes(w) || (f.tag ?? "").includes(w) || f.edge.toUpperCase().includes(w))) : FIXTURE_SET;
const apiKey = process.env.NANSEN_API_KEY ?? "";
let totalCredits = 0, totalCalls = 0;

for (const f of set) {
  const store = new MemoryCache(); // fresh per fixture: every response is fetched live and lands in the file
  const client = new CachedNansenClient(apiKey, { store });
  const now = Date.now();
  const plan = await glidepath(client, f.input, { now });
  const live = plan.provenance.filter((c) => !c.cached && c.ok);
  const failed = plan.provenance.filter((c) => !c.ok);
  const fixture: Fixture = { edge: f.edge, input: f.input, now, recordedAt: new Date(now).toISOString(), live: { calls: live.length, credits: plan.credits, ms: plan.ms }, responses: store.entries(), plan };
  const path = writeFixture(fixture, undefined, f.tag);
  totalCredits += plan.credits; totalCalls += live.length;
  const out = plan.status === "ok" || plan.status === "thin" ? `${plan.days} tranches · dump $${Math.round(plan.dumpToday.costUsd ?? 0)} vs glide $${Math.round(plan.glidepath.costUsd ?? 0)} (${plan.glidepath.model})${plan.today.red ? " · RED today" : ""}` : `${plan.status.toUpperCase()} — ${plan.statusReason}`;
  console.log(`${(plan.resolved.symbol ?? f.input.token).padEnd(8)} ${f.input.chain.padEnd(9)} → ${path}  ${out} · ${plan.credits} cr / ${live.length} calls / ${(plan.ms / 1000).toFixed(1)}s · ${plan.hash.slice(0, 12)}${failed.length ? `  ⚠ failed: ${failed.map((c) => `${c.endpoint} (${c.error})`).join(", ")}` : ""}`);
}
console.log(`\n${set.length} fixtures · ${totalCredits} credits · ${totalCalls} live calls`);
