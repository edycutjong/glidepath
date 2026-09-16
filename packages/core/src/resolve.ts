import type { NansenClient } from "./client";
import { searchTokens, type SearchToken } from "./nansen";

/** Address-shaped input passes straight through; anything else is treated as a ticker to resolve via search/general. */
export function looksLikeAddress(s: string): boolean {
  const t = s.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return true; // EVM
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return true; // solana / base58
  if (/^0x[0-9a-fA-F]{60,66}$/.test(t)) return true; // sui / starknet style
  if (/^EQ[A-Za-z0-9_-]{46}$/.test(t) || /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(t)) return true; // ton / tron
  return false;
}

export type Resolution =
  | { ok: true; address: string; symbol: string; name: string; viaSearch: boolean; searchPrice?: number | null }
  | { ok: false; reason: string; elsewhere: Array<{ chain: string; address: string; symbol: string }> };

/**
 * Turn "PEPE" on ethereum into a contract address using search/general (0 credits): exact symbol or name match on the
 * requested chain, lowest rank wins. When the name exists only on other chains, say where.
 */
export async function resolveToken(client: NansenClient, chain: string, input: string): Promise<Resolution> {
  const q = input.trim();
  if (looksLikeAddress(q)) return { ok: true, address: q, symbol: q.slice(0, 6) + "…", name: q, viaSearch: false };
  const res = await searchTokens(client, q, undefined, { timeoutMs: 8000 });
  const same = (t: SearchToken) => t.symbol?.toLowerCase() === q.toLowerCase() || t.name?.toLowerCase() === q.toLowerCase();
  const candidates = (res.tokens ?? []).filter(same);
  const onChain = candidates.filter((t) => t.chain === chain).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  if (onChain.length) {
    const t = onChain[0];
    return { ok: true, address: t.address, symbol: t.symbol, name: t.name, viaSearch: true, searchPrice: t.price };
  }
  const elsewhere = candidates.filter((t) => t.chain !== "hyperliquid").map((t) => ({ chain: t.chain, address: t.address, symbol: t.symbol }));
  const reason = candidates.length
    ? `no token named ${q} on ${chain} — it exists on ${[...new Set(elsewhere.map((e) => e.chain))].join(", ") || "perp markets only"}`
    : `no token named ${q} on Nansen (${res.total_results ?? 0} fuzzy results)`;
  return { ok: false, reason, elsewhere };
}
