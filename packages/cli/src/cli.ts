#!/usr/bin/env -S npx tsx
import { writeFileSync } from "node:fs";
import { cachedClientFromEnv, glidepath, toICS, toCSV, type PlanResult } from "@glidepath/core";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const consumed = new Set(
  ["--chain", "--amount", "--csv", "--ics"].flatMap((n) => {
    const i = args.indexOf(n);
    return i >= 0 ? [i, i + 1] : [];
  }),
);
const positional = args.filter((a, i) => !a.startsWith("--") && !consumed.has(i));
const token = positional[0];
const chain = opt("--chain") ?? "ethereum";
const amount = Number(String(opt("--amount") ?? positional[1] ?? "").replace(/[,_\s]/g, ""));

if (!token || !(amount > 0) || flag("--help")) {
  console.log(`usage: glidepath <token-address-or-ticker> --chain <chain> --amount <tokens> [--json] [--explain] [--csv out.csv] [--ics out.ics] [--no-cache] [--no-quotes]
  Paste a token, a chain and the amount you hold → a dated selling calendar paced to organic demand (Nansen labels decide what is organic).
  Needs NANSEN_API_KEY:  set -a; source ~/.config/nansen/meridian.env; set +a`);
  process.exit(token && amount > 0 ? 0 : 1);
}

const client = cachedClientFromEnv({ ttlMs: flag("--no-cache") ? 0 : undefined });
const p: PlanResult = await glidepath(client, { chain, token, amount }, { quotes: !flag("--no-quotes") });

if (flag("--json")) {
  console.log(JSON.stringify(p, null, 2));
  process.exit(0);
}
const csvOut = opt("--csv"),
  icsOut = opt("--ics");
if (csvOut) writeFileSync(csvOut, toCSV(p));
if (icsOut) writeFileSync(icsOut, toICS(p));

const G = "\x1b[32m",
  R = "\x1b[31m",
  Y = "\x1b[33m",
  D = "\x1b[2m",
  B = "\x1b[1m",
  X = "\x1b[0m";
const usd = (v: number | null | undefined, d = 0) => (v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const tok = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toPrecision(4));
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const bar = (usdV: number, max: number) => "█".repeat(Math.max(1, Math.round((usdV / max) * 24)));

