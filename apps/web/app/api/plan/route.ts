import { NextResponse } from "next/server";
import { planFor, parseInput } from "@/lib/server";
import { clientIp, ipAllowed, budgetExhausted, recordSpend, RATE_MESSAGE, BUDGET_MESSAGE } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST {chain, token, amount} → PlanResult. The Nansen key is read server-side only.
 * Input validation runs before the key check and before any network call: a malformed query is a 400 whether or
 * not the server holds a key (boundary test: apps/web/test/api-boundary.test.ts). Spend guard (lib/guard.ts): 429 past
 * the per-IP rate, 503 past the daily credit ceiling — both before any Nansen call (apps/web/test/guard.test.ts).
 */
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
  const gate = ipAllowed(clientIp(req.headers));
  if (!gate.ok) return NextResponse.json({ error: RATE_MESSAGE(gate.retryAfter) }, { status: 429, headers: { "retry-after": String(gate.retryAfter), "cache-control": "no-store" } });
  if (budgetExhausted()) return NextResponse.json({ error: BUDGET_MESSAGE }, { status: 503, headers: { "retry-after": "3600", "cache-control": "no-store" } });
  try {
    const plan = await planFor(input);
    recordSpend(plan.credits);
    return NextResponse.json(plan, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
