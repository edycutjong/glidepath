import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://glidepath.edycu.dev"),
  title: "Glidepath — a dated selling calendar paced to organic demand, Nansen labels decide what counts",
  description: "Paste a token, chain and amount held. A dated selling calendar sized to the organic demand Nansen sees, never the biggest seller on a day the pros exit.",
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Glidepath",
    title: "Glidepath",
    description: "Paste token, chain, amount held. A dated selling calendar paced to organic demand.",
    images: [
      {
        url: "/api/og?chain=ethereum&token=0x6982508145454ce325ddbe47a25d4ec3d2311933&amount=12000000000",
        width: 1200,
        height: 630,
        alt: "Glidepath share card: dump today vs a paced selling calendar for 12B PEPE on ethereum, tranche bars sized to organic demand",
      },
    ],
  },
  twitter: { card: "summary_large_image", creator: "@edycutjong", title: "Glidepath", description: "Paste token, chain, amount held. A dated selling calendar paced to organic demand." },
  authors: [{ name: "Edy Cu Tjong", url: "https://github.com/edycutjong" }],
  creator: "Edy Cu Tjong",
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0a0e13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
