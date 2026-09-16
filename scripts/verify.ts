/**
 * Replay every fixture OFFLINE and prove the engine is deterministic: same responses + same clock → same decision hash,
 * same tranches, same status, zero network calls, zero credits. Exit 1 on any mismatch.
 *
 *   npm run verify                # NANSEN_OFFLINE is forced; no API key needed
 */
import { CachedNansenClient, glidepath, listFixtures, readFixture, fixtureStore, type Plan } from "../packages/core/src/index";

process.env.NANSEN_OFFLINE = "1";
const files = listFixtures();
if (files.length === 0) { console.error("no fixtures/ — run `npm run seed` first"); process.exit(1); }

/** The parts of a plan a replay must reproduce exactly. Cost, timing and cache metadata are excluded by design. */
function projection(p: Plan) {
  return {
    hash: p.hash, status: p.status, statusReason: p.statusReason, price: p.price, k: p.risk.k, scores: p.risk.scores,
    organicDailyUsd: p.organic.organicDailyUsd, today: p.today, days: p.days, truncated: p.truncated,
    tranches: p.tranches.map((t) => ({ date: t.date, tokens: t.tokens, usd: t.usd, red: t.red, reason: t.reason })),
    history: p.history.map((h) => ({ date: h.date, red: h.red, reason: h.reason })),
    dump: p.dumpToday, glide: p.glidepath, warnings: p.warnings,
  };
}

let ok = 0;
const failures: string[] = [];
for (const path of files) {
  const f = readFixture(path);
  const client = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
  const problems: string[] = [];
  let replay: Awaited<ReturnType<typeof glidepath>> | undefined;
  try { replay = await glidepath(client, f.input, { now: f.now }); }
  catch (e) { problems.push(`threw: ${(e as Error).message.slice(0, 120)}`); }
  if (replay) {
    if (replay.hash !== f.plan.hash) problems.push(`hash ${replay.hash.slice(0, 12)} ≠ recorded ${f.plan.hash.slice(0, 12)}`);
    if (JSON.stringify(projection(replay)) !== JSON.stringify(projection(f.plan))) problems.push("plan differs from the recorded plan");
    const network = replay.provenance.filter((c) => !c.cached);
    if (network.length) problems.push(`${network.length} call(s) left the cache: ${network.map((c) => `${c.endpoint}${c.ok ? "" : " (failed)"}`).join(", ")}`);
    if (replay.credits !== 0) problems.push(`${replay.credits} credits spent on a replay`);
    const recorded = new Set(f.plan.provenance.filter((c) => c.ok).map((c) => c.responseHash));
    for (const c of replay.provenance) if (c.ok && !recorded.has(c.responseHash)) problems.push(`${c.endpoint} served a response the live run never saw`);
  }
  const label = `${f.plan.resolved.symbol ?? f.input.token} ${f.input.chain} ${f.input.amount.toLocaleString("en-US")}`.padEnd(40);
  if (problems.length === 0) {
    ok++;
    const out = replay!.status === "ok" || replay!.status === "thin" ? `${replay!.days} tranches${replay!.today.red ? ", red today" : ""}` : replay!.status;
    console.log(`✔ ${label} ${replay!.hash.slice(0, 12)}  ${replay!.provenance.length} calls replayed · ${out} · recorded ${f.recordedAt.slice(0, 16)}Z · ${f.edge}`);
  } else {
    failures.push(path);
    console.log(`✖ ${label} ${problems.join("; ")}`);
  }
}
console.log(`\n${ok}/${files.length} plans reproduced offline`);
if (failures.length) process.exit(1);
