// The landing page, statically prerendered so it reads with no wallet and with
// JavaScript off. The snapshot is taken at build (and refreshed by ISR) and
// every figure it shows is stamped with its own timestamp; the live pieces
// hydrate on top when JavaScript runs.
//
// Order of the page: the claim and the live book; every ticker's last cross;
// the problem, measured; how an auction runs; the Pyth gate; the auction
// running now; what it does and doesn't; the closing beat.

import { getSnapshot } from "@/lib/snapshot";
import { NavbarV2, FooterV2 } from "@/components/landing/v2/chrome";
import { EventBanner } from "@/components/landing/v2/event-banner";
import { HeroV2 } from "@/components/landing/v2/hero";
import { TickerStrip } from "@/components/landing/v2/ticker-strip";
import { ProblemV2 } from "@/components/landing/v2/problem";
import { HowItWorksV2 } from "@/components/landing/v2/how-it-works";
import { PythSectionV2 } from "@/components/landing/v2/pyth-section";
import { LiveSectionV2 } from "@/components/landing/v2/live-section";
import { FaqV2 } from "@/components/landing/v2/faq";
import { CtaV2 } from "@/components/landing/v2/cta";

/** Re-prerender every 5 minutes, so the snapshot in the HTML stays recent. */
export const revalidate = 300;

export default async function Page() {
  const snapshot = await getSnapshot();

  return (
    <>
      <EventBanner />
      <NavbarV2 />
      <HeroV2 snapshot={snapshot} />
      <TickerStrip />
      <ProblemV2 />
      <HowItWorksV2 />
      <PythSectionV2 oracle={snapshot.oracle} builtAt={snapshot.builtAt} />
      <LiveSectionV2 />
      <FaqV2 />
      <CtaV2 />
      <FooterV2 />
    </>
  );
}
