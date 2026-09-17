"use client";
import { useEffect, useState } from "react";
import type { PlanResult } from "@glidepath/core";
import { PlanView } from "@/components/PlanView";

const CHAINS = [
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

export default function Home() {
  const [token, setToken] = useState("PEPE");
  const [chain, setChain] = useState("ethereum");
  const [amount, setAmount] = useState("12000000000");
  const [plan, setPlan] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("token")) {
      setToken(q.get("token")!);
      setChain(q.get("chain") ?? "ethereum");
      setAmount(q.get("amount") ?? "1");
    }
  }, []);

  async function run(t = token, c = chain, a = amount) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: t, chain: c, amount: a }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setPlan(json as PlanResult);
      window.history.replaceState(null, "", `/?token=${encodeURIComponent(t)}&chain=${c}&amount=${a}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const exportBase = plan ? `/api/export?chain=${plan.input.chain}&token=${encodeURIComponent(plan.resolved.address || plan.input.token)}&amount=${plan.input.amount}` : "";

  return (
    <main>
      <h1>Sell what you must — at the pace the market can absorb.</h1>
      <p className="lede">
        Paste the token, the chain and how much you hold. Glidepath sizes daily tranches to the organic demand Nansen sees — buys by wallets that are <em>not</em> Smart Money, funds, whales, exchanges
        or sniper-bot users — flags the days the pros are net-selling, and hands you a calendar.
      </p>
      <form
        className="inputs"
        onSubmit={(e) => {
          e.preventDefault();
          run();
        }}
      >
        <label>
          Token address or ticker
          <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="0x… or PEPE" required />
        </label>
        <label>
          Chain
          <select value={chain} onChange={(e) => setChain(e.target.value)}>
            {CHAINS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label>
          Amount held (tokens)
          <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="12000000000" required />
        </label>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Planning…" : "Plan my glidepath"}
        </button>
      </form>
      <div className="examples">
        {EXAMPLES.map((x) => (
          <button
            key={x.label}
            type="button"
            onClick={() => {
              setToken(x.token);
              setChain(x.chain);
              setAmount(x.amount);
              run(x.token, x.chain, x.amount);
            }}
          >
            {x.label}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      {plan && <PlanView p={plan} exportBase={exportBase} />}
    </main>
  );
}
