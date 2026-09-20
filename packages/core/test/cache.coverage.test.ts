import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache, MemoryCache, LayeredCache, cacheKey, cachedClientFromEnv, CachedNansenClient } from "../src/cache";
import { fakeFetch, KEY } from "./helpers";

// A footgun fix: a real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — every
// CachedNansenClient built below is meant to hit its fake network, so the ambient env is neutralized for the
// duration of each test and restored after (cachedClientFromEnv reads it directly, and would otherwise flip
// every client in this file into offline mode).
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

const ENTRY = { storedAt: "2026-01-01T00:00:00Z", ttlMs: 1, endpoint: "tgm/flows", body: { a: 1 }, text: '{"ok":true}' };

describe("DiskCache", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function tmpDir() {
    const d = mkdtempSync(join(tmpdir(), "glidepath-cache-"));
    dirs.push(d);
    return d;
  }

  it("round-trips a set entry to disk as JSON at <dir>/<key>.json", () => {
    const dir = tmpDir();
    const store = new DiskCache(dir);
    store.set("k1", ENTRY);
    expect(existsSync(join(dir, "k1.json"))).toBe(true);
    expect(store.get("k1")).toEqual(ENTRY);
  });

  it("get() returns undefined when the file does not exist", () => {
    const store = new DiskCache(tmpDir());
    expect(store.get("missing")).toBeUndefined();
  });

  it("get() returns undefined and swallows the error when the file holds invalid JSON", () => {
    const dir = tmpDir();
    writeFileSync(join(dir, "bad.json"), "{ not json", "utf8");
    const store = new DiskCache(dir);
    expect(store.get("bad")).toBeUndefined();
  });

  it("constructor swallows a read-only-FS mkdirSync failure instead of throwing", () => {
    const parent = tmpDir();
    const fileNotDir = join(parent, "im-a-file");
    writeFileSync(fileNotDir, "x", "utf8");
    // mkdirSync({recursive:true}) under a path whose parent segment is a plain file throws ENOTDIR.
    expect(() => new DiskCache(join(fileNotDir, "sub"))).not.toThrow();
  });

  it("set() swallows a write failure instead of throwing (dir could not be created)", () => {
    const parent = tmpDir();
    const fileNotDir = join(parent, "im-a-file-2");
    writeFileSync(fileNotDir, "x", "utf8");
    const store = new DiskCache(join(fileNotDir, "sub"));
    expect(() => store.set("k", ENTRY)).not.toThrow();
    expect(store.get("k")).toBeUndefined();
  });

  it("default dir is process.cwd()/.cache when no dir is passed", () => {
    const cwd = process.cwd();
    const tmp = tmpDir();
    process.chdir(tmp);
    try {
      const store = new DiskCache();
      store.set("k", ENTRY);
      expect(existsSync(join(tmp, ".cache", "k.json"))).toBe(true);
      expect(store.get("k")).toEqual(ENTRY);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("MemoryCache extras", () => {
  it("entries() dumps the map as a plain object; size reflects the entry count", () => {
    const m = new MemoryCache();
    expect(m.size).toBe(0);
    expect(m.entries()).toEqual({});
    m.set("a", ENTRY);
    m.set("b", { ...ENTRY, endpoint: "tgm/indicators" });
    expect(m.size).toBe(2);
    expect(m.entries()).toEqual({ a: ENTRY, b: { ...ENTRY, endpoint: "tgm/indicators" } });
  });
});

describe("LayeredCache.set", () => {
  it("writes the entry to every layer, not just the first", () => {
    const mem = new MemoryCache();
    const disk = new MemoryCache();
    const l = new LayeredCache([mem, disk]);
    l.set("k", ENTRY);
    expect(mem.get("k")).toEqual(ENTRY);
    expect(disk.get("k")).toEqual(ENTRY);
  });

  it("get() on a hit already in the first layer promotes nothing (no earlier layers to write)", () => {
    const mem = new MemoryCache();
    const disk = new MemoryCache();
    mem.set("k", ENTRY);
    const l = new LayeredCache([mem, disk]);
    expect(l.get("k")).toEqual(ENTRY);
    expect(disk.get("k")).toBeUndefined();
  });
});

describe("CachedNansenClient — expiry and env constructor", () => {
  it("a stale (expired) cache entry is ignored and the client re-fetches over the network, refreshing the store", async () => {
    const store = new MemoryCache();
    const key = cacheKey("tgm/flows", { a: 1 });
    store.set(key, { storedAt: "2000-01-01T00:00:00Z", ttlMs: 60_000, endpoint: "tgm/flows", body: { a: 1 }, text: '{"stale":true}' });
    let n = 0;
    const c = new CachedNansenClient(KEY, { fetchImpl: fakeFetch(() => ({ n: n++ })), store, ttlMs: 60_000, rps: 1000 });
    const result = await c.post("tgm/flows", { a: 1 });
    expect(result).toEqual({ n: 0 });
    expect(n).toBe(1);
    expect(c.calls[0]).toMatchObject({ cached: false, ok: true });
    const refreshed = store.get(key);
    expect(refreshed?.text).toBe('{"n":0}');
  });

  it("cachedClientFromEnv builds a client from NANSEN_API_KEY and forwards opts", async () => {
    const prev = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    try {
      const store = new MemoryCache();
      const c = cachedClientFromEnv({ fetchImpl: fakeFetch(() => ({ hello: "world" })), store, rps: 1000 });
      expect(c).toBeInstanceOf(CachedNansenClient);
      expect(await c.post("tgm/flows", { a: 1 })).toEqual({ hello: "world" });
    } finally {
      if (prev === undefined) delete process.env.NANSEN_API_KEY;
      else process.env.NANSEN_API_KEY = prev;
    }
  });

  it("cachedClientFromEnv falls back to an empty key when NANSEN_API_KEY is unset, which NansenClient rejects", () => {
    const prev = process.env.NANSEN_API_KEY;
    delete process.env.NANSEN_API_KEY;
    try {
      expect(() => cachedClientFromEnv()).toThrow(/NANSEN_API_KEY/);
    } finally {
      if (prev !== undefined) process.env.NANSEN_API_KEY = prev;
    }
  });

  it("with no store option, defaults to a real DiskCache (writes land under cwd/.cache)", async () => {
    const cwd = process.cwd();
    const tmp = mkdtempSync(join(tmpdir(), "glidepath-cache-default-"));
    process.chdir(tmp);
    try {
      const c = new CachedNansenClient(KEY, { fetchImpl: fakeFetch(() => ({ v: 1 })), rps: 1000 });
      await c.post("tgm/flows", { a: 1 });
      expect(existsSync(join(tmp, ".cache"))).toBe(true);
    } finally {
      process.chdir(cwd);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("oldestHit keeps the earliest storedAt across multiple cache hits, not the most recent", async () => {
    const store = new MemoryCache();
    const olderKey = cacheKey("tgm/flows", { a: 1 });
    const newerKey = cacheKey("tgm/flows", { a: 2 });
    // both timestamps are within the ttl window ("fresh"), older is just older than newer.
    const older = new Date(Date.now() - 5_000).toISOString();
    const newer = new Date(Date.now() - 1_000).toISOString();
    store.set(olderKey, { storedAt: older, ttlMs: 60_000, endpoint: "tgm/flows", body: { a: 1 }, text: "{}" });
    store.set(newerKey, { storedAt: newer, ttlMs: 60_000, endpoint: "tgm/flows", body: { a: 2 }, text: "{}" });
    const c = new CachedNansenClient(KEY, { fetchImpl: fakeFetch(() => ({})), store, ttlMs: 60_000, rps: 1000 });
    await c.post("tgm/flows", { a: 1 }); // older hit first: sets oldestHit
    expect(c.oldestHit).toBe(older);
    await c.post("tgm/flows", { a: 2 }); // newer hit second: storedAt is NOT earlier, oldestHit must stay
    expect(c.oldestHit).toBe(older);
  });

  it("a fresh response with no credits header falls back to the CREDITS table, then to 1 for an unlisted endpoint", async () => {
    const noHeaderFetch = (): typeof fetch => async () => new Response('{"x":1}', { status: 200, headers: { "content-type": "application/json" } });
    const store1 = new MemoryCache();
    const c1 = new CachedNansenClient(KEY, { fetchImpl: noHeaderFetch(), store: store1, rps: 1000 });
    await c1.post("tgm/flows", { a: 1 }); // "tgm/flows" is in CREDITS (=1)
    expect(store1.get(cacheKey("tgm/flows", { a: 1 }))?.creditsUsed).toBe(1);

    const store2 = new MemoryCache();
    const c2 = new CachedNansenClient(KEY, { fetchImpl: noHeaderFetch(), store: store2, rps: 1000 });
    await c2.post("some/unlisted-endpoint", { a: 1 }); // not in CREDITS: falls all the way to 1
    expect(store2.get(cacheKey("some/unlisted-endpoint", { a: 1 }))?.creditsUsed).toBe(1);
  });
});
