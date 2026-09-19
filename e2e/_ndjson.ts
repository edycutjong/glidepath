import type { Route } from "@playwright/test";

type Call = { method: string; endpoint: string; body: Record<string, unknown>; cached: boolean };
type Plan = { provenance: Call[] };

/**
 * Replay a recorded fixture plan the way `/api/plan?stream=1` streams it: a `start` line per live call, a `call` line
 * per call (cache hits have no start), then the plan — so the page's call rail and drawer exercise the real wire
 * format with zero credentials. `delayMs` spaces the lines so pending rows are observable.
 */
export function ndjsonFor(plan: Plan): string {
  const lines: string[] = [];
  plan.provenance.forEach((c, i) => {
    const id = i + 1;
    if (!c.cached) lines.push(JSON.stringify({ t: "start", id, method: c.method, endpoint: c.endpoint, body: c.body }));
    lines.push(JSON.stringify({ t: "call", id, call: c }));
  });
  lines.push(JSON.stringify({ t: "plan", plan }));
  return lines.join("\n") + "\n";
}

export const fulfillStream = (plan: Plan) => (route: Route) => route.fulfill({ status: 200, contentType: "application/x-ndjson; charset=utf-8", body: ndjsonFor(plan) });
