"use client";
import type { PlanResult } from "@glidepath/core";

/** Provenance: every Nansen call behind the plan — endpoint, fields used, credits from the response headers, cached or live, ms. */
export function Drawer({ p, open, onClose }: { p: PlanResult | null; open: boolean; onClose: () => void }) {
  const calls = p?.provenance ?? [];
  return (
    <aside className={`drawer ${open ? "open" : ""}`} aria-hidden={!open} aria-label="every Nansen call behind this plan">
      <h3>
        Every Nansen call behind this plan{" "}
        <button className="btn" onClick={onClose} tabIndex={open ? 0 : -1}>
          close
        </button>
      </h3>
      <table>
        <thead>
          <tr>
            <th>endpoint</th>
            <th>fields used</th>
            <th>credits</th>
            <th>source</th>
            <th>ms</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={i} className={c.ok ? "" : "fail"}>
              <td className="mono">
                {c.method} {c.endpoint}
                {c.body.timeframe ? ` ${String(c.body.timeframe)}` : ""}
                {c.body.label ? ` ${String(c.body.label)}` : ""}
                {(c.body.filters as { include_smart_money_labels?: unknown } | undefined)?.include_smart_money_labels
                  ? " (pros)"
                  : (c.body.filters as { exclude_smart_money_labels?: unknown } | undefined)?.exclude_smart_money_labels
                    ? " (organic)"
                    : ""}
              </td>
              <td className="tiny">{c.fieldsUsed.join(", ")}</td>
              <td>{c.credits}</td>
              <td>{c.ok ? (c.cached ? "cache" : "live") : `failed: ${c.error}`}</td>
              <td>{c.cached ? "—" : c.ms}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p && (
        <p className="sum">
          {p.credits} credits · {p.calls} calls{p.cachedCalls ? ` (${p.cachedCalls} cached)` : ""} · {(p.ms / 1000).toFixed(1)} s · plan {p.hash.slice(0, 12)}
        </p>
      )}
    </aside>
  );
}
