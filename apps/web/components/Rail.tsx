"use client";
import { useEffect, useRef, useState } from "react";
import type { Call, PlanResult } from "@glidepath/core";

/**
 * The Nansen call rail — the live meter beside the page. Every row is a real call from the engine's own provenance
 * stream (`/api/plan?stream=1`, the same `Call` objects the drawer prints): pending when it leaves, green when Nansen
 * answers, grey when the cache did, red when it failed. The recorded example on load shows its replayed calls at
 * 0 credits so the empty page already demonstrates the shape. Nothing here is synthetic.
 */
export type RailState = "pending" | "live" | "cached" | "error" | "replayed";
export type RailRow = {
  key: string;
  state: RailState;
  method: string;
  endpoint: string;
  params: string;
  credits: number;
  /** null while pending */
  ms: number | null;
  hash: string;
  status: number;
  error?: string;
  /** wall time incl. failed attempts (a failed row shows this, its `ms` is 0) */
  totalMs: number;
  startedAt: number;
};
/** the batch the header counters describe: the run in flight, or the last one that landed */
export type RailBatch = { kind: "replayed" | "running" | "done" | "shared"; calls: number; credits: number; ms: number | null; startedAt: number };

export const RAIL_CAP = 200;

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** One line of parameters — the distinguishing part first (timeframe, cohort, page), then token · chain; never the key, never a body. */
export function summarize(body: Record<string, unknown>, term: string): string {
  const head: string[] = [];
  if (typeof body.search_query === "string") head.push(`“${body.search_query}”`);
  const f = body.filters as { include_smart_money_labels?: unknown; exclude_smart_money_labels?: unknown } | undefined;
  if (f?.include_smart_money_labels) head.push("pros");
  else if (f?.exclude_smart_money_labels) head.push("organic");
  if (typeof body.buy_or_sell === "string") head.push(`${body.buy_or_sell.toLowerCase()} 7d`);
  if (typeof body.timeframe === "string") head.push(body.timeframe);
  if (typeof body.label === "string") head.push(body.label.replace("_", " "));
  const date = body.date as { from?: string; to?: string } | undefined;
  if (date?.from && date?.to && !body.buy_or_sell) {
    const days = Math.floor((Date.parse(date.to) - Date.parse(date.from)) / 86_400_000);
    if (days > 0) head.push(`${days}d`);
  }
  const pg = body.pagination as { page?: number } | undefined;
  if (pg?.page && pg.page > 1) head.push(`page ${pg.page}`);
  if (typeof body.amount === "string" && typeof body.from_token === "string") head.push(`route · ${short(String(body.from_token))}`);
  const tail: string[] = [];
  if (term) tail.push(term);
  else if (typeof body.token_address === "string") tail.push(short(body.token_address));
  if (typeof body.chain === "string") tail.push(body.chain);
  return [...head, ...tail].join(" · ");
}

export function rowFromCall(c: Call, key: string, term: string, replayed: boolean, startedAt = Date.now()): RailRow {
  return {
    key,
    state: replayed ? "replayed" : !c.ok ? "error" : c.cached ? "cached" : "live",
    method: c.method,
    endpoint: c.endpoint,
    params: summarize(c.body, term),
    credits: replayed ? 0 : c.credits,
    ms: c.cached ? 0 : c.ms,
    hash: c.responseHash,
    status: c.status,
    error: c.error,
    totalMs: c.totalMs,
    startedAt,
  };
}

/** Rows for a finished plan (the recorded example, or the share page's server-side run). */
export function rowsFromPlan(p: PlanResult, batchKey: string, replayed: boolean): RailRow[] {
  const term = p.resolved.symbol || p.input.token;
  return p.provenance.map((c, i) => rowFromCall(c, `${batchKey}-${i}`, term, replayed));
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Count-up 240 ms on change (§13 A3); reduced motion = jump. */
function useCountUp(target: number, ms = 240): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (reducedMotion() || fromRef.current === target) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    const from = fromRef.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return shown;
}

