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
      <Problem />
      <div className="rule-h" />
      <HowItWorks />
      <div className="rule-h" />
      <LiquidityPanel />
      <div className="rule-h" />
      <WhatItsFor />
      <div className="rule-h" />
      <LiveSection />
      <div className="rule-h" />
      <Faq />
      <div className="rule-h" />
      <Footer />
    </>
  );
}
