import { ImageResponse } from "next/og";
import { planFor, parseInput } from "@/lib/server";
import { clientIp, ipAllowed, budgetExhausted, recordSpend } from "@/lib/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const usd = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);

/** 1200×630 share card: the dump-today line vs the glidepath line, with the tranche bars. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const input = parseInput(u.searchParams.get("chain"), u.searchParams.get("token"), u.searchParams.get("amount"));
  // same spend guard as /api/plan — but an image never 4xxs (a scraper would drop the card): past the per-IP rate or
  // the daily ceiling the card renders its data-free layout
  const live = ipAllowed(clientIp(req.headers)).ok && !budgetExhausted();
  const p =
    "error" in input || !live
      ? null
      : await planFor(input)
          .then((plan) => {
            recordSpend(plan.credits);
            return plan;
          })
          .catch(() => null);
  const ok = p && (p.status === "ok" || p.status === "thin");
  const max = p ? Math.max(1, ...p.tranches.map((t) => t.usd)) : 1;
  return new ImageResponse(
    <div style={{ width: 1200, height: 630, display: "flex", flexDirection: "column", background: "#0a0e13", color: "#e6edf3", padding: 56, fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <div style={{ fontSize: 30, fontWeight: 800 }}>glidepath</div>
        <div style={{ fontSize: 22, color: "#8b9bab" }}>{p ? `${p.resolved.symbol} · ${p.input.chain} · ${p.input.amount.toLocaleString("en-US")} tokens` : "Nansen-paced selling calendar"}</div>
      </div>
      {p && p.status !== "not-found" ? (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 30, gap: 14 }}>
          <div style={{ display: "flex", fontSize: 34 }}>
            <span style={{ color: "#ef4444", fontWeight: 700, marginRight: 10 }}>Dump today:</span>
            {usd(p.dumpToday.usd)} · est. impact {usd(p.dumpToday.costUsd)}
            {p.dumpToday.shareOfOrganicDay != null ? ` · ${Math.round(p.dumpToday.shareOfOrganicDay * 100)}% of a day's organic buys` : ""}
          </div>
          {ok ? (
            <div style={{ display: "flex", fontSize: 34 }}>
              <span style={{ color: "#22c55e", fontWeight: 700, marginRight: 10 }}>Glidepath:</span>
              {p.days} tranches · est. cost {usd(p.glidepath.costUsd)}
              {p.redDays ? ` · ${p.redDays} red days in the last ${p.completeDays}` : ""}
            </div>
          ) : (
            <div style={{ display: "flex", fontSize: 30, color: "#f59e0b" }}>{p.statusReason}</div>
          )}
          {ok && (
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 240, marginTop: 24 }}>
              {p.tranches.slice(0, 40).map((t) => (
                <div
                  key={t.day}
                  style={{
                    display: "flex",
                    width: Math.min(180, Math.max(12, Math.floor(1080 / Math.min(40, p.tranches.length)) - 6)),
                    height: Math.max(8, (t.usd / max) * 240),
                    background: t.red ? "#ef4444" : "#22c55e",
                    borderRadius: 4,
                  }}
                />
              ))}
            </div>
          )}
          <div style={{ display: "flex", fontSize: 20, color: "#8b9bab", marginTop: 12 }}>
            organic buys {usd(p.organic.organicDailyUsd)}/day · pace {(p.risk.k * 100).toFixed(1)}% · {p.calls} Nansen calls · plan {p.hash.slice(0, 12)}
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", fontSize: 34, marginTop: 40 }}>{p?.statusReason ?? "Paste a token, a chain and the amount you hold."}</div>
      )}
    </div>,
    // crawlers fetch a shared link 3–5× from different cold instances; let Vercel's edge serve repeats for the cache window
    { width: 1200, height: 630, headers: { "cache-control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
  );
}
