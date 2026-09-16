import { describe, it, expect } from "vitest";
import { listFixtures, readFixture, fixtureStore } from "../src/fixtures";
import { CachedNansenClient } from "../src/cache";
import { glidepath } from "../src/glidepath";

const files = listFixtures(new URL("../../../fixtures", import.meta.url).pathname);

describe("fixtures replay offline", () => {
  it("fixture files exist (run `npm run seed` live once)", () => {
    expect(files.length).toBeGreaterThan(0);
  });
  it.each(files.map((f) => [f.split("/").pop()!, f]))("%s reproduces its decision hash with zero network", async (_name, path) => {
    const f = readFixture(path);
    const client = new CachedNansenClient("nsn_offline_replay_000000000000000", { store: fixtureStore(f), offline: true });
    const replay = await glidepath(client, f.input, { now: f.now });
    expect(replay.hash).toBe(f.plan.hash);
    expect(replay.status).toBe(f.plan.status);
    expect(replay.tranches.map((t) => [t.date, t.red])).toEqual(f.plan.tranches.map((t) => [t.date, t.red]));
    expect(replay.credits).toBe(0);
    expect(replay.provenance.every((c) => c.cached)).toBe(true);
  });
});
