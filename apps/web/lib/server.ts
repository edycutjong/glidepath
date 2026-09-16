import { CachedNansenClient, DiskCache, LayeredCache, MemoryCache, glidepath, type PlanInput, type PlanResult } from "@glidepath/core";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * One client per server instance: memory cache first, then a disk cache (repo `.cache/` locally, /tmp on Vercel so a
 * warm function stays warm). The key never leaves the server. TTL 1 h — the badge shows the age of the oldest response.
 */
const memory = new MemoryCache();
function makeClient(): CachedNansenClient {
  const dir = process.env.VERCEL ? join(tmpdir(), "glidepath-cache") : join(process.cwd(), ".cache");
  return new CachedNansenClient(process.env.NANSEN_API_KEY ?? "", { store: new LayeredCache([memory, new DiskCache(dir)]), timeoutMs: 12000 });
}

export async function planFor(input: PlanInput): Promise<PlanResult> {
  const client = makeClient();
  return glidepath(client, input);
}

export function parseInput(chain: string | null, token: string | null, amount: string | null): PlanInput | { error: string } {
  if (!token?.trim()) return { error: "token is required (address or ticker)" };
  if (!chain?.trim()) return { error: "chain is required" };
  const n = Number(String(amount ?? "").replace(/[,_\s]/g, ""));
  if (!(n > 0) || !Number.isFinite(n)) return { error: "amount must be a positive number of tokens" };
  return { chain: chain.trim().toLowerCase(), token: token.trim(), amount: n };
}
