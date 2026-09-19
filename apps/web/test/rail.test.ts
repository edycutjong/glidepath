/**
 * The call rail's pure helpers: the one-line param summary (distinguishing part first, never a key or a body) and
 * the rows built from a finished plan's provenance — the same Call objects the drawer prints.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import type { PlanResult } from "@glidepath/core";
import { summarize, rowsFromPlan, rowFromCall } from "../components/Rail";

const pepe = JSON.parse(readFileSync(new URL("../../../fixtures/0X6982508145--ETHEREUM.json", import.meta.url), "utf8")).plan as PlanResult;

describe("summarize", () => {
  it("puts the cohort / timeframe first, then token · chain", () => {
    expect(summarize({ chain: "ethereum", token_address: "0xabc", timeframe: "7d" }, "PEPE")).toBe("7d · PEPE · ethereum");
    expect(summarize({ chain: "ethereum", token_address: "0xabc", buy_or_sell: "BUY", filters: { include_smart_money_labels: ["Fund"] } }, "PEPE")).toBe("pros · buy 7d · PEPE · ethereum");
    expect(summarize({ chain: "ethereum", buy_or_sell: "BUY", filters: { exclude_smart_money_labels: ["Fund"] }, pagination: { page: 2 } }, "PEPE")).toBe(
      "organic · buy 7d · page 2 · PEPE · ethereum",
    );
    expect(summarize({ chain: "solana", label: "smart_money", date: { from: "2026-09-02T00:00:00Z", to: "2026-09-16T14:00:00Z" } }, "BONK")).toBe("smart money · 14d · BONK · solana");
    expect(summarize({ search_query: "PEPE", result_type: "token", chain: "ethereum" }, "PEPE")).toBe("“PEPE” · PEPE · ethereum");
  });
  it("shortens a raw address when no term is known and names a route quote", () => {
    expect(summarize({ chain: "base", token_address: "0x532f27101965dd16442e59d40670faf5ebb142e4" }, "")).toBe("0x532f…42e4 · base");
    expect(summarize({ chain: "solana", from_token: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", to_token: "So111", amount: "5000000" }, "BONK")).toBe("route · DezXAZ…B263 · BONK · solana");
  });
  it("never echoes anything that could be a key", () => {
    const s = summarize({ chain: "ethereum", apikey: "nsn_should_never_appear_0000000000", token_address: "0x1" }, "X");
    expect(s).not.toMatch(/nsn_/);
  });
});

describe("rowsFromPlan / rowFromCall", () => {
  it("makes one row per provenance call, replayed rows at 0 credits, keyed in order", () => {
    const rows = rowsFromPlan(pepe, "example", true);
    expect(rows).toHaveLength(pepe.provenance.length);
    expect(rows.map((r) => r.key)).toEqual(pepe.provenance.map((_, i) => `example-${i}`));
    expect(rows.every((r) => r.state === "replayed" && r.credits === 0)).toBe(true);
    expect(rows.map((r) => r.endpoint)).toEqual(pepe.provenance.map((c) => c.endpoint));
    expect(rows.map((r) => r.hash)).toEqual(pepe.provenance.map((c) => c.responseHash));
  });
  it("a shared (server-side) plan keeps the real states and credits, so totals equal the drawer's", () => {
    const rows = rowsFromPlan(pepe, "shared", false);
    expect(rows.reduce((n, r) => n + r.credits, 0)).toBe(pepe.credits);
    expect(rows.filter((r) => r.state === "cached")).toHaveLength(pepe.cachedCalls);
  });
  it("maps ok/cached/error to the dot states", () => {
    const c = pepe.provenance[0];
    expect(rowFromCall({ ...c, ok: true, cached: false }, "k", "PEPE", false).state).toBe("live");
    expect(rowFromCall({ ...c, ok: true, cached: true }, "k", "PEPE", false)).toMatchObject({ state: "cached", ms: 0 });
    expect(rowFromCall({ ...c, ok: false, cached: false, credits: 0, status: 422, error: "nope", totalMs: 900 }, "k", "PEPE", false)).toMatchObject({
      state: "error",
      credits: 0,
      totalMs: 900,
      error: "nope",
    });
  });
});
