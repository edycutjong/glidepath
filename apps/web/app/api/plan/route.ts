import { NextResponse } from "next/server";
import type { Call, PlanResult } from "@glidepath/core";
import { planFor, parseInput } from "@/lib/server";
import { admit, recordSpend } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST {chain, token, amount} → PlanResult. The Nansen key is read server-side only.
 * Input validation runs before the key check and before any network call: a malformed query is a 400 whether or
 * not the server holds a key (boundary test: apps/web/test/api-boundary.test.ts). Spend guard (lib/guard.ts): 429 past
 * the per-IP rate, 503 past the daily credit ceiling — both before any Nansen call (apps/web/test/guard.test.ts).
 *
 * `?stream=1` answers NDJSON instead of one JSON body: a `{"t":"start"}` line when a Nansen call leaves, a `{"t":"call"}`
 * line with the recorded Call when it lands (the same object the provenance drawer prints), then `{"t":"plan"}` or
 * `{"t":"error"}`. The page's call rail is fed by these lines; nothing on it is synthetic (apps/web/test/stream.test.ts).
 */
type StreamLine =
  { t: "start"; id: number; method: string; endpoint: string; body: Record<string, unknown> } | { t: "call"; id: number; call: Call } | { t: "plan"; plan: PlanResult } | { t: "error"; error: string };

function streamPlan(input: Parameters<typeof planFor>[0]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (line: StreamLine) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(JSON.stringify(line) + "\n"));
        } catch {
          closed = true; // the client went away; the plan still finishes and the spend is still counted
        }
      };
      try {
        const plan = await planFor(input, (e) => {
          if (e.type === "start") send({ t: "start", id: e.id, method: e.method, endpoint: e.endpoint, body: e.body });
          else send({ t: "call", id: e.id, call: e.call });
        });
        recordSpend(plan.credits);
        send({ t: "plan", plan });
      } catch (e) {
        send({ t: "error", error: (e as Error).message.slice(0, 300) });
      }
      if (!closed) controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const input = parseInput(String(body.chain ?? ""), String(body.token ?? ""), String(body.amount ?? ""));
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  if (!process.env.NANSEN_API_KEY) return NextResponse.json({ error: "NANSEN_API_KEY is not set on the server" }, { status: 500 });
  const gate = admit(req.headers);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status, headers: { "retry-after": String(gate.retryAfter), "cache-control": "no-store" } });
  if (new URL(req.url).searchParams.get("stream") === "1") return streamPlan(input);
  try {
    const plan = await planFor(input);
    recordSpend(plan.credits);
    return NextResponse.json(plan, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
