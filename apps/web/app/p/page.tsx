import type { Metadata } from "next";
import { Glidepath } from "@/components/Glidepath";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import { planFor, parseInput } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { searchParams: Promise<{ chain?: string; token?: string; amount?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { chain = "ethereum", token = "", amount = "1" } = await searchParams;
  const t = token;
  const og = `/api/og?chain=${chain}&token=${encodeURIComponent(t)}&amount=${encodeURIComponent(amount)}`;
  const title = `Glidepath — ${t} on ${chain}`;
  return {
    title,
    description: `A dated selling calendar for ${amount} ${t} on ${chain}, paced to organic demand (Nansen).`,
    openGraph: { title, images: [og] },
    twitter: { card: "summary_large_image", title, images: [og] },
  };
}

/** The share page: the home shell with a server-rendered plan (the same cards, the same drawer, the same exports). */
export default async function SharePage({ searchParams }: Props) {
  const { chain = "ethereum", token = "", amount = "1" } = await searchParams;
  const input = parseInput(chain, token, amount);
  if ("error" in input)
    return (
      <>
        <SiteHeader current="home" />
        <main className="wrap">
          <div className="banner err" role="alert">
            This share link is malformed<small>{input.error}</small>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  const plan = await planFor(input);
  return (
    <div className="with-rail">
      <SiteHeader current="home" />
      <Glidepath initialToken={plan.resolved.symbol || plan.input.token} initialChain={plan.input.chain} initialAmount={String(plan.input.amount)} initialPlan={plan} />
      <SiteFooter />
    </div>
  );
}
