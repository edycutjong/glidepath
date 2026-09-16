import type { Plan } from "./plan";

const fmtUsd = (v: number | null | undefined) => (v == null ? "—" : `$${Math.round(v).toLocaleString("en-US")}`);
const fmtTok = (v: number) => (v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toPrecision(6));
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
/** RFC 5545 §3.1: content lines longer than 75 octets are folded with CRLF + one space. */
export const foldLine = (line: string): string => {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0, first = true;
  while (start < bytes.length) {
    const width = first ? 75 : 74;
    let end = Math.min(bytes.length, start + width);
    while (end < bytes.length && end > start && (bytes[end] & 0xc0) === 0x80) end--; // never split a UTF-8 sequence
    parts.push((first ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end; first = false;
  }
  return parts.join("\r\n");
};
const icsDate = (d: string) => d.replace(/-/g, "");

/** One all-day VEVENT per tranche; the description carries the go/no-go rule so the seller never needs the app open. */
export function toICS(p: Plan): string {
  const sym = p.resolved.symbol;
  const stamp = p.computedAt.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//glidepath//organic-demand selling calendar//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const t of p.tranches) {
    const next = new Date(Date.parse(t.date + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
    const desc = [
      `Sell ${fmtTok(t.tokens)} ${sym} (≈ ${fmtUsd(t.usd)}) — tranche ${t.day + 1} of ${p.days}.`,
      t.red ? `Planned on a RED day (${t.reason}): size halved.` : "",
      `Rule before selling: re-run glidepath. If today shows Smart Money net-selling past ${fmtUsd(p.today.theta.smUsd)} or net exchange deposits past ${fmtUsd(p.today.theta.exUsd)}, halve this tranche and add a day.`,
      `Sized to ${(p.risk.k * 100).toFixed(1)}% of ${fmtUsd(p.organic.organicDailyUsd)}/day organic buys (Nansen who-bought-sold, labels excluded). Plan ${p.hash.slice(0, 12)}.`,
    ].filter(Boolean).join("\n");
    lines.push("BEGIN:VEVENT", `UID:glidepath-${p.hash.slice(0, 16)}-${t.day}@glidepath`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(t.date)}`, `DTEND;VALUE=DATE:${icsDate(next)}`,
      `SUMMARY:${esc(`Sell ${fmtTok(t.tokens)} ${sym} (${fmtUsd(t.usd)})${t.red ? " — red day, halved" : ""}`)}`, `DESCRIPTION:${esc(desc)}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export function toCSV(p: Plan): string {
  const rows = [["day", "date", "tokens", "usd", "red", "reason", "est_cost_usd", "cost_model"]];
  for (const t of p.tranches) rows.push([String(t.day + 1), t.date, t.tokens.toFixed(6), t.usd.toFixed(2), t.red ? "yes" : "no", t.reason ?? "", t.costUsd.toFixed(2), p.glidepath.model ?? ""]);
  return rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n") + "\n";
}
