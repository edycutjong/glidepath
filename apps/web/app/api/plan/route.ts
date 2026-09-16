import { NextResponse } from "next/server";
import { planFor, parseInput } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** POST {chain, token, amount} → PlanResult. The Nansen key is read server-side only. */
export async function POST(req: Request) {
  if (!process.env.NANSEN_API_KEY) return NextResponse.json({ error: "NANSEN_API_KEY is not set on the server" }, { status: 500 });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return NextResponse.json({ error: "body must be JSON" }, { status: 400 }); }
  const input = parseInput(String(body.chain ?? ""), String(body.token ?? ""), String(body.amount ?? ""));
  if ("error" in input) return NextResponse.json({ error: input.error }, { status: 400 });
  try {
    const plan = await planFor(input);
    return NextResponse.json(plan, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.slice(0, 300) }, { status: 502 });
  }
}
