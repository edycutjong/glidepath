"use client";
import type { PlanResult } from "@glidepath/core";
import { PlanCards, usd } from "./PlanCards";

export const FIXTURE_COUNT = 13;

export type ExamplePlan = { plan: PlanResult; file: string; label: string };

/**
 * The empty state shows the payoff before anyone types: the PEPE plan recorded live on 2026-09-16 and replayed from
 * fixtures/0X6982508145--ETHEREUM.json — 0 credits, labelled as an example. "Run it live now" replaces it with a live plan.
 */
export function Example({ example, onRun }: { example: ExamplePlan; onRun: (x: ExamplePlan) => void }) {
  const p = example.plan;
  return (
    <section className="example" aria-labelledby="example-h">
      <div className="example-head">
        <div>
          <h2 id="example-h">
            <span className="kicker">example</span> {p.resolved.symbol} — {p.input.amount.toLocaleString("en-US")} tokens on {p.input.chain}, {example.label}
          </h2>
          <p className="example-sub">
            {p.calls} Nansen calls · recorded {p.computedAt.slice(0, 10)} · replayed from <code>fixtures/{example.file}</code> · 0 credits · <code>{p.hash.slice(0, 12)}</code>
          </p>
        </div>
        <button className="btn primary" onClick={() => onRun(example)}>
          Run it live now
        </button>
      </div>
      <PlanCards p={p} compact />
      <p className="example-more">
        + the provenance drawer, ICS and CSV in the live run · {usd(p.positionUsd)} position · {FIXTURE_COUNT}/{FIXTURE_COUNT} recorded plans reproduce offline
      </p>
    </section>
  );
}

export function HowItDecides() {
  // the endpoints packages/core/src/nansen.ts calls; credits from client.ts CREDITS / docs/SCORING.md
  const steps = [
    { ep: "search/general", cr: "0 cr", what: "ticker → the contract on the chosen chain", decides: "which token (skipped for an address)" },
    { ep: "tgm/token-information", cr: "1 cr", what: "price, 7-day DEX buy volume, liquidity", decides: "position value, the 1 % liquidity cap" },
    { ep: "tgm/who-bought-sold", cr: "1 cr × 2", what: "7-day buys by Smart Money / Fund / Whale / Exchange / bot wallets", decides: "organic/day = total − pros" },
    { ep: "tgm/indicators", cr: "5 cr", what: "liquidity, concentration, BTC-reflexivity risk scores", decides: "the pace k, 10 % → 3 %" },
    { ep: "tgm/flow-intelligence", cr: "1 cr × 2", what: "Smart Money and exchange net flow, 1d and 7d", decides: "is today red → first tranche halved" },
    { ep: "tgm/flows", cr: "1 cr × 2", what: "daily Smart Money and exchange cohort flows, 14d", decides: "the red-day history and rate" },
    { ep: "trade/quote", cr: "1 cr × 3", what: "a real route for one tranche and the whole bag", decides: "the cost on solana/base; else constant-product" },
  ];
  return (
    <section className="how" aria-labelledby="how-h">
      <h2 id="how-h">How it decides — seven Nansen endpoints, 12 credits a plan</h2>
      <ol className="how-grid">
        {steps.map((s, i) => (
          <li key={s.ep} className="how-step">
            <span className="how-n">{i + 1}</span>
            <code className="how-ep">
              {s.ep.split(/(?<=[/-])/).map((part, j) => (
                <span key={j}>
                  {part}
                  <wbr />
                </span>
              ))}
            </code>
            <span className="how-cr">{s.cr}</span>
            <p>{s.what}</p>
            <p className="how-decides">→ {s.decides}</p>
          </li>
        ))}
      </ol>
      <ul className="proof-row" aria-label="proof">
        <li>
          <b>12</b> credits per plan · <b>15</b> with route quotes
        </li>
        <li>
          <b>3.5 s</b> cold p50 · <b>5 ms</b> warm
        </li>
        <li>
          <b>13/13</b> plans replay offline
        </li>
        <li>
          <b>258</b> tests · <b>60,000</b> property cases
        </li>
      </ul>
    </section>
  );
}
