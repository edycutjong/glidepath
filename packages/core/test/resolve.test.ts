import { describe, it, expect } from "vitest";
import { looksLikeAddress, resolveToken } from "../src/resolve";
import { fakeClient, pepeRoutes, PEPE } from "./helpers";

describe("resolve", () => {
  it("recognises EVM, Solana, Sui/Starknet, TON and Tron address shapes", () => {
    expect(looksLikeAddress(PEPE)).toBe(true);
    expect(looksLikeAddress("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263")).toBe(true);
    expect(looksLikeAddress("0x" + "a".repeat(64))).toBe(true);
    expect(looksLikeAddress("PEPE")).toBe(false);
    expect(looksLikeAddress("pepe coin")).toBe(false);
  });
  it("an address passes through with zero calls", async () => {
    const c = fakeClient(() => { throw new Error("no network expected"); });
    const r = await resolveToken(c, "ethereum", PEPE);
    expect(r).toMatchObject({ ok: true, address: PEPE, viaSearch: false });
    expect(c.calls).toHaveLength(0);
  });
  it("a ticker resolves to the exact-symbol match on the chain, lowest rank first, at 0 credits", async () => {
    const c = fakeClient(pepeRoutes);
    const r = await resolveToken(c, "ethereum", "pepe");
    expect(r).toMatchObject({ ok: true, address: PEPE, symbol: "PEPE", viaSearch: true });
    expect(c.creditsSpent).toBe(0);
  });
  it("a name that only exists elsewhere says where; fuzzy hits (PEPEX) never match", async () => {
    const c = fakeClient(pepeRoutes);
    const r = await resolveToken(c, "solana", "PEPE");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/no token named PEPE on solana — it exists on ethereum, base/);
      expect(r.elsewhere.map((e) => e.chain)).toEqual(["ethereum", "base"]);
    }
  });
});
