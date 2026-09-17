import { describe, it, expect } from "vitest";
import { looksLikeAddress, resolveToken } from "../src/resolve";
import { fakeClient } from "./helpers";

describe("resolve — remaining coverage gaps", () => {
  it("recognises TON (EQ-prefixed) and Tron (T-prefixed base58) address shapes", () => {
    expect(looksLikeAddress("EQ" + "A".repeat(46))).toBe(true); // TON: EQ + 46 chars
    expect(looksLikeAddress("TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t")).toBe(true); // Tron: T + 33 base58 chars
  });

  it("a search/general response with no tokens and no total_results field is treated as zero candidates / zero fuzzy hits, not a crash", async () => {
    const c = fakeClient((endpoint) => {
      if (endpoint === "search/general") return {}; // neither `tokens` nor `total_results` present
      throw new Error(`unexpected endpoint ${endpoint}`);
    });
    const r = await resolveToken(c, "ethereum", "NOTATOKEN");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no token named NOTATOKEN on Nansen (0 fuzzy results)");
      expect(r.elsewhere).toEqual([]);
    }
  });

  it("when two on-chain candidates both lack a rank, the sort falls back to 1e9 for both sides and keeps search order", async () => {
    const c = fakeClient((endpoint) => {
      if (endpoint === "search/general")
        return {
          tokens: [
            { name: "Bar", symbol: "BAR", chain: "ethereum", address: "0x" + "1".repeat(40) },
            { name: "Bar", symbol: "BAR", chain: "ethereum", address: "0x" + "2".repeat(40) },
          ],
          total_results: 2,
        };
      throw new Error(`unexpected endpoint ${endpoint}`);
    });
    const r = await resolveToken(c, "ethereum", "BAR");
    expect(r).toMatchObject({ ok: true, address: "0x" + "1".repeat(40), symbol: "BAR" });
  });

  it("candidates that exist only on perp markets (hyperliquid) leave `elsewhere` empty and the reason falls back to 'perp markets only'", async () => {
    const c = fakeClient((endpoint) => {
      if (endpoint === "search/general")
        return {
          tokens: [{ name: "Foo", symbol: "FOO", chain: "hyperliquid", address: "foo-perp", rank: 1 }],
          total_results: 1,
        };
      throw new Error(`unexpected endpoint ${endpoint}`);
    });
    const r = await resolveToken(c, "ethereum", "FOO");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("no token named FOO on ethereum — it exists on perp markets only");
      expect(r.elsewhere).toEqual([]);
    }
  });
});
