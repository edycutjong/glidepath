import { CachedNansenClient, DiskCache, LayeredCache, MemoryCache, glidepath, type CallObserver, type PlanInput, type PlanResult } from "@glidepath/core";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * One client per server instance: memory cache first, then a disk cache (repo `.cache/` locally, /tmp on Vercel so a
 * warm function stays warm). The key never leaves the server. TTL 1 h — the badge shows the age of the oldest response.
 */
const memory = new MemoryCache();
function makeClient(onCall?: CallObserver): CachedNansenClient {
  const dir = process.env.VERCEL ? join(tmpdir(), "glidepath-cache") : join(process.cwd(), ".cache");
  return new CachedNansenClient(process.env.NANSEN_API_KEY ?? "", { store: new LayeredCache([memory, new DiskCache(dir)]), timeoutMs: 12000, onCall });
}

/** One plan. `onCall` (optional) sees every Nansen call start and land — the stream behind the page's call rail. */
export async function planFor(input: PlanInput, onCall?: CallObserver): Promise<PlanResult> {
  const client = makeClient(onCall);
  return glidepath(client, input);
}

/** the longest real address (starknet/sui, 66) with room to spare; anything longer is not a token and never reaches Nansen */
export const MAX_TOKEN_CHARS = 128;

export function parseInput(chain: string | null, token: string | null, amount: string | null): PlanInput | { error: string } {
  if (!token?.trim()) return { error: "token is required (address or ticker)" };
  if (token.trim().length > MAX_TOKEN_CHARS) return { error: `token is too long — an address or a ticker, at most ${MAX_TOKEN_CHARS} characters` };
  if (!chain?.trim()) return { error: "chain is required" };
  const n = Number(String(amount ?? "").replace(/[,_\s]/g, ""));
  if (!(n > 0) || !Number.isFinite(n)) return { error: "amount must be a positive number of tokens" };
  return { chain: chain.trim().toLowerCase(), token: token.trim(), amount: n };
}
