"use client";
import { useEffect, useState } from "react";
import type { PlanResult } from "@glidepath/core";

export const usd = (v: number | null | undefined, d = 0) => (v == null ? "—" : `$${v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
export const tok = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toPrecision(4));
export const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
export const md = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
const signed = (v: number | null | undefined) => (v == null ? "—" : `${v < 0 ? "−" : "+"}${usd(Math.abs(v))}`);
const compactUsd = (v: number | null | undefined) => (v == null ? "—" : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : usd(v));

/** "live 4s ago" / "computed 3 min ago" — null until mounted: the share page is server-rendered and a server clock would hydrate to a mismatch. */
export function Age({ asOf, computedAt }: { asOf: string | null; computedAt: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ref = asOf ?? computedAt;
  const title = asOf ? "oldest cached Nansen response used by this plan" : "every call was live";
  if (now == null)
    return (
      <span className="badge muted" title={title}>
        {asOf ? "computed" : "live"}
      </span>
    );
  const s = Math.max(0, Math.round((now - Date.parse(ref)) / 1000));
  const label = s < 90 ? `${s}s ago` : s < 5400 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago`;
  return (
    <span className="badge muted" title={title}>
      {asOf ? "computed" : "live"} {label}
    </span>
  );
}

export const modelLabel = (p: PlanResult, m: string | null) =>
  m === "route-quote"
    ? "route quote via Nansen trade/quote"
    : m === "constant-product"
      ? `constant-product estimate from ${compactUsd(p.liquidityUsd)} liquidity`
      : "no impact model (liquidity unavailable)";

/** The calendar: 13 complete days from tgm/flows (red = the cohort rule fired), then live today from flow-intelligence 1d. */
export function Strip({ p }: { p: PlanResult }) {
  return (
    <div className="strip" aria-label="the last 13 days and today">
      {p.history.map((h) => (
        <span
          key={h.date}
          className={`hday ${!h.complete ? "partial" : h.red ? "red" : ""}`}
          title={`${h.date}: ${h.red ? h.reason : "green"} · SM ${signed(h.smNetUsd)} · exchange ${signed(h.exNetUsd)}`}
        >
          {md(h.date).split(" ")[1]}
        </span>
      ))}
      <span className={`hday today ${p.today.red ? "red" : ""}`} title={`today ${p.today.date}: ${p.today.red ? p.today.reason : "green"} (live, flow-intelligence 1d)`}>
        now
      </span>
      {p.history.length > 0 ? (
        <span className="strip-legend">
          {p.redDays} red of {p.completeDays} days before today · today from live 1d flows
        </span>
      ) : (
        <span className="strip-legend">14-day cohort history unavailable</span>
      )}
    </div>
  );
}

/** The tranche bars: one per dated sell, height = size; a red day is halved and carries the reason. */
export function Tranches({ p, compact }: { p: PlanResult; compact?: boolean }) {
  const shown = p.tranches.slice(0, compact ? 7 : 60);
  const max = Math.max(1, ...p.tranches.map((t) => t.usd));
  return (
    <div className={`tranches ${compact ? "compact" : ""}`} aria-label="tranches">
      {shown.map((t, i) => (
        <div
          key={t.day}
          className={`tranche ${t.red ? "red" : ""}`}
          style={{ animationDelay: `${Math.min(i, 30) * 60}ms` }}
          title={`${t.date}: sell ${tok(t.tokens)} ${p.resolved.symbol} ≈ ${usd(t.usd)}${t.red ? ` — ${t.reason}, halved` : ""} · est. cost ${usd(t.costUsd, 2)}`}
        >
          <div className="tbar" style={{ height: `${Math.max(6, (t.usd / max) * 100)}%` }} />
          <div className="td">{md(t.date)}</div>
          <div className="tu">{usd(t.usd)}</div>
          {t.red && <div className="tag">{t.reason}</div>}
        </div>
      ))}
      {p.tranches.length > shown.length && <div className="more">+{p.tranches.length - shown.length} more days</div>}
    </div>
  );
}

/**
 * The four cards a plan is made of: the plan itself (green — the answer), selling it all today (red), the organic
 * demand it is paced to, and today's colour. `compact` = the example: no age badge, ≤ 7 tranche bars.
 */
