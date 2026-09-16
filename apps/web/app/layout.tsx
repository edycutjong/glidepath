import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Glidepath — sell what you must, at the pace the market can absorb",
  description: "Paste a token, a chain and the amount you hold. Glidepath turns it into a dated selling calendar sized to organic demand — Nansen labels decide what counts as organic.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <nav className="top"><a href="/" className="brand">glidepath</a><span className="tiny muted">organic-demand-paced selling calendar · powered by Nansen</span></nav>
          {children}
          <footer className="tiny muted">Glidepath plans; it never trades. Impact costs are estimates (constant-product on Nansen <code>liquidity_usd</code>, or a Nansen <code>trade/quote</code> route on solana/base). Not financial advice. <a href="https://github.com/edycutjong/glidepath">source</a></footer>
        </div>
      </body>
    </html>
  );
}
