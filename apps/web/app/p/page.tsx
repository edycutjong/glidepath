import type { Metadata } from "next";
import { headers } from "next/headers";
import type { PlanResult } from "@glidepath/core";
import { Glidepath } from "@/components/Glidepath";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import { planFor, parseInput } from "@/lib/server";
import { admit, recordSpend } from "@/lib/guard";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { searchParams: Promise<{ chain?: string; token?: string; amount?: string }> };

const compactAmount = (amount: string): string => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
};

// og:description / twitter:description need to land in 80–125 chars regardless of token shape (a raw 42-char
// address plus a long amount can otherwise push a naive template well past 125) — compact the amount and
// abbreviate a long token identifier so the description stays in range for both a ticker and a bare address.
const shortToken = (token: string): string => (token.length > 12 ? `${token.slice(0, 6)}…${token.slice(-4)}` : token);

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { chain = "ethereum", token = "", amount = "1" } = await searchParams;
  const t = token;
  const og = `/api/og?chain=${encodeURIComponent(chain)}&token=${encodeURIComponent(t)}&amount=${encodeURIComponent(amount)}`;
  const title = `Glidepath — ${t} on ${chain}`;
  const description = `A dated selling calendar for ${compactAmount(amount)} ${shortToken(t)} on ${chain}, sized to the organic demand Nansen sees.`;
  return {
    title,
    description,
    openGraph: { title, images: [og] },
    twitter: { card: "summary_large_image", title, images: [og] },
  };
}

/** The share page: the home shell with a server-rendered plan (the same cards, the same drawer, the same exports). */
export default async function SharePage({ searchParams }: Props) {
  const { chain = "ethereum", token = "", amount = "1" } = await searchParams;
  const input = parseInput(chain, token, amount);
  if ("error" in input) return <ShareError title="This share link is malformed" detail={input.error} />;
  // a share link spends live credits on a cache miss: same spend guard as /api/plan, and never a 500 page on a link
  if (!process.env.NANSEN_API_KEY)
    return <ShareError title="This server has no Nansen key" detail="NANSEN_API_KEY is not set on the server — run it locally with your own key (README, under 10 minutes)." />;
  const gate = admit(await headers(), "share");
  if (!gate.ok) return <ShareError title="The plan could not be computed" detail={gate.error} />;
  let plan: PlanResult;
  try {
    plan = await planFor(input);
  } catch (e) {
    return <ShareError title="The plan could not be computed" detail={(e as Error).message.slice(0, 300)} />;
  }
  recordSpend(plan.credits);
  return (
    <div className="with-rail">
      <SiteHeader current="home" />
      <Glidepath initialToken={plan.resolved.symbol || plan.input.token} initialChain={plan.input.chain} initialAmount={String(plan.input.amount)} initialPlan={plan} />
      <SiteFooter />
    </div>
  );
}

function ShareError({ title, detail }: { title: string; detail: string }) {
  return (
    <>
      <SiteHeader current="home" />
      <main className="wrap">
        <div className="banner err" role="alert">
          {title}
          <small>{detail}</small>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
