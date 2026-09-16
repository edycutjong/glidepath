import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NansenClient, sha256, CREDITS, type ClientOptions, type CallOptions, type RawResult } from "./client";

export type CacheEntry = { storedAt: string; ttlMs: number; endpoint: string; body: Record<string, unknown>; text: string; creditsUsed?: number };

/** Storage for cached responses. Disk for CLI/dev; memory for the web app and fixtures. */
export interface CacheStore {
  get(key: string): CacheEntry | undefined;
  set(key: string, entry: CacheEntry): void;
}

export class DiskCache implements CacheStore {
  constructor(private dir = join(process.cwd(), ".cache")) {
    try { mkdirSync(dir, { recursive: true }); } catch { /* read-only FS (serverless): reads miss, writes are dropped */ }
  }
  private path(key: string) { return join(this.dir, `${key}.json`); }
  get(key: string): CacheEntry | undefined {
    const p = this.path(key);
    if (!existsSync(p)) return undefined;
    try { return JSON.parse(readFileSync(p, "utf8")) as CacheEntry; } catch { return undefined; }
  }
  set(key: string, entry: CacheEntry) {
    try { writeFileSync(this.path(key), JSON.stringify(entry)); } catch { /* ignore */ }
  }
}

export class MemoryCache implements CacheStore {
  private m = new Map<string, CacheEntry>();
  get(key: string) { return this.m.get(key); }
  set(key: string, entry: CacheEntry) { this.m.set(key, entry); }
  entries(): Record<string, CacheEntry> { return Object.fromEntries(this.m); }
  get size() { return this.m.size; }
}

/** Two stores in series: memory first, then disk; a disk hit is promoted to memory. */
export class LayeredCache implements CacheStore {
  constructor(private layers: CacheStore[]) {}
  get(key: string) {
    for (let i = 0; i < this.layers.length; i++) {
      const hit = this.layers[i].get(key);
      if (hit) { for (let j = 0; j < i; j++) this.layers[j].set(key, hit); return hit; }
    }
    return undefined;
  }
  set(key: string, entry: CacheEntry) { for (const l of this.layers) l.set(key, entry); }
}

export const DEFAULT_TTL_MS = 60 * 60 * 1000;

/** Recursively sort object keys so `{a:{y,x}}` and `{a:{x,y}}` serialize identically (arrays keep order). */
export function canonicalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalize);
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonicalize((v as Record<string, unknown>)[k])]));
  return v;
}

/** Stable key: method + endpoint + canonical body (keys sorted at every depth). */
export function cacheKey(endpoint: string, body: Record<string, unknown>, method = "POST"): string {
  return sha256(`${method} ${endpoint}\n${JSON.stringify(canonicalize(body))}`).slice(0, 32);
}

export type CachedClientOptions = ClientOptions & {
  store?: CacheStore;
  ttlMs?: number;
  /** NANSEN_OFFLINE=1: never touch the network; a miss is an error. Used by `npm run verify`. */
  offline?: boolean;
};

/**
 * NansenClient with a read-through cache. A hit is recorded as a Call with `cached: true` and 0 credits,
 * so the provenance drawer and the credit counter stay honest.
 */
export class CachedNansenClient extends NansenClient {
  private store: CacheStore;
  private ttlMs: number;
  readonly offline: boolean;
  /** ISO timestamp of the oldest cached response used so far, for the "computed Ns ago" badge. */
  oldestHit?: string;

  constructor(apiKey: string, opts: CachedClientOptions = {}) {
    super(apiKey, opts);
    this.store = opts.store ?? new DiskCache();
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    this.offline = opts.offline ?? process.env.NANSEN_OFFLINE === "1";
  }

  protected override async request<T>(method: "POST" | "GET", endpoint: string, body: Record<string, unknown>, fieldsUsed: string[], opts: CallOptions): Promise<T> {
    const key = cacheKey(endpoint, body, method);
    // Freshness is judged by THIS client's TTL, so `ttlMs: 0` (--no-cache) really bypasses reads. Offline serves any age.
    const hit = this.ttlMs > 0 || this.offline ? this.store.get(key) : undefined;
    const fresh = hit && Date.now() - Date.parse(hit.storedAt) < this.ttlMs;
    if (hit && (fresh || this.offline)) {
      this.calls.push({ endpoint, method, body, credits: 0, ms: 0, cached: true, status: 200, fieldsUsed, responseHash: sha256(hit.text), attempts: 0, totalMs: 0, ok: true });
      if (!this.oldestHit || hit.storedAt < this.oldestHit) this.oldestHit = hit.storedAt;
      return JSON.parse(hit.text) as T;
    }
    if (this.offline) throw new Error(`NANSEN_OFFLINE=1 and no cached response for ${method} ${endpoint} ${JSON.stringify(body)}`);
    const t0 = Date.now();
    let raw: RawResult;
    try { raw = await this.raw(method, endpoint, body, opts); }
    catch (e) { this.recordFailure(method, endpoint, body, fieldsUsed, e, Date.now() - t0); throw e; }
    this.record(method, endpoint, body, fieldsUsed, raw);
    this.store.set(key, { storedAt: new Date().toISOString(), ttlMs: this.ttlMs, endpoint, body, text: raw.text, creditsUsed: raw.creditsUsed ?? CREDITS[endpoint] ?? 1 });
    return JSON.parse(raw.text) as T;
  }
}

export function cachedClientFromEnv(opts?: CachedClientOptions): CachedNansenClient {
  return new CachedNansenClient(process.env.NANSEN_API_KEY ?? "", opts);
}
