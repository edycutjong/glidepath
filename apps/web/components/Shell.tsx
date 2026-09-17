import Link from "next/link";
import pkg from "../package.json";

export const VERSION = `v${pkg.version}`;
export const REPO = "https://github.com/edycutjong/glidepath";
export const SITE = "https://glidepath.edycu.dev";

/** The mark — the favicon's glyph at 24px: today's red bar, then the tranches gliding down. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden>
      <rect x="4" y="12" width="11" height="46" rx="2.5" fill="#dc2626" />
      <rect x="19" y="22" width="11" height="36" rx="2.5" fill="var(--real, #16a34a)" />
      <rect x="34" y="32" width="11" height="26" rx="2.5" fill="var(--real, #16a34a)" />
      <rect x="49" y="42" width="11" height="16" rx="2.5" fill="var(--real, #16a34a)" />
    </svg>
  );
}

export function SiteHeader({ current }: { current: "home" | "judge" }) {
  return (
    <header className="site-header">
      <Link href="/" className="brand" aria-label="Glidepath — home">
        <Mark />
        <span className="brand-name">glidepath</span>
        <span className="brand-tag">sell at the pace the market absorbs · on Nansen</span>
      </Link>
      <nav className="site-nav" aria-label="site">
        <Link href="/" aria-current={current === "home" ? "page" : undefined}>
          Plan
        </Link>
        <Link href="/judge" aria-current={current === "judge" ? "page" : undefined}>
          For the judge
        </Link>
        <a href={REPO} target="_blank" rel="noreferrer">
          GitHub
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="foot-row">
        <span>
          <Mark size={14} /> glidepath <a href={`${REPO}/releases/latest`}>{VERSION}</a>
        </span>
        <span className="foot-links">
          <a href={`${REPO}/blob/main/docs/SCORING.md`}>how the plan is sized</a>
          <a href={`${REPO}/blob/main/DEMO.md`}>reproduce it</a>
          <Link href="/judge">for the judge</Link>
          <a href="https://docs.nansen.ai" target="_blank" rel="noreferrer">
            Nansen API
          </a>
        </span>
      </div>
      <p className="foot-note">
        Built on the Nansen API for the Meridian Buildathon by{" "}
        <a href="https://x.com/edycutjong" target="_blank" rel="noreferrer">
          @edycutjong
        </a>
        . It plans; it never trades — costs are a constant-product estimate on <code>liquidity_usd</code>, or a <code>trade/quote</code> route on solana/base. Not financial advice.
      </p>
    </footer>
  );
}
