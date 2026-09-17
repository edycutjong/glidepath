import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://glidepath-lilac.vercel.app"),
  title: "Glidepath — a dated selling calendar paced to organic demand, Nansen labels decide what counts",
  description: "Paste a token, a chain and the amount you hold. A dated selling calendar sized to the organic demand Nansen sees — never the biggest seller on a day the pros are exiting.",
  openGraph: {
    title: "Glidepath",
    description: "Paste token, chain, amount held. A dated selling calendar paced to organic demand.",
    images: ["/api/og?chain=ethereum&token=0x6982508145454ce325ddbe47a25d4ec3d2311933&amount=12000000000"],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
