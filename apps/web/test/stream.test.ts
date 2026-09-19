/**
 * `/api/plan?stream=1` — the NDJSON feed behind the page's Nansen call rail. `planFor` is mocked to replay a
 * scripted sequence of observer events, so this proves the wire format and ordering without a client, cache or
 * network: start lines precede their call line, the call line carries the observer's Call object verbatim, the
 * plan line is last, an engine failure becomes an error line (not a broken stream), and the spend is counted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "../app/api/plan/route";
import { creditsLeft, resetGuard, DAILY_CREDITS } from "../lib/guard";

const { planForMock } = vi.hoisted(() => ({ planForMock: vi.fn() }));
vi.mock("@/lib/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/server")>();
  return { ...actual, planFor: planForMock };
});

const KEY = "nsn_stream_test_key_000000000000000000000";
const post = (body: unknown, qs = "?stream=1") => POST(new Request(`http://localhost/api/plan${qs}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const lines = async (res: Response) =>
  (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { t: string; id?: number; call?: unknown; plan?: unknown; error?: string; endpoint?: string });

const CALL = {
  endpoint: "tgm/flow-intelligence",
  method: "POST",
  body: { chain: "ethereum", timeframe: "1d" },
  credits: 1,
  ms: 412,
  cached: false,
  status: 200,
  fieldsUsed: ["x"],
  responseHash: "a91f",
  attempts: 1,
  totalMs: 412,
  ok: true,
};

describe("POST /api/plan?stream=1", () => {
  let realKey: string | undefined;
  beforeEach(() => {
    realKey = process.env.NANSEN_API_KEY;
    process.env.NANSEN_API_KEY = KEY;
    planForMock.mockReset();
    resetGuard();
  });
  afterEach(() => {
    if (realKey == null) delete process.env.NANSEN_API_KEY;
    else process.env.NANSEN_API_KEY = realKey;
    resetGuard();
  });

  it("streams start → call → plan as NDJSON, the call line carrying the observer's Call verbatim, and counts the spend", async () => {
    planForMock.mockImplementationOnce(async (_input: unknown, onCall: (e: unknown) => void) => {
      onCall({ type: "start", id: 1, method: "POST", endpoint: CALL.endpoint, body: CALL.body });
      onCall({ type: "end", id: 1, call: CALL });
      onCall({ type: "end", id: 2, call: { ...CALL, cached: true, credits: 0, ms: 0 } });
      return { status: "ok", credits: 1, calls: 2, provenance: [CALL] };
    });
    const res = await post({ chain: "ethereum", token: "PEPE", amount: "1" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/x-ndjson/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const out = await lines(res);
    expect(out.map((l) => l.t)).toEqual(["start", "call", "call", "plan"]);
    expect(out[0]).toMatchObject({ id: 1, endpoint: "tgm/flow-intelligence" });
    expect(out[1].call).toEqual(CALL);
    expect(out[3].plan).toMatchObject({ status: "ok", credits: 1 });
    expect(creditsLeft()).toBe(DAILY_CREDITS - 1);
  });

  it("an engine failure ends the stream with an error line instead of a broken connection", async () => {
    planForMock.mockRejectedValueOnce(new Error("Nansen unreachable"));
    const res = await post({ chain: "ethereum", token: "PEPE", amount: "1" });
    expect(res.status).toBe(200);
    const out = await lines(res);
    expect(out).toEqual([{ t: "error", error: "Nansen unreachable" }]);
  });

  it("a client that disconnects mid-stream does not break the plan: later lines are dropped, the spend is still counted", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let onCallRef: ((e: unknown) => void) | null = null;
    planForMock.mockImplementationOnce(async (_input: unknown, onCall: (e: unknown) => void) => {
      onCallRef = onCall;
      onCall({ type: "start", id: 1, method: "POST", endpoint: CALL.endpoint, body: CALL.body });
      await gate;
      onCall({ type: "end", id: 1, call: CALL });
      return { status: "ok", credits: 7, calls: 1, provenance: [CALL] };
    });
    const res = await post({ chain: "ethereum", token: "PEPE", amount: "1" });
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(JSON.parse(first.trim()).t).toBe("start");
    await reader.cancel(); // the browser tab closed
    release();
    await vi.waitFor(() => expect(creditsLeft()).toBe(DAILY_CREDITS - 7));
    expect(onCallRef).not.toBeNull();
  });

  it("validation and the key check still run before the stream: a bad amount is a plain 400", async () => {
    const res = await post({ chain: "ethereum", token: "PEPE", amount: "-1" });
    expect(res.status).toBe(400);
    expect(planForMock).not.toHaveBeenCalled();
  });

  it("without ?stream=1 the route still answers one JSON body", async () => {
    planForMock.mockResolvedValueOnce({ status: "ok", credits: 3 });
    const res = await post({ chain: "ethereum", token: "PEPE", amount: "1" }, "");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    await expect(res.json()).resolves.toEqual({ status: "ok", credits: 3 });
  });
});
