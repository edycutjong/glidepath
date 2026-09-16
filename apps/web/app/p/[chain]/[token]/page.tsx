import type { Metadata } from "next";
import { PlanView } from "@/components/PlanView";
import { planFor, parseInput } from "@/lib/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { params: Promise<{ chain: string; token: string }>; searchParams: Promise<{ amount?: string }> };

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { chain, token } = await params;
  const { amount = "1" } = await searchParams;
  const t = decodeURIComponent(token);
  const og = `/api/og?chain=${chain}&token=${encodeURIComponent(t)}&amount=${encodeURIComponent(amount)}`;
  const title = `Glidepath — ${t} on ${chain}`;
  return { title, description: `A dated selling calendar for ${amount} ${t} on ${chain}, paced to organic demand (Nansen).`, openGraph: { title, images: [og] }, twitter: { card: "summary_large_image", title, images: [og] } };
}

export default async function SharePage({ params, searchParams }: Props) {
  const { chain, token } = await params;
  const { amount = "1" } = await searchParams;
  const input = parseInput(chain, decodeURIComponent(token), amount);
  if ("error" in input) return <main><p className="error">{input.error}</p></main>;
  const plan = await planFor(input);
  const exportBase = `/api/export?chain=${plan.input.chain}&token=${encodeURIComponent(plan.resolved.address || plan.input.token)}&amount=${plan.input.amount}`;
  return (
    <main>
      <h1>{plan.days ? `${plan.days}-day glidepath` : "Glidepath"} for {plan.input.amount.toLocaleString("en-US")} {plan.resolved.symbol}</h1>
      <p className="lede">Shareable plan. <a href={`/?token=${encodeURIComponent(plan.resolved.address || plan.input.token)}&chain=${plan.input.chain}&amount=${plan.input.amount}`}>Open in the planner</a> to change the amount.</p>
      <PlanView p={plan} exportBase={exportBase} />
    </main>
  );
}
