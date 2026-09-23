/**
 * Permission boundary — the server-side Nansen key never reaches a client, and malformed input is rejected before
 * any network call. These run against the real route handler with `fetch` replaced by a spy, so a regression that
 * moved validation behind the key check, or leaked the key into a response, fails here and in CI (no key needed).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../app/api/plan/route";
import { parseInput } from "../lib/server";

const KEY = "nsn_boundary_test_key_000000000000000000";
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("input validation happens before the key check and before any network call", () => {
  const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
  let realFetch: typeof fetch;
  let realKey: string | undefined;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    realKey = process.env.NANSEN_API_KEY;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    fetchSpy.mockClear();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
  });

  it.each([
    ["missing token", { chain: "ethereum", amount: "1" }, /token is required/],
    ["missing chain", { token: "PEPE", amount: "1" }, /chain is required/],
    ["negative amount", { chain: "ethereum", token: "PEPE", amount: "-5" }, /positive number/],
    ["zero amount", { chain: "ethereum", token: "PEPE", amount: "0" }, /positive number/],
    ["non-numeric amount", { chain: "ethereum", token: "PEPE", amount: "lots" }, /positive number/],
    ["Infinity", { chain: "ethereum", token: "PEPE", amount: "Infinity" }, /positive number/],
    ["not JSON", "{not json", /body must be JSON/],
  ])("%s → 400 with no key set and zero fetches", async (_name, body, msg) => {
    delete process.env.NANSEN_API_KEY;
    const res = await post(body);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(msg);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the same malformed query is still a 400 (not a 502) when a key IS set — validation is not the network's job", async () => {
    process.env.NANSEN_API_KEY = KEY;
    const res = await post({ chain: "ethereum", token: "PEPE", amount: "-1" });
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a well-formed query with no server key is a 500 that names the missing variable, never the key, and never touches the network", async () => {
    delete process.env.NANSEN_API_KEY;
    const res = await post({ chain: "ethereum", token: "PEPE", amount: "1" });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toMatch(/NANSEN_API_KEY is not set/);
    expect(text).not.toMatch(/nsn_/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parseInput accepts comma / underscore / space thousands separators and lower-cases the chain", () => {
    expect(parseInput(" Ethereum ", " PEPE ", "12,000,000,000")).toEqual({ chain: "ethereum", token: "PEPE", amount: 12_000_000_000 });
    expect(parseInput("solana", "BONK", "20_000 000")).toEqual({ chain: "solana", token: "BONK", amount: 20_000_000 });
    // audit 2026-09-23: an unbounded token string reached search/general and the fixture/file names
    expect(parseInput("solana", "x".repeat(128), "1")).toEqual({ chain: "solana", token: "x".repeat(128), amount: 1 });
    expect(parseInput("solana", "x".repeat(129), "1")).toEqual({ error: "token is too long — an address or a ticker, at most 128 characters" });
  });
});
