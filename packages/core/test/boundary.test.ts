/**
 * Permission boundary, engine side: the API key goes into one request header and nowhere else. The plan JSON the web
 * app returns, the provenance drawer, the ICS and CSV exports and every error message are key-free — checked by
 * running the real engine against a fake Nansen that receives the key in the header and echoes it back in a body.
 */
import { describe, it, expect } from "vitest";
import { glidepath } from "../src/glidepath";
import { toICS, toCSV } from "../src/export";
import { NansenClient } from "../src/client";
import { fakeCachedClient, fakeFetch, pepeRoutes, KEY, PEPE, NOW } from "./helpers";

describe("the Nansen key never leaves the request header", () => {
  it("a full plan serialised to JSON, its provenance, and the ICS/CSV exports contain no nsn_ key", async () => {
    const c = fakeCachedClient(pepeRoutes);
    const p = await glidepath(c, { chain: "ethereum", token: PEPE, amount: 12_000_000_000 }, { now: NOW });
    expect(p.status).toBe("ok");
    const json = JSON.stringify(p);
    expect(json).not.toContain(KEY);
    expect(json).not.toMatch(/nsn_[A-Za-z0-9_]{8,}/);
    expect(p.provenance.length).toBeGreaterThan(0);
    for (const call of p.provenance) expect(Object.keys(call)).not.toContain("headers");
    expect(toICS(p)).not.toMatch(/nsn_/);
    expect(toCSV(p)).not.toMatch(/nsn_/);
  });

  it("regression (boundary test, 2026-09-17): an upstream error body that echoes the key back is redacted before it reaches plan.errors — that JSON goes to the browser", async () => {
    const seen: string[] = [];
    const routes = (endpoint: string, body: Record<string, unknown>) => {
      if (endpoint === "tgm/indicators") return new Response(JSON.stringify({ message: `unauthorized: bad key ${KEY}` }), { status: 401 });
      return pepeRoutes(endpoint, body);
    };
    const fetchImpl: typeof fetch = async (url, init) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      seen.push(h.apikey ?? "");
      return fakeFetch(routes)(url, init);
    };
    const c = new NansenClient(KEY, { fetchImpl, rps: 1000 });
    const p = await glidepath(c, { chain: "ethereum", token: PEPE, amount: 1e9 }, { now: NOW });
    expect(seen.every((k) => k === KEY)).toBe(true); // the key did travel — in the header, on every call
    expect(p.errors.indicators).toMatch(/HTTP 401: unauthorized: bad key nsn_\[redacted\]/);
    expect(JSON.stringify({ errors: p.errors, warnings: p.warnings, provenance: p.provenance })).not.toContain(KEY);
  });

  it("the client refuses to start without a well-formed key, so a missing env var can never become an unauthenticated request", () => {
    expect(() => new NansenClient("", { rps: 1000 })).toThrow(/NANSEN_API_KEY missing or malformed/);
    expect(() => new NansenClient("sk-not-a-nansen-key", { rps: 1000 })).toThrow(/expected nsn_/);
  });
});
