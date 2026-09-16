"use client";
import { useEffect, useState } from "react";
import type { PlanResult } from "@glidepath/core";

export const usd = (v: number | null | undefined, d = 0) => (v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
export const tok = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toPrecision(4));
export const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const md = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Age({ asOf, computedAt }: { asOf: string | null; computedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ref = asOf ?? computedAt;
  const s = Math.max(0, Math.round((now - Date.parse(ref)) / 1000));
  const label = s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
  return <span className="badge" title={asOf ? "oldest cached Nansen response used by this plan" : "every call was live"}>{asOf ? "computed" : "live"} {label}</span>;
}

export function PlanView({ p, exportBase }: { p: PlanResult; exportBase: string }) {
  const o = p.organic;
  const maxUsd = Math.max(1, ...p.tranches.map((t) => t.usd));
  const showTranches = p.tranches.slice(0, 60);
  const modelLabel = (m: string | null) => (m === "route-quote" ? "route quote via Nansen trade/quote" : m === "constant-product" ? `constant-product estimate from ${usd(p.liquidityUsd)} liquidity` : "no impact model (liquidity unavailable)");
  const cta = p.status === "ok" || p.status === "thin";

  return (
    <section className="plan">
      <header className="plan-head">
        <div>
          <h2>{p.resolved.symbol} <span className="muted">on {p.input.chain}</span></h2>
          <div className="mono tiny muted">{p.resolved.address || p.input.token}</div>
        </div>
        <Age asOf={p.asOf} computedAt={p.computedAt} />
      </header>

      {p.status === "not-found" ? (
        <div className="state warn"><strong>Not found.</strong> {p.statusReason}{p.warnings.length ? <ul>{p.warnings.map((w) => <li key={w} className="mono tiny">{w}</li>)}</ul> : null}</div>
      ) : (
        <>
          <div className="dump">
            <div className="dump-main">
              <span className="label">Dump today</span>
              <strong>{usd(p.dumpToday.usd)}</strong>
              <span>est. impact <b className="red">{usd(p.dumpToday.costUsd, 2)}</b></span>
              {p.dumpToday.shareOfOrganicDay != null && <span>you would be <b>{pct(p.dumpToday.shareOfOrganicDay, p.dumpToday.shareOfOrganicDay < 0.01 ? 1 : 0)}</b> of a full day&apos;s organic buys</span>}
            </div>
            <div className="tiny muted">{modelLabel(p.dumpToday.model)}{p.dumpToday.priceImpactPct != null ? ` · route impact ${Math.abs(p.dumpToday.priceImpactPct)}%` : ""} · price {p.price.usd == null ? "—" : `$${p.price.usd.toPrecision(4)}`} ({p.price.source})</div>
          </div>

          <div className="facts">
            <div><span className="label">Organic buys</span><strong>{usd(o.organicDailyUsd)}/day</strong><span className="tiny muted">= ({usd(o.totalBuy7dUsd)} DEX buys, 7d − {usd(o.proBuy7dUsd)} by Smart Money / Fund / Whale / Exchange / bot users, {o.proBuyers ?? "?"} wallets) ÷ 7 · {pct(o.organicShare)} organic · {o.organicBuyers ?? "?"} buyers</span></div>
            <div><span className="label">Pace</span><strong>{(p.risk.k * 100).toFixed(1)}% of organic/day</strong><span className="tiny muted">risk dial: {Object.entries(p.risk.scores).map(([k, v]) => `${k} ${v ?? "missing"}`).join(" · ")}{p.risk.concentrated ? " · single-buyer dependence" : ""}{p.trancheCapReason === "liquidity" ? " · capped at 1% of liquidity" : ""}</span></div>
            <div><span className="label">Today {md(p.today.date)}</span><strong className={p.today.red ? "red" : "green"}>{p.today.red ? `RED — ${p.today.reason}` : "green"}</strong><span className="tiny muted">Smart Money net {usd(p.today.smNetUsd)} · exchange net {usd(p.today.exNetUsd)} · red if SM &lt; −{usd(p.today.theta.smUsd)} or exchange deposits &gt; {usd(p.today.theta.exUsd)}{p.regime.red ? ` · 7-day regime: ${p.regime.reason}` : " · 7-day regime: normal"}</span></div>
          </div>

          {p.status === "no-organic-demand" || p.status === "no-price" ? (
            <div className="state warn"><strong>No glidepath.</strong> {p.statusReason}</div>
          ) : (
            <>
              <div className="calendar">
                <div className="cal-row history" aria-label="last 14 days">
                  {p.history.map((h) => (
                    <div key={h.date} className={`hday ${!h.complete ? "partial" : h.red ? "red" : "green"}`} title={`${h.date}: ${h.red ? h.reason : "green"} · SM ${usd(h.smNetUsd)} · exchange ${usd(h.exNetUsd)}`}>
                      <span className="hd">{md(h.date).split(" ")[1]}</span>
                    </div>
                  ))}
                  <div className={`hday today ${p.today.red ? "red" : "green"}`} title={`today ${p.today.date}: ${p.today.red ? p.today.reason : "green"} (live, flow-intelligence 1d)`}><span className="hd">now</span></div>
                  {p.history.length > 0 && <div className="hlegend tiny muted">{p.redDays} red of {p.completeDays} days before today · today from live 1d flows</div>}
                  {p.history.length === 0 && <div className="tiny muted">14-day cohort history unavailable</div>}
                </div>
                <div className="cal-row tranches">
                  {showTranches.map((t, i) => (
                    <div key={t.day} className={`tranche ${t.red ? "red" : ""}`} style={{ animationDelay: `${Math.min(i, 30) * 60}ms` }} title={`${t.date}: sell ${tok(t.tokens)} ${p.resolved.symbol} ≈ ${usd(t.usd)}${t.red ? ` — ${t.reason}, halved` : ""} · est. cost ${usd(t.costUsd, 2)}`}>
                      <div className="bar" style={{ height: `${Math.max(6, (t.usd / maxUsd) * 100)}%` }} />
                      <div className="td">{md(t.date)}</div>
                      <div className="tu">{usd(t.usd)}</div>
                      {t.red && <div className="tag">{t.reason}</div>}
                    </div>
                  ))}
                  {p.tranches.length > showTranches.length && <div className="more tiny muted">+{p.tranches.length - showTranches.length} more days</div>}
                </div>
              </div>

              <div className="cost">
                <span className="label">Glidepath</span>
                <strong>{p.days} tranche{p.days === 1 ? "" : "s"}</strong>
                <span>est. cost <b className="green">{usd(p.glidepath.costUsd, 2)}</b> vs <b className="red">{usd(p.dumpToday.costUsd, 2)}</b> dumping today</span>
                {p.days === 1 ? <span className="muted">· fits in one day — no split needed</span> : p.savingsUsd != null && p.savingsUsd > 0 && <span>· saves <b>{usd(p.savingsUsd, 2)}</b></span>}
                {p.redRate != null && p.redRate > 0 && <span className="muted">· expect ~{p.expectedDays} days at the {pct(p.redRate, 0)} red-day rate</span>}
                <div className="tiny muted">{modelLabel(p.glidepath.model)}{p.glidepath.priceImpactPct != null ? ` · one tranche ${Math.abs(p.glidepath.priceImpactPct)}% route impact` : ""}</div>
              </div>
              {p.truncated && <div className="state warn">{p.statusReason}</div>}
            </>
          )}

          {p.warnings.length > 0 && <ul className="warnings">{p.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
          {Object.keys(p.errors).length > 0 && <ul className="warnings errors">{Object.entries(p.errors).map(([k, v]) => <li key={k}><b>{k}</b> failed: {v}</li>)}</ul>}

          {cta && (
            <div className="actions">
              <a className="btn" href={`${exportBase}&format=ics`} download>Add to calendar (.ics)</a>
              <a className="btn ghost" href={`${exportBase}&format=csv`} download>Download CSV</a>
              <a className="btn ghost" href={`/p?chain=${p.input.chain}&token=${encodeURIComponent(p.resolved.address || p.input.token)}&amount=${p.input.amount}`}>Share card</a>
            </div>
          )}
        </>
      )}

      <details className="prov">
        <summary>Provenance — {p.calls} Nansen calls · {p.credits} credits{p.cachedCalls ? ` · ${p.cachedCalls} cached` : ""} · {(p.ms / 1000).toFixed(1)} s · plan <span className="mono">{p.hash.slice(0, 12)}</span></summary>
        <table>
          <thead><tr><th>endpoint</th><th>fields used</th><th>credits</th><th>source</th><th>ms</th></tr></thead>
          <tbody>
            {p.provenance.map((c, i) => (
              <tr key={i} className={c.ok ? "" : "fail"}>
                <td className="mono">{c.method} {c.endpoint}{c.body.timeframe ? ` ${String(c.body.timeframe)}` : ""}{c.body.label ? ` ${String(c.body.label)}` : ""}{(c.body.filters as { include_smart_money_labels?: unknown } | undefined)?.include_smart_money_labels ? " (pros)" : (c.body.filters as { exclude_smart_money_labels?: unknown } | undefined)?.exclude_smart_money_labels ? " (organic)" : ""}</td>
                <td className="tiny">{c.fieldsUsed.join(", ")}</td>
                <td>{c.credits}</td>
                <td>{c.ok ? (c.cached ? "cache" : "live") : `failed: ${c.error}`}</td>
                <td>{c.cached ? "—" : c.ms}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}
