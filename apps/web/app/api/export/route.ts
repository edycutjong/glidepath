import { toICS, toCSV } from "@glidepath/core";
import { planFor, parseInput } from "@/lib/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** GET ?chain&token&amount&format=ics|csv → the calendar as a file (served from the 1 h cache, so it matches the screen). */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const input = parseInput(u.searchParams.get("chain"), u.searchParams.get("token"), u.searchParams.get("amount"));
  if ("error" in input) return new Response(input.error, { status: 400 });
  const format = u.searchParams.get("format") === "csv" ? "csv" : "ics";
  const plan = await planFor(input);
  const name = `glidepath-${plan.resolved.symbol.replace(/[^A-Za-z0-9]/g, "")}-${plan.today.date}.${format}`;
  const body = format === "csv" ? toCSV(plan) : toICS(plan);
  return new Response(body, { headers: { "content-type": format === "csv" ? "text/csv; charset=utf-8" : "text/calendar; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });
}
