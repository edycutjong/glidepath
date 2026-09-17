import { describe, it, expect } from "vitest";
import { fetchFacts } from "../src/facts";
import { fakeClient, PEPE, NOW } from "./helpers";

/** filters.include_smart_money_labels marks the pro-buyers call; filters.exclude_smart_money_labels marks organic-breadth. */
const isProBuyers = (body: Record<string, unknown>) => !!(body.filters as Record<string, unknown> | undefined)?.include_smart_money_labels;

describe("fetchFacts — every upstream call fails", () => {
  it("every derived field is null, proLabels is [], and errors records timeout / a non-Error throw / a message per term", async () => {
    const client = fakeClient((endpoint, body) => {
      if (endpoint === "tgm/token-information") {
        const e = new Error("deadline exceeded");
        e.name = "AbortError";
        throw e; // errMsg: Error + AbortError -> "timeout"
      }
      if (endpoint === "tgm/who-bought-sold") {
        if (isProBuyers(body)) throw "boom"; // errMsg: non-Error -> String(e)
        throw new Error("organic breadth exploded"); // errMsg: Error -> message.slice
      }
      if (endpoint === "tgm/flow-intelligence") throw new Error("flow intelligence down");
      if (endpoint === "tgm/flows") throw new Error("flows down");
      if (endpoint === "tgm/indicators") throw new Error("indicators down");
      throw new Error(`unexpected endpoint ${endpoint}`);
    });

    const facts = await fetchFacts(client, "ethereum", PEPE, NOW);

    expect(facts.symbol).toBeNull();
    expect(facts.name).toBeNull();
    expect(facts.logo).toBeNull();
    expect(facts.deployedAt).toBeNull();
    expect(facts.marketCapUsd).toBeNull();
    expect(facts.circulatingSupply).toBeNull();
    expect(facts.fdvUsd).toBeNull();
    expect(facts.totalSupply).toBeNull();
    expect(facts.liquidityUsd).toBeNull();
    expect(facts.totalHolders).toBeNull();
    expect(facts.totalBuy7dUsd).toBeNull();
    expect(facts.uniqueBuyers7d).toBeNull();

    expect(facts.proBuy7dUsd).toBeNull();
    expect(facts.proBuyers).toBeNull();
    expect(facts.proPages).toBeNull();
    expect(facts.proLabels).toEqual([]);

    expect(facts.organicPage1Usd).toBeNull();
    expect(facts.organicPage1Rows).toBeNull();
    expect(facts.organicTop10Usd).toBeNull();
    expect(facts.organicTop1Usd).toBeNull();

    expect(facts.smNet1dUsd).toBeNull();
    expect(facts.exNet1dUsd).toBeNull();
    expect(facts.whaleNet1dUsd).toBeNull();
    expect(facts.smWallets1d).toBeNull();
    expect(facts.smNet7dUsd).toBeNull();
    expect(facts.exNet7dUsd).toBeNull();

    expect(facts.history).toBeNull();
    expect(facts.flowsPriceUsd).toBeNull();
    expect(facts.indicatorScores).toBeNull();
    expect(facts.marketCapGroup).toBeNull();
    expect(facts.isStablecoin).toBeNull();

    expect(facts.errors["token-information"]).toBe("timeout");
    expect(facts.errors["pro-buyers"]).toBe("boom");
    expect(facts.errors["organic-breadth"]).toBe("organic breadth exploded");
    expect(facts.errors["flow-1d"]).toBe("flow intelligence down");
    expect(facts.errors["flow-7d"]).toBe("flow intelligence down");
    expect(facts.errors["flows-smart-money"]).toBe("flows down");
    expect(facts.errors["flows-exchange"]).toBe("flows down");
    expect(facts.errors["indicators"]).toBe("indicators down");
  });
});

describe("fetchFacts — organic breadth rows without bought_volume_usd", () => {
  it("treats a missing bought_volume_usd as zero in both the running total and the top-N sort", async () => {
    const client = fakeClient((endpoint, body) => {
      if (endpoint === "tgm/who-bought-sold" && !isProBuyers(body)) {
        return {
          data: [{ address: "0xA", address_label: null }, { address: "0xB" }, { address: "0xC", address_label: "x" }],
          pagination: { page: 1, per_page: 1000, is_last_page: true },
        };
      }
      throw new Error(`${endpoint} not needed for this test`);
    });

    const facts = await fetchFacts(client, "ethereum", PEPE, NOW);

    expect(facts.organicPage1Rows).toBe(3);
    expect(facts.organicPage1Usd).toBe(0);
    expect(facts.organicTop10Usd).toBe(0);
    expect(facts.organicTop1Usd).toBe(0);
    expect(facts.errors["organic-breadth"]).toBeUndefined();
  });
});

