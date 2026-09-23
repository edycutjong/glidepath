import { describe, it, expect } from "vitest";
import { NansenClient, NansenError } from "../src/client";
import { fakeClient, KEY } from "./helpers";

describe("NansenClient", () => {
  it("rejects a missing or malformed key", () => {
    expect(() => new NansenClient("")).toThrow(/NANSEN_API_KEY/);
    expect(() => new NansenClient("abc")).toThrow(/nsn_/);
  });
  it("sends the apikey header and records header-reported credits, balance, status and a sha256 of the raw body", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl: typeof fetch = async (_u, init) => {
      headers = init!.headers as Record<string, string>;
      return new Response('{"data":[]}', { status: 200, headers: { "x-nansen-credits-used": "5", "x-nansen-credits-remaining": "61000" } });
    };
    const c = new NansenClient(KEY, { fetchImpl });
    await c.post("tgm/indicators", { chain: "ethereum", token_address: "0x1" }, ["risk_indicators[].score"]);
    expect(headers.apikey).toBe(KEY);
    expect(c.calls[0]).toMatchObject({ endpoint: "tgm/indicators", method: "POST", credits: 5, creditsRemaining: 61000, status: 200, cached: false, fieldsUsed: ["risk_indicators[].score"] });
    expect(c.calls[0].responseHash).toHaveLength(64);
    expect(c.creditsSpent).toBe(5);
    expect(c.creditsRemaining).toBe(61000);
  });
  it("creditsRemaining is the LAST balance any call reported — a later call without the header does not erase it", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200, headers: n++ === 0 ? { "x-nansen-credits-remaining": "500" } : {} });
    const c = new NansenClient(KEY, { fetchImpl });
    await c.post("search/general", {});
    await c.post("search/general", { q: 2 });
    expect(c.calls[1].creditsRemaining).toBeUndefined();
    expect(c.creditsRemaining).toBe(500);
  });
  it("falls back to the static credit table when the header is absent", async () => {
    const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
    const c = new NansenClient(KEY, { fetchImpl });
    await c.post("tgm/indicators", {});
    await c.post("search/general", {});
    await c.post("some/unknown", {});
    expect(c.calls.map((x) => x.credits)).toEqual([5, 0, 1]);
  });
  it("GET builds a query string from the body and records method GET", async () => {
    let seen = "";
    const fetchImpl: typeof fetch = async (u) => {
      seen = String(u);
      return new Response('{"quotes":[]}', { status: 200 });
    };
    const c = new NansenClient(KEY, { fetchImpl });
    await c.get("trade/quote", { chain: "solana", amount: "5000000", slippage: 50, skip: undefined });
    expect(seen).toBe("https://api.nansen.ai/api/v1/trade/quote?chain=solana&amount=5000000&slippage=50");
    expect(c.calls[0].method).toBe("GET");
  });
  it("retries once on 429 then succeeds; only the successful attempt is recorded, attempts=2", async () => {
    let n = 0;
    const c = fakeClient(() => (n++ === 0 ? new Response("slow down", { status: 429, headers: { "retry-after": "0" } }) : { ok: true }));
    const out = await c.post("tgm/flow-intelligence", {});
    expect(out).toEqual({ ok: true });
    expect(n).toBe(2);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0].attempts).toBe(2);
    expect(c.calls[0].totalMs).toBeGreaterThanOrEqual(700);
  });
  it("throws NansenError with status on 4xx without retry and records the failure at 0 credits", async () => {
    let n = 0;
    const c = fakeClient(() => {
      n++;
      return new Response('{"error":"Missing field"}', { status: 422 });
    });
    await expect(c.post("tgm/token-information", {})).rejects.toThrow(/HTTP 422/);
    expect(n).toBe(1);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 422, credits: 0, attempts: 1 });
    expect(c.calls[0].error).toMatch(/HTTP 422/);
  });
  it("a JSON error body surfaces its `message` as a sentence, not the envelope", () => {
    const e = new NansenError(
      "tgm/flows",
      422,
      JSON.stringify({ error: "Unprocessable Entity", message: "Token 0xdac1 on ethereum is a stablecoin. The TGM flows endpoint does not support stablecoins." }),
    );
    expect(e.message).toBe("Nansen tgm/flows → HTTP 422: Token 0xdac1 on ethereum is a stablecoin. The TGM flows endpoint does not support stablecoins.");
    expect(new NansenError("x", 500, "<html>gateway</html>").message).toBe("Nansen x → HTTP 500: <html>gateway</html>");
  });
  it("honours retries: 0 — a 503 is not retried", async () => {
    let n = 0;
    const c = fakeClient(() => {
      n++;
      return new Response("boom", { status: 503 });
    });
    await expect(c.post("tgm/who-bought-sold", {}, [], { retries: 0 })).rejects.toThrow(/HTTP 503/);
    expect(n).toBe(1);
    expect(c.calls[0]).toMatchObject({ ok: false, attempts: 1 });
  });
  it("a timeout is recorded as 'timeout' with the attempt count", async () => {
    const fetchImpl: typeof fetch = async (_u, init) => new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const c = new NansenClient(KEY, { fetchImpl, timeoutMs: 20 });
    await expect(c.post("tgm/flows", {}, [], { retries: 0 })).rejects.toThrow();
    expect(c.calls[0]).toMatchObject({ ok: false, error: "timeout", attempts: 1, credits: 0 });
  });
  it("regression (audit 2026-09-23): a 200 that is not JSON is ONE failed call, not a success followed by a failure", async () => {
    const c = fakeClient(() => new Response("<html>gateway</html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(c.post("tgm/flows", {})).rejects.toThrow(/HTTP 200: response body was not JSON/);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ ok: false, status: 200, credits: 0, attempts: 1 });
  });
  it("regression (audit 2026-09-23): a socket error before any HTTP status is retried once, like a timeout", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return new Response('{"data":[]}', { status: 200 });
    };
    const c = new NansenClient(KEY, { fetchImpl });
    await expect(c.post("tgm/flows", {})).resolves.toEqual({ data: [] });
    expect(n).toBe(2);
    expect(c.calls[0]).toMatchObject({ ok: true, attempts: 2 });
  });
});
