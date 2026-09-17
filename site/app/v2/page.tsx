// Redesign preview: the hero and one full section, deployed beside the current
// page for approval before the rest is built.

import { getSnapshot } from "@/lib/snapshot";
import { Navbar, Footer } from "@/components/landing/chrome";
import { HeroV2 } from "@/components/landing/v2/hero";
import { ProblemV2 } from "@/components/landing/v2/problem";
import { TickerStrip } from "@/components/landing/v2/ticker-strip";
import { HowItWorksV2 } from "@/components/landing/v2/how-it-works";

export const revalidate = 300;

export default async function Page() {
  const snapshot = await getSnapshot();
  return (
    <>
      <Navbar />
      <HeroV2 snapshot={snapshot} />
      <TickerStrip />
      <ProblemV2 />
      <HowItWorksV2 />
      <Footer />
    </>
  );
}
