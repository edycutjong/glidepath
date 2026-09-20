import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { CallEvent } from "../src/client";
import { fakeClient, fakeCachedClient } from "./helpers";

// A footgun fix: a real shell with NANSEN_OFFLINE=1 exported must not change what this suite asserts — the
// fakeCachedClient case below is meant to hit its fake network, so the ambient env is neutralized for each test.
const REAL_NANSEN_OFFLINE = process.env.NANSEN_OFFLINE;
beforeEach(() => {
  delete process.env.NANSEN_OFFLINE;
});
afterEach(() => {
  if (REAL_NANSEN_OFFLINE === undefined) delete process.env.NANSEN_OFFLINE;
  else process.env.NANSEN_OFFLINE = REAL_NANSEN_OFFLINE;
});

/** The web app's call rail is fed by these events; every `end` must carry the very object the drawer prints. */
describe("call observer (the Nansen call rail)", () => {
  it("fires start then end for a live call, and the end event's call is the object in client.calls", async () => {
    const events: CallEvent[] = [];
    const c = fakeClient(() => ({ ok: true }), { onCall: (e) => events.push(e) });
    await c.post("tgm/flow-intelligence", { chain: "ethereum", timeframe: "1d" }, ["x"]);
    expect(events.map((e) => e.type)).toEqual(["start", "end"]);
    expect(events[0]).toMatchObject({ type: "start", id: 1, method: "POST", endpoint: "tgm/flow-intelligence", body: { chain: "ethereum", timeframe: "1d" } });
    expect(events[1].type === "end" && events[1].id).toBe(1);
    expect(events[1].type === "end" && events[1].call).toBe(c.calls[0]);
  });
  it("a failed call still ends (ok=false, 0 credits) under the same id it started with", async () => {
    const events: CallEvent[] = [];
    const c = fakeClient(() => new Response('{"message":"nope"}', { status: 422 }));
    c.observe((e) => events.push(e));
    await expect(c.post("tgm/flows", {})).rejects.toThrow();
    expect(events.map((e) => e.type)).toEqual(["start", "end"]);
    expect(events[1].type === "end" && events[1].call).toMatchObject({ ok: false, credits: 0, status: 422 });
    expect(events[0].id).toBe(events[1].id);
  });
  it("a cache hit fires end only, flagged cached, and a miss fires start+end", async () => {
    const events: CallEvent[] = [];
    const c = fakeCachedClient(() => ({ v: 1 }), { onCall: (e) => events.push(e) });
    await c.post("tgm/indicators", { a: 1 });
    await c.post("tgm/indicators", { a: 1 });
    expect(events.map((e) => e.type)).toEqual(["start", "end", "end"]);
    expect(events[2].type === "end" && events[2].call.cached).toBe(true);
    expect(events[2].type === "end" && events[2].call).toBe(c.calls[1]);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });
  it("an observer that throws never breaks the call", async () => {
    const c = fakeClient(() => ({ ok: 1 }), {
      onCall: () => {
        throw new Error("boom");
      },
    });
    await expect(c.post("search/general", {})).resolves.toEqual({ ok: 1 });
    expect(c.calls).toHaveLength(1);
  });
});
