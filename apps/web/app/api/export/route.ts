import { toICS, toCSV } from "@glidepath/core";
import { planFor, parseInput } from "@/lib/server";
import { admit, recordSpend } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const text = (body: string, status: number, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...headers } });

/**
 * GET ?chain&token&amount&format=ics|csv → the calendar as a file (served from the 1 h cache, so it matches the screen).
 * A cache miss spends live credits, so the same spend guard as /api/plan applies (own per-IP window, shared daily ceiling).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const input = parseInput(u.searchParams.get("chain"), u.searchParams.get("token"), u.searchParams.get("amount"));
  if ("error" in input) return text(input.error, 400);
  if (!process.env.NANSEN_API_KEY) return text("NANSEN_API_KEY is not set on the server", 500);
  const gate = admit(req.headers, "export");
  if (!gate.ok) return text(gate.error, gate.status, { "retry-after": String(gate.retryAfter) });
  const format = u.searchParams.get("format") === "csv" ? "csv" : "ics";
  let plan;
  try {
    plan = await planFor(input);
  } catch (e) {
    return text((e as Error).message.slice(0, 300), 502);
  }
  recordSpend(plan.credits);
  const name = `glidepath-${plan.resolved.symbol.replace(/[^A-Za-z0-9]/g, "")}-${plan.today.date}.${format}`;
  const body = format === "csv" ? toCSV(plan) : toICS(plan);
  return new Response(body, {
    headers: { "content-type": format === "csv" ? "text/csv; charset=utf-8" : "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
