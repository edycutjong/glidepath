/**
 * Day-one spike (LIVE): for 8 tokens, page tgm/who-bought-sold BUY 7d three ways — no filter, exclude pro labels,
 * include pro labels — and record pages, latency, organic share, and whether the filters behave as documented.
 * Also probes trade/quote on solana/base once to learn the response shape and its credit cost.
 *
 *   set -a; source ~/.config/nansen/meridian.env; set +a; npm run spike
 */
import { clientFromEnv, whoBoughtPaged, EXCLUDED_LABELS, quote, USDC, tokenInformation } from "../packages/core/src/index";

const TOKENS: Array<{ symbol: string; chain: string; address: string; note: string }> = [
  { symbol: "PEPE", chain: "ethereum", address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", note: "hero, large cap" },
  { symbol: "SHIB", chain: "ethereum", address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", note: "large cap, no quote chain" },
  { symbol: "MOG", chain: "ethereum", address: "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a", note: "mid cap meme" },
  { symbol: "BONK", chain: "solana", address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", note: "solana, quote route" },
  { symbol: "WIF", chain: "solana", address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", note: "solana, bot-heavy?" },
  { symbol: "BRETT", chain: "base", address: "0x532f27101965dd16442e59d40670faf5ebb142e4", note: "base, quote route" },
  { symbol: "DEGEN", chain: "base", address: "0x4ed4e862860bed51a9570b96d89af5e1b0efefed", note: "base mid cap" },
  { symbol: "TURBO", chain: "ethereum", address: "0xa35923162c49cf95e6bf26623385eb431ad920d3", note: "smaller eth meme" },
];

const client = clientFromEnv({ timeoutMs: 15000 });
const now = Date.now();
const t = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
console.log(`| token | chain | all: rows/pages/ms | excl: rows/pages/ms | incl: rows/pages/ms | Σall | Σexcl | Σincl | organic share | excl+incl=all? | labels seen on excluded rows |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|`);
for (const tk of TOKENS) {
  const before = client.calls.length;
  const run = async (filter: Parameters<typeof whoBoughtPaged>[4]) => {
    const t0 = Date.now();
    try {
      const r = await whoBoughtPaged(client, tk.chain, tk.address, now, filter, 20);
      return { ...r, ms: Date.now() - t0, err: "" };
    } catch (e) {
      return { rows: [], pages: 0, truncated: false, ms: Date.now() - t0, err: (e as Error).message.slice(0, 80) };
    }
  };
  const all = await run({});
  const excl = await run({ exclude: EXCLUDED_LABELS });
  const incl = await run({ include: EXCLUDED_LABELS });
  const sum = (rows: { bought_volume_usd?: number | null }[]) => rows.reduce((n, r) => n + (r.bought_volume_usd ?? 0), 0);
  const sAll = sum(all.rows),
    sEx = sum(excl.rows),
    sIn = sum(incl.rows);
  const exclSet = new Set(excl.rows.map((r) => r.address));
  const removed = all.rows.filter((r) => !exclSet.has(r.address));
  const labels = [...new Set(removed.map((r) => r.address_label || "∅"))].slice(0, 6).join(", ");
  const consistent = all.rows.length === excl.rows.length + incl.rows.length ? "yes" : `no (${all.rows.length} vs ${excl.rows.length}+${incl.rows.length})`;
  const share = sAll > 0 ? `${((sEx / sAll) * 100).toFixed(1)}%` : "n/a";
  const cell = (r: typeof all) => (r.err ? `ERR ${r.err}` : `${r.rows.length}/${r.pages}${r.truncated ? "+" : ""}/${t(r.ms)}`);
  console.log(`| ${tk.symbol} | ${tk.chain} | ${cell(all)} | ${cell(excl)} | ${cell(incl)} | ${usd(sAll)} | ${usd(sEx)} | ${usd(sIn)} | ${share} | ${consistent} | ${labels || "—"} |`);
  const credits = client.calls.slice(before).reduce((n, c) => n + c.credits, 0);
  console.error(`  ${tk.symbol}: ${client.calls.length - before} calls, ${credits} credits (${tk.note})`);
}

// trade/quote probe: learn the response shape + credit cost. Sell $5 USDC → BONK, then BONK → USDC.
console.log(`\n## trade/quote probe`);
for (const chain of ["solana", "base"] as const) {
  const tk = TOKENS.find((x) => x.chain === chain)!;
  try {
    const t0 = Date.now();
    const q1 = await quote(client, chain, USDC[chain], tk.address, "5000000");
    const last = client.calls[client.calls.length - 1];
    console.log(`${chain} USDC→${tk.symbol} $5: HTTP ${last.status} ${t(Date.now() - t0)} credits=${last.credits} keys=${Object.keys(q1).join(",")} quotes=${q1.quotes?.length}`);
    console.log(JSON.stringify(q1.quotes?.[0] ?? q1).slice(0, 1200));
  } catch (e) {
    console.log(`${chain} quote failed: ${(e as Error).message.slice(0, 300)}`);
  }
}
// token-information cross-check for PEPE: buy_volume_usd (all venues) vs who-bought-sold Σ
const info = await tokenInformation(client, "ethereum", TOKENS[0].address, "7d");
console.log(
  `\nPEPE token-information 7d buy_volume_usd=${usd(info.data.spot_metrics?.buy_volume_usd ?? 0)} unique_buyers=${info.data.spot_metrics?.unique_buyers} liquidity=${usd(info.data.spot_metrics?.liquidity_usd ?? 0)}`,
);
console.log(`\ncalls: ${client.calls.length} · credits: ${client.creditsSpent} · remaining: ${client.creditsRemaining} · failed: ${client.calls.filter((c) => !c.ok).length}`);
