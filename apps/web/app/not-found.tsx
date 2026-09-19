import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader, SiteFooter } from "@/components/Shell";

export const metadata: Metadata = {
  title: "Glidepath — nothing here",
  robots: { index: false },
};

/** app/not-found.tsx — Next returns HTTP 404 with this body; same header and footer as the home. */
export default function NotFound() {
  return (
    <>
      <SiteHeader current="home" />
      <main className="wrap judge">
        <h1>Nothing here.</h1>
        <p className="judge-lede">
          Glidepath has three pages: the planner at <Link href="/">/</Link>, the judge page at <Link href="/judge">/judge</Link>, and the share page at <code>/p?chain=…&amp;token=…&amp;amount=…</code>
          . A permalink that lands here is missing one of those three fields — the planner rebuilds it in one click.
        </p>
        <p className="judge-kicker" style={{ marginTop: 24 }}>
          <Link href="/">← back to the planner</Link> · <Link href="/judge">for the judge</Link>
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
