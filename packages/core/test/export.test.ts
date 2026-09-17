import { describe, it, expect } from "vitest";
import { toICS, toCSV, foldLine } from "../src/export";
import { computePlan } from "../src/plan";
import { pepeFacts, RESOLVED, NOW } from "./helpers";

const p = computePlan(pepeFacts({ exNet1dUsd: 877_893 }), { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 }, RESOLVED, NOW);

describe("exports", () => {
  it("ICS has one all-day VEVENT per tranche with the go/no-go rule and escaped commas", () => {
    const ics = toICS(p);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(p.days);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260916");
    expect(ics).toContain("SUMMARY:Sell ");
    const unfolded = ics.replace(/\r\n[ \t]/g, "");
    expect(unfolded).toMatch(/red day\\, halved/);
    expect(unfolded).toMatch(/Rule before selling: re-run glidepath/);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75); // RFC 5545 folding
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
  it("ICS escapes semicolons and folds long UTF-8 lines without splitting a multi-byte character", () => {
    expect(foldLine("a".repeat(80))).toBe("a".repeat(75) + "\r\n " + "a".repeat(5));
    const folded = foldLine("é".repeat(60)); // 120 octets
    for (const l of folded.split("\r\n")) {
      expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
      expect(l).not.toContain("\ufffd");
    }
    expect(folded.replace(/\r\n /g, "")).toBe("é".repeat(60));
    const odd = computePlan(pepeFacts(), { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 }, { ...RESOLVED, symbol: "A;B" }, NOW);
    const text = toICS(odd)
      .replace(/\r\n[ \t]/g, "")
      .split("\r\n")
      .filter((l) => /^(SUMMARY|DESCRIPTION):/.test(l))
      .join("\n");
    expect(text).toContain("A\\;B");
    expect(text.replace(/\\;/g, "")).not.toContain(";"); // every ; in a text value is escaped
  });
  it("CSV has a header and one row per tranche with the red flag and reason", () => {
    const rows = toCSV(p).trim().split("\n");
    expect(rows[0]).toBe("day,date,tokens,usd,red,reason,est_cost_usd,cost_model");
    expect(rows).toHaveLength(p.days + 1);
    expect(rows[1]).toMatch(/^1,2026-09-16,[\d.]+,[\d.]+,yes,"Exchange net deposits \+\$877,893",[\d.]+,constant-product$/);
  });
  it("an empty plan exports an empty calendar without throwing", () => {
    const empty = computePlan(pepeFacts({ totalBuy7dUsd: 0, uniqueBuyers7d: 0 }), { chain: "ethereum", token: "PEPE", amount: 1 }, RESOLVED, NOW);
    expect(toICS(empty)).not.toContain("VEVENT");
    expect(toCSV(empty).trim().split("\n")).toHaveLength(1);
  });
});
