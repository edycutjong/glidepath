import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MemoryCache, type CacheEntry } from "./cache";
import type { PlanInput } from "./plan";
import type { PlanResult } from "./glidepath";

/**
 * A recorded live run: every raw Nansen response the plan touched (keyed by cache key, byte-for-byte as sent), the plan
 * it produced, and the clock it ran under. `scripts/seed.ts` writes these; `scripts/verify.ts` and the tests replay them
 * with NANSEN_OFFLINE — same inputs, same clock, so the decision hash must come out identical. Responses are never edited.
 */
export type Fixture = {
  edge: string;
  input: PlanInput;
  now: number;
  recordedAt: string;
  live: { calls: number; credits: number; ms: number };
  responses: Record<string, CacheEntry>;
  plan: PlanResult;
};

export const FIXTURES_DIR = "fixtures";

export function fixtureName(input: PlanInput, tag?: string): string {
  const base = `${input.token.slice(0, 12)}--${input.chain}${tag ? `--${tag}` : ""}`;
  return base.replace(/[^A-Za-z0-9_-]/g, "_").toUpperCase();
}

export function writeFixture(f: Fixture, dir = FIXTURES_DIR, tag?: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${fixtureName(f.input, tag)}.json`);
  writeFileSync(path, JSON.stringify(f, null, 2) + "\n");
  return path;
}

export function readFixture(path: string): Fixture {
  return JSON.parse(readFileSync(path, "utf8")) as Fixture;
}

export function listFixtures(dir = FIXTURES_DIR): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

/** A cache store pre-loaded with the fixture's responses — plug into `CachedNansenClient` with `offline: true`. */
export function fixtureStore(f: Fixture): MemoryCache {
  const store = new MemoryCache();
  for (const [key, entry] of Object.entries(f.responses)) store.set(key, entry);
  return store;
}
