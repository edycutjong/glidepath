/**
 * `apps/web/lib/server.ts` only wires the CachedNansenClient together — the two branches worth pinning are
 * (a) VERCEL vs. local cache directory, and (b) an unset NANSEN_API_KEY falling back to "". Neither `planFor`
 * nor `makeClient` (unexported) is exercised by apps/web/test/api-boundary.test.ts, which only reaches the
 * validation branches of the route handler. These tests call `planFor` directly with `fetch` replaced by a
 * stub that fails every call: `fetchFacts` catches per-endpoint failures into `Facts.errors` (see
 * packages/core/src/facts.ts), so a failing network never throws — it lets us exercise the full
 * makeClient → glidepath wiring without a real key or any network access.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planFor, parseInput } from "../lib/server";

// Address-shaped so resolveToken short-circuits (looksLikeAddress) and never calls search/general either.
const PEPE = "0x6982508145454ce325ddbe47a25d4ec3d2311933";

describe("makeClient wiring (VERCEL cache dir + NANSEN_API_KEY fallback)", () => {
  let realFetch: typeof fetch;
  let realKey: string | undefined;
  let realVercel: string | undefined;
  let scratchDir: string;
  let realCwd: () => string;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realKey = process.env.NANSEN_API_KEY;
    realVercel = process.env.VERCEL;
    // Every call fails; fetchFacts settles each into Facts.errors rather than throwing, so planFor still resolves.
    globalThis.fetch = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    scratchDir = mkdtempSync(join(tmpdir(), "glidepath-server-coverage-"));
    realCwd = process.cwd;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
    if (realVercel == null) delete process.env.VERCEL;
    else process.env.VERCEL = realVercel;
    process.cwd = realCwd;
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("VERCEL set: caches under tmpdir()/glidepath-cache and NANSEN_API_KEY reads through as-is", async () => {
    process.env.VERCEL = "1";
    process.env.NANSEN_API_KEY = "nsn_coverage_key_000000000000000000";
    const result = await planFor({ chain: "ethereum", token: PEPE, amount: 1_000_000 });
    expect(result.input.token).toBe(PEPE);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("VERCEL unset: caches under process.cwd()/.cache; a missing key falls back to '' and NansenClient rejects on it", async () => {
    delete process.env.VERCEL;
    delete process.env.NANSEN_API_KEY;
    process.cwd = () => scratchDir; // keep the DiskCache mkdir out of the real repo tree
    // makeClient's `?? ""` branch still runs (NansenClient itself is what rejects an empty/malformed key) —
    // the point of this case is the VERCEL-falsy branch of the cache-dir ternary, not a successful plan.
    await expect(planFor({ chain: "ethereum", token: PEPE, amount: 1_000_000 })).rejects.toThrow(/NANSEN_API_KEY missing or malformed/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe("parseInput", () => {
  it("blank chain (whitespace only) is rejected the same as a missing one", () => {
    expect(parseInput("   ", "PEPE", "1")).toEqual({ error: "chain is required" });
  });

  it("blank token (whitespace only) is rejected the same as a missing one", () => {
    expect(parseInput("ethereum", "   ", "1")).toEqual({ error: "token is required (address or ticker)" });
  });

  it("null chain/token (the route's literal default before String()) is rejected as missing", () => {
    expect(parseInput(null, null, "1")).toEqual({ error: "token is required (address or ticker)" });
    expect(parseInput("ethereum", null, "1")).toEqual({ error: "token is required (address or ticker)" });
  });

  it("null amount defaults to '' and is rejected as not a positive number", () => {
    expect(parseInput("ethereum", "PEPE", null)).toEqual({ error: "amount must be a positive number of tokens" });
  });

  it("NaN amount ('') is rejected as not a positive number", () => {
    expect(parseInput("ethereum", "PEPE", "")).toEqual({ error: "amount must be a positive number of tokens" });
  });

  it("accepts a well-formed request and lower-cases the chain", () => {
    expect(parseInput("Ethereum", "PEPE", "42")).toEqual({ chain: "ethereum", token: "PEPE", amount: 42 });
  });
});