const fmtMs = (ms: number) => (ms >= 10_000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

export function Rail({ rows, batch, onClear }: { rows: RailRow[]; batch: RailBatch | null; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const listRef = useRef<HTMLOListElement>(null);
  const running = batch?.kind === "running";

  // the pending rows' elapsed ms and the header clock tick while a run is in flight
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);

  // oldest at top, newest in view
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, open]);

  const landed = rows.filter((r) => r.state !== "pending");
  const sessionCalls = landed.length;
  const sessionCredits = landed.reduce((n, r) => n + r.credits, 0);
  const batchCalls = useCountUp(batch?.calls ?? 0);
  const batchCredits = useCountUp(batch?.credits ?? 0);
  const clock = !batch ? "" : batch.kind === "replayed" ? "replayed" : batch.ms != null ? `${(batch.ms / 1000).toFixed(1)} s` : `${((now - batch.startedAt) / 1000).toFixed(1)} s`;

  return (
    <aside className={`rail ${open ? "open" : ""}`} aria-label="Nansen API calls" aria-live="polite">
      <button type="button" className="rail-bar" aria-expanded={open} aria-controls="rail-body" onClick={() => setOpen((o) => !o)}>
        <span className="kicker">Nansen API</span>
        <span className="rail-bar-text">
          Nansen calls · <b>{sessionCalls}</b> · <b>{sessionCredits}</b> cr
        </span>
        <span className="rail-caret" aria-hidden />
      </button>
      <div className="rail-body" id="rail-body">
        <div className="rail-head">
          <span className="kicker">Nansen API</span>
          <b className="rail-title">Live call log</b>
          {/* the animated digits and the ticking clock are aria-hidden: the live region reads the settled numbers once */}
          <span className={`rail-counters ${running ? "live" : ""}`}>
            <span aria-hidden>
              <b>{batchCalls}</b> calls · <b>{batchCredits}</b> cr{clock ? ` · ${clock}` : ""}
            </span>
            <span className="sr-only">{running ? "running" : `${batch?.calls ?? 0} calls, ${batch?.credits ?? 0} credits${clock ? `, ${clock}` : ""}`}</span>
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="rail-empty">
            No calls yet — run the example live.
            <small>Every Nansen call this page makes lands here as it happens: endpoint, credits, latency.</small>
          </p>
        ) : (
          <ol className="rail-rows" ref={listRef}>
            {rows.map((r) => (
              <li key={r.key} className={`rail-row ${r.state}`} title={r.error ? `${r.status ? `HTTP ${r.status}` : "network"}: ${r.error}` : r.hash ? `sha256 ${r.hash}` : undefined}>
                <i className="rail-dot" aria-hidden />
                <span className="rail-l1">
                  <span className="rail-ep">
                    <span className="rail-method">{r.method}</span> {r.endpoint}
                  </span>
                  <span className="rail-ms" aria-hidden={r.state === "pending" || undefined}>
                    {r.state === "pending" ? fmtMs(Math.max(0, now - r.startedAt)) : r.state === "cached" ? "0 ms" : r.state === "error" ? fmtMs(r.totalMs) : r.ms ? fmtMs(r.ms) : "—"}
                  </span>
                </span>
                <span className="rail-l2">
                  <span className="rail-params">
                    {r.params}
                    {r.error ? <span className="rail-err"> — {r.error}</span> : null}
                  </span>
                  <span className="rail-right">
                    <span className="rail-cr">
                      {r.state === "pending"
                        ? "pending"
                        : r.state === "replayed"
                          ? "replayed · 0 cr"
                          : r.state === "cached"
                            ? "0 cr · cached"
                            : r.state === "error"
                              ? `0 cr · ${r.status ? `HTTP ${r.status}` : "failed"}`
                              : `${r.credits} cr`}
                    </span>
                    {r.hash ? (
                      <span className="rail-hash">
                        <span className="rail-method">sha256</span> {r.hash.slice(0, 4)}…
                      </span>
                    ) : null}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="rail-foot">
          <span>
            session · <b>{sessionCalls}</b> calls · <b>{sessionCredits}</b> credits
          </span>
          <span className="rail-foot-links">
            <a href="https://github.com/edycutjong/glidepath#-nansen-integration" target="_blank" rel="noreferrer">
              same calls: <code>--explain</code> in the CLI
            </a>
            {rows.length > 0 && (
              <button type="button" className="rail-clear" onClick={onClear}>
                clear
              </button>
            )}
          </span>
        </div>
      </div>
    </aside>
  );
}