console.log(`\n${B}${p.resolved.symbol}${X} on ${p.input.chain} ${D}${p.resolved.address}${X}`);
if (p.status === "not-found") {
  console.log(`${R}${B}not found${X} — ${p.statusReason}`);
  for (const w of p.warnings) console.log(`${D}  ${w}${X}`);
} else {
  console.log(
    `price ${p.price.usd == null ? "—" : `$${p.price.usd.toPrecision(4)}`} ${D}(${p.price.source})${X} · liquidity ${usd(p.liquidityUsd)} · holders ${p.totalHolders?.toLocaleString("en-US") ?? "—"}`,
  );
  const o = p.organic;
  console.log(
    `organic buys ${B}${usd(o.organicDailyUsd)}/day${X} ${D}= (${usd(o.totalBuy7dUsd)} DEX buys 7d − ${usd(o.proBuy7dUsd)} by Smart Money/Fund/Whale/Exchange/bot users [${o.proBuyers ?? "?"} wallets]) / 7 · organic share ${pct(o.organicShare)} · ${o.organicBuyers ?? "?"} organic buyers${X}`,
  );
  console.log(
    `risk dial  k = ${B}${(p.risk.k * 100).toFixed(1)}%${X} ${D}(${Object.entries(p.risk.scores)
      .map(([k, v]) => `${k}=${v ?? "missing"}`)
      .join(", ")}${p.risk.concentrated ? ", concentrated buyers" : ""})${X}`,
  );
  const t = p.today;
  console.log(
    `today ${t.date}  ${t.red ? `${R}${B}RED${X} — ${t.reason}` : `${G}green${X}`} ${D}(Smart Money net ${usd(t.smNetUsd)}, exchange net ${usd(t.exNetUsd)}, θ_sm = ${usd(t.theta.smUsd)}, θ_ex = ${usd(t.theta.exUsd)})${X}`,
  );
  if (p.regime.red) console.log(`${R}7-day regime: ${p.regime.reason}${X} ${D}(pros have been net-selling all week; today's rule still decides each tranche)${X}`);
  if (p.history.length) {
    const strip = p.history.map((h) => (!h.complete ? `${D}·${X}` : h.red ? `${R}■${X}` : `${G}■${X}`)).join("");
    console.log(
      `last ${p.history.length} days ${strip}  ${p.redDays} red of ${p.completeDays} ${D}(${
        p.history
          .filter((h) => h.red)
          .map((h) => `${h.date.slice(5)} ${h.reason}`)
          .join("; ") || "no red days"
      })${X}`,
    );
  }
  console.log(
    `\n${B}Dump today:${X} ${usd(p.dumpToday.usd)} · est. cost ${R}${usd(p.dumpToday.costUsd, 2)}${X} ${D}(${p.dumpToday.model ?? "no model"}${p.dumpToday.priceImpactPct != null ? `, impact ${p.dumpToday.priceImpactPct}%` : ""})${X} · you would be ${B}${pct(p.dumpToday.shareOfOrganicDay, (p.dumpToday.shareOfOrganicDay ?? 1) < 0.01 ? 1 : 0)}${X} of a day's organic buys`,
  );
  if (p.status === "no-organic-demand" || p.status === "no-price") {
    console.log(`\n${Y}${B}no glidepath${X} — ${p.statusReason}`);
  } else {
    const max = Math.max(...p.tranches.map((x) => x.usd));
    console.log(
      `\n${B}Glidepath:${X} ${p.days} tranche${p.days === 1 ? "" : "s"} of ≤ ${usd(p.trancheUsd)} ${D}(${p.trancheCapReason === "liquidity" ? "capped at 1% of liquidity" : `${(p.risk.k * 100).toFixed(1)}% of organic/day`})${X} · est. cost ${G}${usd(p.glidepath.costUsd, 2)}${X} ${D}(${p.glidepath.model ?? "no impact model"})${X}${p.days === 1 ? ` ${D}· fits in one day — no split needed${X}` : ` · saves ${usd(p.savingsUsd, 2)}`}${p.redRate && p.days > 1 ? ` · expect ~${p.expectedDays} days at the ${pct(p.redRate, 0)} red-day rate` : ""}`,
    );
    const shown = p.tranches.slice(0, flag("--explain") ? p.tranches.length : 14);
    for (const x of shown)
      console.log(
        `  ${x.date}  ${x.red ? R : G}${bar(x.usd, max)}${X} ${tok(x.tokens).padStart(16)} ${p.resolved.symbol}  ${usd(x.usd).padStart(9)}${x.red ? `  ${R}red — ${x.reason}, halved${X}` : ""}`,
      );
    if (shown.length < p.tranches.length) console.log(`  ${D}… ${p.tranches.length - shown.length} more (--explain to list all)${X}`);
    if (p.truncated) console.log(`${Y}⚠ ${p.statusReason}${X}`);
  }
  for (const w of p.warnings) console.log(`${Y}⚠ ${w}${X}`);
  for (const [term, e] of Object.entries(p.errors)) console.log(`${R}✗ ${term}: ${e}${X}`);
}
if (csvOut) console.log(`${D}csv → ${csvOut}${X}`);
if (icsOut) console.log(`${D}ics → ${icsOut}${X}`);
const failed = p.provenance.filter((c) => !c.ok).length;
console.log(
  `\n${D}${p.credits} credits · ${p.calls} calls (${p.cachedCalls} cached${p.asOf ? `, computed ${Math.round((Date.now() - Date.parse(p.asOf)) / 1000)}s ago` : ""}${failed ? `, ${failed} failed` : ""}) · ${(p.ms / 1000).toFixed(1)}s · plan ${p.hash.slice(0, 12)}${client.creditsRemaining != null ? ` · balance ${client.creditsRemaining.toLocaleString("en-US")}` : ""}${X}`,
);
if (flag("--explain")) {
  const side = (c: (typeof p.provenance)[number]) => {
    const f = c.body.filters as { include_smart_money_labels?: unknown; exclude_smart_money_labels?: unknown } | undefined;
    return f?.include_smart_money_labels
      ? " (pros)"
      : f?.exclude_smart_money_labels
        ? " (organic)"
        : c.body.timeframe
          ? ` ${String(c.body.timeframe)}`
          : c.body.label
            ? ` ${String(c.body.label)}`
            : "";
  };
  for (const c of p.provenance)
    console.log(
      `${D}  ${c.ok ? (c.cached ? "cache" : " live") : " FAIL"} ${c.method} ${(c.endpoint + side(c)).padEnd(32)} ${String(c.credits).padStart(2)} cr ${String(c.ms).padStart(5)} ms  ${c.fieldsUsed.slice(0, 3).join(", ")}${c.error ? `  ${c.error}` : ""}${X}`,
    );
}
