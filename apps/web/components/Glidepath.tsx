"use client";
import { useCallback, useRef, useState } from "react";
import type { Call, PlanResult } from "@glidepath/core";
import { PlanCards, usd } from "./PlanCards";
import { Drawer } from "./Drawer";
import { Example, HowItDecides, type ExamplePlan } from "./Example";
import { Rail, rowFromCall, rowsFromPlan, summarize, RAIL_CAP, type RailBatch, type RailRow } from "./Rail";

export const CHAINS = [
  "ethereum",
  "solana",
  "base",
  "bnb",
  "arbitrum",
  "polygon",
  "optimism",
  "avalanche",
  "linea",
  "sonic",
  "sei",
  "sui",
  "ton",
  "tron",
  "hyperevm",
  "monad",
  "mantle",
  "starknet",
  "near",
  "injective",
  "plasma",
  "robinhood",
  "mantra",
  "iotaevm",
];
const EXAMPLES: Array<{ label: string; token: string; chain: string; amount: string }> = [
  { label: "PEPE · 12B (a $40K donation)", token: "PEPE", chain: "ethereum", amount: "12000000000" },
  { label: "BONK · 20B on solana", token: "BONK", chain: "solana", amount: "20000000000" },
  { label: "BRETT · 3M on base", token: "BRETT", chain: "base", amount: "3000000" },
  { label: "TURBO · 50M (thin)", token: "TURBO", chain: "ethereum", amount: "50000000" },
  { label: "SHIB2 · dead token", token: "0x2de7b02ae3b1f11d51ca7b2495e9094874a064c0", chain: "ethereum", amount: "100000000" },
];

type Phase = "idle" | "planning" | "done" | "error";

/** one NDJSON line from /api/plan?stream=1 */
type StreamLine =
  { t: "start"; id: number; method: string; endpoint: string; body: Record<string, unknown> } | { t: "call"; id: number; call: Call } | { t: "plan"; plan: PlanResult } | { t: "error"; error: string };

/** Read an NDJSON body line by line, calling `onLine` for each complete line as it arrives. */
async function readLines(body: ReadableStream<Uint8Array>, onLine: (line: StreamLine) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += dec.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) onLine(JSON.parse(line) as StreamLine);
    }
    if (done) break;
  }
  const tail = buf.trim();
  if (tail) onLine(JSON.parse(tail) as StreamLine);
}

