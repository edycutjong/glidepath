import { Glidepath } from "@/components/Glidepath";
import { SiteHeader, SiteFooter } from "@/components/Shell";
import type { PlanResult } from "@glidepath/core";
import pepe from "../../../fixtures/0X6982508145--ETHEREUM.json";

export const dynamic = "force-dynamic";

/** The recorded PEPE plan (fixtures/0X6982508145--ETHEREUM.json, the hero of `npm run verify`) is the empty state's example — replayed, 0 credits, labelled. */
const EXAMPLE = { plan: (pepe as unknown as { plan: PlanResult }).plan, file: "0X6982508145--ETHEREUM.json", label: "a $40K donation" };

export default async function Home({ searchParams }: { searchParams: Promise<{ token?: string; chain?: string; amount?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <SiteHeader current="home" />
      <Glidepath initialToken={sp.token} initialChain={sp.chain} initialAmount={sp.amount} example={EXAMPLE} />
      <SiteFooter />
    </>
  );
}
