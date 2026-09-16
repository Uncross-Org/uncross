// The landing page, statically prerendered so it reads with no wallet and with
// JavaScript off. The snapshot is taken at build (and refreshed by ISR) and
// every figure it shows is stamped with its own timestamp; the live pieces
// hydrate on top when JavaScript runs.

import { getSnapshot } from "@/lib/snapshot";
import { Navbar, Footer } from "@/components/landing/chrome";
import { Hero } from "@/components/landing/hero";
import { Problem, HowItWorks, WhatItsFor, Faq } from "@/components/landing/sections";
import { LiquidityPanel } from "@/components/landing/liquidity-panel";
import { LiveSection } from "@/components/landing/live-section";
import { Reveal } from "@/components/landing/motion";

/** Re-prerender every 5 minutes, so the snapshot in the HTML stays recent. */
export const revalidate = 300;

export default async function Page() {
  const snapshot = await getSnapshot();

  return (
    <>
      <Navbar />
      <div className="rule-h" />
      <Hero snapshot={snapshot} />
      <div className="rule-h" />
      {/* One effect per section: each rises once as it comes into view, and
          renders in its finished state under prefers-reduced-motion. */}
      <Reveal>
        <Problem />
      </Reveal>
      <div className="rule-h" />
      <Reveal>
        <HowItWorks />
      </Reveal>
      <div className="rule-h" />
      <Reveal>
        <LiquidityPanel />
      </Reveal>
      <div className="rule-h" />
      <Reveal>
        <WhatItsFor />
      </Reveal>
      <div className="rule-h" />
      <Reveal>
        <LiveSection />
      </Reveal>
      <div className="rule-h" />
      <Reveal>
        <Faq />
      </Reveal>
      <div className="rule-h" />
      <Footer />
    </>
  );
}
