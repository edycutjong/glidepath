import { describe, it, expect, vi, afterEach } from "vitest";
import { NansenClient, clientFromEnv } from "../src/client";
import { KEY } from "./helpers";

describe("NansenClient — remaining coverage gaps", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("RateLimiter makes a second call wait once the rolling-second burst cap (rps) is hit", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const c = new NansenClient(KEY, { fetchImpl, rps: 1 });

    const first = c.post("a", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    // Second call arrives inside the same rolling second: limiter must wait (~1s) before it fires.
    const second = c.post("b", {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // still waiting
    await vi.advanceTimersByTimeAsync(1010);

    await Promise.all([first, second]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the static credit table when a credits header is present but not a finite number", async () => {
    const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200, headers: { "x-nansen-credits-used": "not-a-number", "x-nansen-credits-remaining": "also-bad" } });
    const c = new NansenClient(KEY, { fetchImpl });
    await c.post("tgm/indicators", {});
    expect(c.calls[0].credits).toBe(5); // static table, since the header didn't parse to a finite number
    expect(c.calls[0].creditsRemaining).toBeUndefined();
  });

  it("uses the global fetch when no fetchImpl is supplied", async () => {
    const stub = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal("fetch", stub);
    const c = new NansenClient(KEY); // no opts.fetchImpl → constructor falls back to the ambient `fetch`
    const out = await c.post("search/general", {});
    expect(out).toEqual({ ok: true });
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("a thrown non-Error value is recorded as a failed call via String(e), with attempts defaulted to 1", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw "network down";
    };
    const c = new NansenClient(KEY, { fetchImpl });
    await expect(c.post("tgm/flows", {})).rejects.toBe("network down");
    expect(c.calls[0]).toMatchObject({ ok: false, status: 0, error: "network down", attempts: 1, credits: 0 });
  });

  it("retries a 429 with the 750ms floor when the server sends no retry-after header", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async () => (n++ === 0 ? new Response("slow down", { status: 429 }) : new Response('{"ok":true}', { status: 200 }));
    const c = new NansenClient(KEY, { fetchImpl });
    const out = await c.post("tgm/flows", {});
    expect(out).toEqual({ ok: true });
    expect(n).toBe(2);
    expect(c.calls[0]).toMatchObject({ ok: true, attempts: 2 });
  });

  it("a timeout on a non-final attempt is retried instead of thrown", async () => {
    let n = 0;
    const fetchImpl: typeof fetch = async (_u, init) => {
      n++;
      if (n === 1) {
        return new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
      }
      return new Response('{"ok":true}', { status: 200 });
    };
    const c = new NansenClient(KEY, { fetchImpl, timeoutMs: 20 });
    const out = await c.post("tgm/flows", {});
    expect(out).toEqual({ ok: true });
    expect(n).toBe(2);
    expect(c.calls).toHaveLength(1);
    expect(c.calls[0]).toMatchObject({ ok: true, attempts: 2 });
  });

  it("creditsRemaining is undefined before any call has reported a balance", () => {
    const fetchImpl: typeof fetch = async () => new Response("{}", { status: 200 });
    const c = new NansenClient(KEY, { fetchImpl });
    expect(c.creditsRemaining).toBeUndefined();
  });

  it("clientFromEnv builds a client from NANSEN_API_KEY", () => {
    const prev = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    try {
      expect(clientFromEnv()).toBeInstanceOf(NansenClient);
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });

  it("clientFromEnv throws when NANSEN_API_KEY is unset", () => {
    const prev = process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_API_KEY;
    try {
      expect(() => clientFromEnv()).toThrow(/NANSEN_API_KEY/);
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });
});