export function PlanCards({ p, compact }: { p: PlanResult; compact?: boolean }) {
  const o = p.organic;
  const hasPlan = p.status === "ok" || p.status === "thin";
  const hasNumbers = p.status !== "not-found";
  const addr = p.resolved.address || p.input.token;
  return (
    <div className="grid">
      {hasPlan && (
        <article className="card winner" aria-label={`the plan for ${p.resolved.symbol} on ${p.input.chain}`}>
          <div className="top">
            {/* token logos are arbitrary CDN URLs — a 36 px decorative <img> beats next/image's remotePatterns allow-list */}
            {p.resolved.logo ? <img className="logo" src={p.resolved.logo} alt="" /> : <span className="logo" aria-hidden />}
            <span className="name">
              {p.resolved.symbol} <span className="sym">{p.resolved.name !== p.resolved.symbol ? p.resolved.name : ""}</span>
            </span>
            <span className="badge chain">{p.input.chain}</span>
            <span className="badge real">
              {p.days} tranche{p.days === 1 ? "" : "s"}
            </span>
            {p.today.red && <span className="badge impostor">red today</span>}
            {!compact && <Age asOf={p.asOf} computedAt={p.computedAt} />}
          </div>
          <div className="addr">
            {p.input.amount.toLocaleString("en-US")} {p.resolved.symbol} · {compact ? short(addr) : <b>{addr}</b>}
          </div>
          <p className="headline">
            est. cost <b>{usd(p.glidepath.costUsd, 2)}</b> vs <b className="red">{usd(p.dumpToday.costUsd, 2)}</b> selling it all today
            {p.days === 1 ? " · fits in one day, no split needed" : p.savingsUsd != null && p.savingsUsd > 0 ? ` · saves ${usd(p.savingsUsd, 2)}` : ""}
          </p>
          <div className="facts">
            {p.trancheUsd != null && <span className="fact">{usd(p.trancheUsd)} per tranche</span>}
            <span className="fact">{(p.risk.k * 100).toFixed(1)}% of organic/day</span>
            {p.trancheCapReason === "liquidity" && <span className="fact">capped at 1% of liquidity</span>}
            {p.risk.concentrated && <span className="fact">single-buyer dependence</span>}
            {p.days > 1 && p.redRate != null && p.redRate > 0 && (
              <span className="fact">
                expect ~{p.expectedDays} days at the {pct(p.redRate, 0)} red-day rate
              </span>
            )}
            <span className="fact">{modelLabel(p, p.glidepath.model)}</span>
            {p.glidepath.priceImpactPct != null && <span className="fact">one tranche {Math.abs(p.glidepath.priceImpactPct)}% route impact</span>}
          </div>
          <Strip p={p} />
          <Tranches p={p} compact={compact} />
          {p.truncated && <p className="sub">{p.statusReason}</p>}
        </article>
      )}

      {hasNumbers && (
        <article className="card" aria-label="selling it all today">
          <div className="top">
            <span className="name">Selling it all today</span>
            <span className="badge impostor">dump</span>
          </div>
          <p className="big red">
            {usd(p.dumpToday.costUsd, 2)} <small>est. impact</small>
          </p>
          <div className="facts">
            <span className="fact">{usd(p.dumpToday.usd)} position</span>
            {p.dumpToday.shareOfOrganicDay != null && <span className="fact">{pct(p.dumpToday.shareOfOrganicDay, p.dumpToday.shareOfOrganicDay < 0.01 ? 1 : 0)} of a day&rsquo;s organic buys</span>}
            {p.dumpToday.priceImpactPct != null && <span className="fact">route impact {Math.abs(p.dumpToday.priceImpactPct)}%</span>}
          </div>
          <p className="sub">
            {modelLabel(p, p.dumpToday.model)} · price {p.price.usd == null ? "—" : `$${p.price.usd.toPrecision(4)}`} ({p.price.source})
          </p>
        </article>
      )}

      {hasNumbers && (
        <article className="card" aria-label="organic buys">
          <div className="top">
            <span className="name">Organic buys</span>
            <span className="badge chain">7d</span>
          </div>
          <p className="big green">
            {usd(o.organicDailyUsd)}
            <small>/day</small>
          </p>
          <div className="facts">
            <span className="fact">{pct(o.organicShare)} organic</span>
            <span className="fact">{o.organicBuyers ?? "?"} buyers</span>
            <span className="fact">
              {usd(o.proBuy7dUsd)} by {o.proBuyers ?? "?"} pro wallet{o.proBuyers === 1 ? "" : "s"}
            </span>
            {Object.entries(p.risk.scores).map(([k, v]) => (
              <span key={k} className="fact">
                {k} {v ?? "missing"}
              </span>
            ))}
          </div>
          <p className="sub">
            = ({usd(o.totalBuy7dUsd)} DEX buys, 7d − {usd(o.proBuy7dUsd)} by Smart Money / Fund / Whale / Exchange / bot users) ÷ 7 · risk dial → k {(p.risk.k * 100).toFixed(1)}%
          </p>
        </article>
      )}

      {hasNumbers && (
        <article className="card" aria-label={`today ${p.today.date}`}>
          <div className="top">
            <span className="name">Today · {md(p.today.date)}</span>
            <span className={`badge ${p.today.red ? "impostor" : "real"}`}>{p.today.red ? "red" : "green"}</span>
          </div>
          <p className={`big ${p.today.red ? "red" : "green"}`}>{p.today.red ? "first tranche halved" : "sell as planned"}</p>
          <div className="facts">
            <span className="fact">Smart Money net {signed(p.today.smNetUsd)}</span>
            <span className="fact">exchange net {signed(p.today.exNetUsd)}</span>
            {p.regime.red && <span className="fact">7-day regime: {p.regime.reason}</span>}
          </div>
          <p className="sub">
            {p.today.red ? `${p.today.reason} · ` : ""}red if Smart Money &lt; −{usd(p.today.theta.smUsd)} or exchange deposits &gt; {usd(p.today.theta.exUsd)}
            {p.regime.red ? "" : " · 7-day regime: normal"}
          </p>
        </article>
      )}
    </div>
  );
}
