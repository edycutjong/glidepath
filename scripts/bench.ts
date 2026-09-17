/**
 * Benchmark: cold (fresh cache, live Nansen) vs warm (same cache, second call) latency, credits per plan and calls per
 * plan over a fixed token set, R runs each. Prints p50/p95 and a markdown table for DEMO.md.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run bench            # 3 runs (~270 credits)
 *   npm run bench -- --runs 1
 */
import { CachedNansenClient, MemoryCache, glidepath, type PlanInput } from "../packages/core/src/index";

const SET: Array<PlanInput & { name: string }> = [
  { name: "PEPE/ethereum", chain: "ethereum", token: "0x6982508145454ce325ddbe47a25d4ec3d2311933", amount: 12_000_000_000 },
  { name: "BONK/solana", chain: "solana", token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", amount: 20_000_000_000 },
  { name: "BRETT/base", chain: "base", token: "0x532f27101965dd16442e59d40670faf5ebb142e4", amount: 3_000_000 },
  { name: "SHIB/ethereum", chain: "ethereum", token: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", amount: 2_000_000_000 },
  { name: "DEGEN/base", chain: "base", token: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", amount: 5_000_000 },
  { name: "TURBO/ethereum", chain: "ethereum", token: "0xa35923162c49cf95e6bf26623385eb431ad920d3", amount: 50_000_000 },
  { name: "USDC/ethereum", chain: "ethereum", token: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", amount: 50_000 },
];
const runsIdx = process.argv.indexOf("--runs");
const RUNS = runsIdx >= 0 ? Number(process.argv[runsIdx + 1]) : 3;
const apiKey = process.env.NANSEN_API_KEY ?? "";
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

type Row = { name: string; run: number; coldMs: number; warmMs: number; credits: number; calls: number; pages: number; failed: number; hashStable: boolean };
const rows: Row[] = [];
for (let run = 1; run <= RUNS; run++) {
  for (const t of SET) {
    const store = new MemoryCache();
    const client = new CachedNansenClient(apiKey, { store });
    const now = Date.now();
    const cold = await glidepath(client, t, { now });
    const warm = await glidepath(client, t, { now });
    rows.push({
      name: t.name,
      run,
      coldMs: cold.ms,
      warmMs: warm.ms,
      credits: cold.credits,
      calls: cold.calls,
      pages: cold.provenance.filter((c) => c.endpoint === "tgm/who-bought-sold").length,
      failed: cold.provenance.filter((c) => !c.ok).length,
      hashStable: cold.hash === warm.hash,
    });
    console.error(
      `run ${run} ${t.name.padEnd(16)} cold ${(cold.ms / 1000).toFixed(1)}s warm ${warm.ms}ms · ${cold.credits} cr · ${cold.calls} calls${
        cold.provenance.some((c) => !c.ok)
          ? " · FAILED: " +
            cold.provenance
              .filter((c) => !c.ok)
              .map((c) => c.endpoint)
              .join(",")
          : ""
      }`,
    );
  }
}
const cold = rows.map((r) => r.coldMs),
  warm = rows.map((r) => r.warmMs);
console.log(`## Bench — ${SET.length} tokens × ${RUNS} runs, ${new Date().toISOString().slice(0, 16)}Z\n`);
console.log(`| metric | cold (fresh cache, live Nansen) | warm (second call, same cache) |\n|---|---|---|`);
console.log(`| p50 latency | ${(pct(cold, 50) / 1000).toFixed(2)} s | ${pct(warm, 50)} ms |`);
console.log(`| p95 latency | ${(pct(cold, 95) / 1000).toFixed(2)} s | ${pct(warm, 95)} ms |`);
console.log(
  `| credits / plan | ${(rows.reduce((n, r) => n + r.credits, 0) / rows.length).toFixed(1)} (min ${Math.min(...rows.map((r) => r.credits))}, max ${Math.max(...rows.map((r) => r.credits))}) | 0 |`,
);
console.log(`| calls / plan | ${(rows.reduce((n, r) => n + r.calls, 0) / rows.length).toFixed(1)} | same, all cached |`);
console.log(`| who-bought-sold pages / plan | ${(rows.reduce((n, r) => n + r.pages, 0) / rows.length).toFixed(1)} | — |`);
console.log(`| failed calls | ${rows.reduce((n, r) => n + r.failed, 0)} of ${rows.reduce((n, r) => n + r.calls, 0)} | — |`);
console.log(`| hash cold == warm | ${rows.filter((r) => r.hashStable).length}/${rows.length} | — |`);
console.log(`\n| token | cold p50 | cold max | warm p50 | credits | calls |\n|---|---|---|---|---|---|`);
for (const t of SET) {
  const rs = rows.filter((r) => r.name === t.name);
  console.log(
    `| ${t.name} | ${(
      pct(
        rs.map((r) => r.coldMs),
        50,
      ) / 1000
    ).toFixed(1)} s | ${(Math.max(...rs.map((r) => r.coldMs)) / 1000).toFixed(1)} s | ${pct(
      rs.map((r) => r.warmMs),
      50,
    )} ms | ${rs[0].credits} | ${rs[0].calls} |`,
  );
}
console.log(`\ntotal credits this bench: ${rows.reduce((n, r) => n + r.credits, 0)}`);