export function Glidepath({
  initialToken,
  initialChain,
  initialAmount,
  initialPlan,
  example,
}: {
  initialToken?: string;
  initialChain?: string;
  initialAmount?: string;
  /** the share page: a server-rendered plan, shown as a finished run */
  initialPlan?: PlanResult | null;
  example?: ExamplePlan;
}) {
  const [token, setToken] = useState(initialToken ?? "");
  const [chain, setChain] = useState(initialChain && CHAINS.includes(initialChain) ? initialChain : "ethereum");
  const [amount, setAmount] = useState(initialAmount ?? "");
  const [phase, setPhase] = useState<Phase>(initialPlan ? "done" : "idle");
  const [plan, setPlan] = useState<PlanResult | null>(initialPlan ?? null);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // the call rail: the example's replayed calls on load (0 credits), the share page's server-side run, then every live run
  const [rail, setRail] = useState<RailRow[]>(() => (initialPlan ? rowsFromPlan(initialPlan, "shared", false) : example ? rowsFromPlan(example.plan, "example", true) : []));
  const [batch, setBatch] = useState<RailBatch | null>(() =>
    initialPlan
      ? { kind: "shared", calls: initialPlan.calls, credits: initialPlan.credits, ms: initialPlan.ms, startedAt: 0 }
      : example
        ? { kind: "replayed", calls: example.plan.calls, credits: 0, ms: null, startedAt: 0 }
        : null,
  );
  const batchNo = useRef(0);

  const run = useCallback(async (t: string, c: string, a: string) => {
    const term = t.trim();
    if (!term || !a.trim()) return;
    setPhase("planning");
    setError(null);
    setPlan(null);
    setDrawer(false);
    const b = `run${++batchNo.current}`;
    const startedAt = Date.now();
    setBatch({ kind: "running", calls: 0, credits: 0, ms: null, startedAt });
    const append = (row: RailRow) => setRail((rows) => [...rows, row].slice(-RAIL_CAP));
    const land = (id: number, call: Call) => {
      const key = `${b}-${id}`;
      setRail((rows) => {
        const i = rows.findIndex((r) => r.key === key);
        const row = rowFromCall(call, key, term, false, i >= 0 ? rows[i].startedAt : Date.now());
        if (i < 0) return [...rows, row].slice(-RAIL_CAP); // a cache hit was never pending
        const next = rows.slice();
        next[i] = row;
        return next;
      });
      setBatch((x) => (x && x.kind === "running" ? { ...x, calls: x.calls + 1, credits: x.credits + call.credits } : x));
    };
    try {
      const res = await fetch("/api/plan?stream=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: term, chain: c, amount: a }) });
      if (!res.ok || !res.body || !/x-ndjson/.test(res.headers.get("content-type") ?? "")) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      let result: PlanResult | null = null;
      await readLines(res.body, (line) => {
        if (line.t === "start")
          append({
            key: `${b}-${line.id}`,
            state: "pending",
            method: line.method,
            endpoint: line.endpoint,
            params: summarize(line.body, term),
            credits: 0,
            ms: null,
            hash: "",
            status: 0,
            totalMs: 0,
            startedAt: Date.now(),
          });
        else if (line.t === "call") land(line.id, line.call);
        else if (line.t === "plan") result = line.plan;
        else throw new Error(line.error);
      });
      if (!result) throw new Error("the stream ended before a plan arrived");
      const p: PlanResult = result;
      // the header counters take the plan's own totals — exactly what the drawer prints
      setBatch({ kind: "done", calls: p.calls, credits: p.credits, ms: p.ms, startedAt });
      setPlan(p);
      setPhase("done");
      window.history.replaceState(null, "", `/?token=${encodeURIComponent(term)}&chain=${c}&amount=${encodeURIComponent(a)}`);
    } catch (e) {
      setRail((rows) => rows.filter((r) => r.state !== "pending")); // a dropped stream leaves no ghost rows
      setBatch((x) => (x && x.kind === "running" ? { ...x, kind: "done", ms: Date.now() - startedAt } : x));
      setError((e as Error).message);
      setPhase("error");
    }
  }, []);

  const runExample = (x: { token: string; chain: string; amount: string }) => {
    setToken(x.token);
    setChain(x.chain);
    setAmount(x.amount);
    void run(x.token, x.chain, x.amount);
  };

  const share = async () => {
    if (!plan) return;
    const url = `${location.origin}${sharePath(plan)}`;
    try {
      await navigator.clipboard.writeText(url);
      setToast("share link copied");
    } catch {
      setToast(url);
    }
    setTimeout(() => setToast(null), 2300);
  };

  const exportBase = plan ? `/api/export?chain=${plan.input.chain}&token=${encodeURIComponent(plan.resolved.address || plan.input.token)}&amount=${plan.input.amount}` : "";
  const hasPlan = !!plan && (plan.status === "ok" || plan.status === "thin");
  const status =
    phase === "planning"
      ? "asking Nansen who is buying, who is exiting, and how deep the pool is…"
      : phase === "done" && plan
        ? `${plan.credits} credits · ${plan.calls} calls${plan.cachedCalls ? ` (${plan.cachedCalls} cached)` : ""} · ${(plan.ms / 1000).toFixed(1)} s · plan ${plan.hash.slice(0, 12)}`
        : "";

  return (
    <>
      <main className="wrap">
        <header className="hero">
          <h1>
            How fast can you <span className="real">sell</span> it?
          </h1>
          <p>Paste token, chain and amount held. A dated selling calendar paced to the organic demand Nansen sees.</p>
        </header>

        <div className="panel">
          <form
            className="search"
            onSubmit={(e) => {
              e.preventDefault();
              void run(token, chain, amount);
            }}
          >
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="PEPE, or 0x…" aria-label="token ticker or contract address" autoFocus spellCheck={false} required />
            <select value={chain} onChange={(e) => setChain(e.target.value)} aria-label="chain">
              {CHAINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input className="num" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="tokens held, not dollars" aria-label="amount held, in tokens" required />
            <button type="submit" disabled={phase === "planning"}>
              Plan
            </button>
          </form>
          <div className="chips" role="group" aria-label="examples">
            {EXAMPLES.map((x) => (
              <button key={x.label} type="button" className="chip" onClick={() => runExample(x)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`progress ${phase === "idle" ? "hidden" : ""}`}>
          <i style={{ width: phase === "planning" ? `${Math.min(88, 12 + (batch?.kind === "running" ? batch.calls : 0) * 8)}%` : phase === "done" ? "100%" : "0%" }} />
        </div>
        <p className={`status ${phase === "idle" ? "hidden" : ""}`} aria-live="polite">
          {status}
        </p>

        {phase === "error" && (
          <div className="banner err" role="alert">
            The plan could not be computed<small>{error}</small>
          </div>
        )}
        {plan && plan.status === "not-found" && (
          <div className="banner warn" role="alert">
            Not found<small>{plan.statusReason}</small>
          </div>
        )}
        {plan && (plan.status === "no-organic-demand" || plan.status === "no-price") && (
          <div className="banner warn" role="alert">
            No glidepath — {plan.status === "no-price" ? "no price" : "no organic demand today"}
            <small>{plan.statusReason}</small>
          </div>
        )}
        {plan && plan.status === "thin" && (
          <div className="banner warn">
            Thin — {plan.days} tranches over 90 days and {(plan.remainderPct * 100).toFixed(0)}% still unsold<small>{plan.statusReason}</small>
          </div>
        )}
        {plan && plan.status === "ok" && (
          <div className="banner ok">
            {plan.days} tranche{plan.days === 1 ? "" : "s"} · est. cost {usd(plan.glidepath.costUsd, 2)} vs {usd(plan.dumpToday.costUsd, 2)} selling it all today
            {plan.today.red && <small>today is red — {plan.today.reason} — the first tranche is halved</small>}
          </div>
        )}

        {plan && <PlanCards p={plan} />}

        {plan && (plan.warnings.length > 0 || Object.keys(plan.errors).length > 0) && (
          <ul className="warnings" aria-label="warnings">
            {plan.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
            {Object.entries(plan.errors).map(([k, v]) => (
              <li key={k} className="fail">
                <b>{k}</b> failed: {v}
              </li>
            ))}
          </ul>
        )}

        {plan && (
          <div className="actions" style={{ justifyContent: "center", marginTop: 20 }}>
            <button className="btn" onClick={() => setDrawer(true)}>
              Every Nansen call ({plan.calls})
            </button>
            {hasPlan && (
              <>
                <a className="btn primary" href={`${exportBase}&format=ics`} download>
                  Add to calendar (.ics)
                </a>
                <a className="btn" href={`${exportBase}&format=csv`} download>
                  Download CSV
                </a>
                <a className="btn" href={sharePath(plan)}>
                  Share card
                </a>
                <button className="btn" onClick={share}>
                  Copy link
                </button>
              </>
            )}
          </div>
        )}

        {phase === "idle" && example && (
          <Example example={example} onRun={(x) => runExample({ token: x.plan.resolved.symbol || x.plan.input.token, chain: x.plan.input.chain, amount: String(x.plan.input.amount) })} />
        )}
        {phase === "idle" && <HowItDecides />}

        <Drawer p={plan} open={drawer} onClose={() => setDrawer(false)} />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </main>
      <Rail
        rows={rail}
        batch={batch}
        onClear={() => {
          setRail([]);
          setBatch(null);
        }}
      />
    </>
  );
}

export function sharePath(p: PlanResult) {
  return `/p?chain=${p.input.chain}&token=${encodeURIComponent(p.resolved.address || p.input.token)}&amount=${p.input.amount}`;
}