describe("fetchFacts — mergeHistory, one side missing entirely", () => {
  it("smart-money flow failed, exchange flow alone drives history (smNetUsd stays null)", async () => {
    const client = fakeClient((endpoint, body) => {
      if (endpoint === "tgm/flows") {
        if (body.label === "smart_money") throw new Error("smart money flow down");
        return {
          data: [{ date: "2026-09-10", price_usd: 1.5, total_inflows_count: 10, total_outflows_count: 5, is_complete: true }],
          pagination: { is_last_page: true },
        };
      }
      throw new Error(`${endpoint} not needed for this test`);
    });

    const facts = await fetchFacts(client, "ethereum", PEPE, NOW);

    expect(facts.errors["flows-smart-money"]).toBe("smart money flow down");
    expect(facts.history).not.toBeNull();
    expect(facts.history).toHaveLength(1);
    expect(facts.history![0]).toEqual({ date: "2026-09-10", complete: true, priceUsd: 1.5, smNetUsd: null, exNetUsd: 22.5 });
  });

  it("exchange flow failed, smart-money flow alone drives history (exNetUsd stays null)", async () => {
    const client = fakeClient((endpoint, body) => {
      if (endpoint === "tgm/flows") {
        if (body.label === "exchange") throw new Error("exchange flow down");
        return {
          data: [{ date: "2026-09-10", price_usd: 2, total_inflows_count: 4, total_outflows_count: 6, is_complete: true }],
          pagination: { is_last_page: true },
        };
      }
      throw new Error(`${endpoint} not needed for this test`);
    });

    const facts = await fetchFacts(client, "ethereum", PEPE, NOW);

    expect(facts.errors["flows-exchange"]).toBe("exchange flow down");
    expect(facts.history).not.toBeNull();
    expect(facts.history).toHaveLength(1);
    expect(facts.history![0]).toEqual({ date: "2026-09-10", complete: true, priceUsd: 2, smNetUsd: 20, exNetUsd: null });
  });
});

describe("fetchFacts — mergeHistory, both sides present with gaps", () => {
  it("a null-priced smart-money day borrows the exchange price for that date, and missing in/outflow counts count as zero", async () => {
    const client = fakeClient((endpoint, body) => {
      if (endpoint === "tgm/flows") {
        if (body.label === "smart_money") {
          return {
            data: [
              { date: "2026-09-10", price_usd: null, total_inflows_count: 100, total_outflows_count: 50, is_complete: true },
              { date: "2026-09-11", price_usd: 2, is_complete: true }, // total_inflows_count / total_outflows_count both missing
            ],
            pagination: { is_last_page: true },
          };
        }
        return {
          data: [
            { date: "2026-09-10", price_usd: 5, total_inflows_count: 10, total_outflows_count: 10, is_complete: true },
            { date: "2026-09-12", price_usd: null, total_inflows_count: 5, total_outflows_count: 5, is_complete: true },
          ],
          pagination: { is_last_page: true },
        };
      }
      throw new Error(`${endpoint} not needed for this test`);
    });

    const facts = await fetchFacts(client, "ethereum", PEPE, NOW);

    expect(facts.history).not.toBeNull();
    const byDate = Object.fromEntries(facts.history!.map((d) => [d.date, d]));
    // 2026-09-10: smart-money had no price, so the merged day borrows exchange's price.
    expect(byDate["2026-09-10"]).toEqual({ date: "2026-09-10", complete: true, priceUsd: 5, smNetUsd: null, exNetUsd: 100 });
    // 2026-09-11: smart-money only, missing counts fall back to 0 so smNetUsd is 0, not NaN/null.
    expect(byDate["2026-09-11"]).toEqual({ date: "2026-09-11", complete: true, priceUsd: 2, smNetUsd: 0, exNetUsd: null });
    // 2026-09-12: exchange only, no price at all -> exNetUsd stays null.
    expect(byDate["2026-09-12"]).toEqual({ date: "2026-09-12", complete: true, priceUsd: null, smNetUsd: null, exNetUsd: null });
  });
});

describe("fetchFacts — indicators payload missing the risk/reward arrays", () => {
  it("every tracked risk indicator score falls back to null instead of throwing", async () => {
    const client = fakeClient((endpoint) => {
      if (endpoint === "tgm/indicators") return {}; // no token_info, no risk_indicators, no reward_indicators
      throw new Error(`${endpoint} not needed for this test`);
    });

    const facts = await fetchFacts(client, "ethereum", PEPE, NOW);

    expect(facts.indicatorScores).toEqual({ "liquidity-risk": null, "concentration-risk": null, "btc-reflexivity": null });
    expect(facts.marketCapGroup).toBeNull();
    expect(facts.isStablecoin).toBeNull();
    expect(facts.errors["indicators"]).toBeUndefined();
  });
});
