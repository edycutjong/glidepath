import { describe, it, expect } from "vitest";
import { toICS, toCSV } from "../src/export.js";
import { computePlan } from "../src/plan.js";
import { pepeFacts, RESOLVED, NOW } from "./helpers.js";

const p = computePlan(pepeFacts({ exNet1dUsd: 877_893 }), { chain: "ethereum", token: "PEPE", amount: 12_000_000_000 }, RESOLVED, NOW);

describe("exports", () => {
  it("ICS has one all-day VEVENT per tranche with the go/no-go rule and escaped commas", () => {
    const ics = toICS(p);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(p.days);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260916");
    expect(ics).toContain("SUMMARY:Sell ");
    expect(ics).toMatch(/red day\\, halved/);
    expect(ics).toMatch(/Rule before selling: re-run glidepath/);
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
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
