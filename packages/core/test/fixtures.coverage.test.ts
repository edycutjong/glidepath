import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { fixtureName, writeFixture, readFixture, listFixtures, fixtureStore, type Fixture } from "../src/fixtures";
import { MemoryCache } from "../src/cache";
import { glidepath } from "../src/glidepath";
import { fakeCachedClient, pepeRoutes, NOW } from "./helpers";

/** A real PlanResult from the fake PEPE flow, plus the responses that produced it — a genuine Fixture, no hand-rolled Plan shape. */
async function buildFixture(): Promise<Fixture> {
  const store = new MemoryCache();
  const client = fakeCachedClient(pepeRoutes, { store });
  const input = { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 };
  const plan = await glidepath(client, input, { now: NOW });
  return {
    edge: "pepe-ethereum",
    input,
    now: NOW,
    recordedAt: new Date(NOW).toISOString(),
    live: { calls: plan.calls, credits: plan.credits, ms: plan.ms },
    responses: store.entries(),
    plan,
  };
}

describe("fixtureName", () => {
  it("joins the first 12 chars of the token and the chain with no tag", () => {
    expect(fixtureName({ chain: "ethereum", token: "PEPE", amount: 1 })).toBe("PEPE--ETHEREUM");
  });
  it("appends --TAG when a tag is given", () => {
    expect(fixtureName({ chain: "ethereum", token: "PEPE", amount: 1 }, "seed")).toBe("PEPE--ETHEREUM--SEED");
  });
  it("truncates the token to 12 chars and replaces non [A-Za-z0-9_-] chars with _, then upper-cases", () => {
    // 0xdEaDbeef1234ffff (address, lowercase) sliced to 12 chars = "0xdeadbeef12"
    const name = fixtureName({ chain: "ethereum", token: "0xdeadbeef1234ffff", amount: 1 });
    expect(name).toBe("0XDEADBEEF12--ETHEREUM");
  });
  it("replaces punctuation (e.g. from a tag or symbol) with underscores", () => {
    const name = fixtureName({ chain: "sol:ana!", token: "AB CD", amount: 1 }, "v2!");
    expect(name).toBe("AB_CD--SOL_ANA_--V2_");
  });
});

describe("writeFixture / readFixture round trip", () => {
  it("writes JSON under <dir>/<fixtureName>.json (no tag) and reads it back byte-identical in shape", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glidepath-fixtures-"));
    const f = await buildFixture();
    const path = writeFixture(f, dir);
    expect(path).toBe(join(dir, `${fixtureName(f.input)}.json`));
    const raw = readFileSync(path, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const back = readFixture(path);
    expect(back).toEqual(f);
  });
  it("writes under a tagged filename when a tag is given, and creates the dir if missing (nested, recursive)", async () => {
    const root = mkdtempSync(join(tmpdir(), "glidepath-fixtures-"));
    const dir = join(root, "nested", "deeper");
    const f = await buildFixture();
    const path = writeFixture(f, dir, "regress");
    expect(path).toBe(join(dir, `${fixtureName(f.input, "regress")}.json`));
    expect(readFixture(path).plan.hash).toBe(f.plan.hash);
  });
  it("defaults the dir to FIXTURES_DIR when none is given", async () => {
    // Exercise the default-parameter branch without touching the real fixtures/ dir: run from a throwaway cwd.
    const cwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), "glidepath-fixtures-cwd-"));
    process.chdir(scratch);
    try {
      const f = await buildFixture();
      const path = writeFixture(f);
      expect(path).toBe(join("fixtures", `${fixtureName(f.input)}.json`));
      expect(readFixture(path).input).toEqual(f.input);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("listFixtures", () => {
  it("lists only *.json files in a dir, sorted, as full paths", async () => {
    const dir = mkdtempSync(join(tmpdir(), "glidepath-fixtures-list-"));
    const f = await buildFixture();
    writeFixture(f, dir, "b-tag");
    writeFixture(f, dir, "a-tag");
    const files = listFixtures(dir);
    expect(files).toEqual([...files].sort());
    expect(files.every((p) => p.endsWith(".json"))).toBe(true);
    expect(files).toHaveLength(2);
  });
  it("returns [] instead of throwing when the dir does not exist", () => {
    const missing = join(mkdtempSync(join(tmpdir(), "glidepath-fixtures-missing-")), "does-not-exist");
    expect(listFixtures(missing)).toEqual([]);
  });
  it("defaults the dir to FIXTURES_DIR when none is given (missing in a throwaway cwd, so the catch branch runs)", () => {
    const cwd = process.cwd();
    const scratch = mkdtempSync(join(tmpdir(), "glidepath-fixtures-list-cwd-"));
    process.chdir(scratch);
    try {
      expect(listFixtures()).toEqual([]);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("fixtureStore", () => {
  it("pre-loads a MemoryCache with every response entry, keyed the same as the fixture", async () => {
    const f = await buildFixture();
    const store = fixtureStore(f);
    for (const [key, entry] of Object.entries(f.responses)) {
      expect(store.get(key)).toEqual(entry);
    }
    expect(store.size).toBe(Object.keys(f.responses).length);
  });
  it("an empty responses map produces an empty store", () => {
    const f: Fixture = {
      edge: "empty",
      input: { chain: "ethereum", token: "PEPE", amount: 1 },
      now: NOW,
      recordedAt: new Date(NOW).toISOString(),
      live: { calls: 0, credits: 0, ms: 0 },
      responses: {},
    } as unknown as Fixture;
    const store = fixtureStore(f);
    expect(store.size).toBe(0);
  });
});
