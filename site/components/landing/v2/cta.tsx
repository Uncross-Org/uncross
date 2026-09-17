"use client";

// The closing beat: the claim once more, the two things a visitor can do, and
// the disclosures beside them — where the template's block puts a
// testimonial, this puts what a judge should know before clicking. The frame
// is the block's dashed grid, the headline carries the shimmer, and "Open the
// app" wears the moving border. Under prefers-reduced-motion the words stand
// still and the button is a button.

import { useEffect, useState } from "react";
import Link from "next/link";
import { Container } from "@/components/container";
import { GridLine } from "@/components/landing/v2/faq";
import { Button as MovingBorderButton } from "@/components/ui/moving-border";
import { ShimmerText } from "@/components/ui/shimmer-text";
import { PROGRAM_ID } from "@/lib/uncross/config";

const GITHUB = "https://github.com/Uncross-Org/uncross";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

export function CtaV2() {
  const reduced = usePrefersReducedMotion();
  const primary = "inline-flex h-12 items-center justify-center gap-2 px-6 text-[15px] font-semibold";

  return (
    <Container as="section" className="overflow-hidden py-16 md:py-24">
      <div className="relative grid grid-cols-1 bg-gradient-to-br from-raise to-bg md:grid-cols-3">
        <GridLine axis="x" className="top-0" offset="200px" />
        <GridLine axis="x" className="top-auto bottom-0" offset="200px" />
        <GridLine axis="y" className="left-0" offset="80px" />
        <GridLine axis="y" className="right-0 left-auto" offset="80px" />

        <div className="p-8 md:col-span-2 md:p-14">
          <h2 className="display max-w-[20ch] text-[32px] leading-[1.05] font-semibold text-text md:text-[44px]">
            {reduced ? (
              <span>One price for everyone.</span>
            ) : (
              <ShimmerText as="span" duration={2.4} spread={1.5}>
                One price for everyone.
              </ShimmerText>
            )}{" "}
            <span className="text-text-2">Even when the market is thin.</span>
          </h2>
          <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-text-2">
            Open the app, watch the next cross land, and place an order of your own if you have a devnet wallet. No
            wallet is needed to watch.
          </p>
          <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            {reduced ? (
              <Link href="/app" className={`${primary} rounded-full bg-cta-bg text-cta-fg`}>
                Open the app →
              </Link>
            ) : (
              <MovingBorderButton
                as={Link}
                href="/app"
                borderRadius="9999px"
                duration={4000}
                containerClassName="h-12 w-auto"
                borderClassName="bg-[radial-gradient(var(--accent)_40%,transparent_60%)]"
                className={`${primary} border-line bg-cta-bg text-cta-fg`}
              >
                Open the app →
              </MovingBorderButton>
            )}
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              className={`${primary} rounded-full border border-line bg-surface text-text transition hover:bg-raise`}
            >
              Read the code ↗
            </a>
          </div>
        </div>

        <div className="border-t border-dashed border-line-strong p-8 md:border-t-0 md:border-l md:p-14">
          <div className="eyebrow">Before you click</div>
          <ul className="mt-3 flex flex-col gap-3 text-[14.5px] leading-relaxed text-text-2">
            <li>Runs on Solana devnet, by design: that is where the issuer&apos;s powers can be tested.</li>
            <li>Balances are test tokens. The liquidity evidence on this page comes from live mainnet reads.</li>
            <li>Devnet orders come from our test bot; the cross demonstrates the mechanism, not price discovery.</li>
          </ul>
          <div className="num mt-5 text-[12px] text-muted">
            program {PROGRAM_ID.slice(0, 4)}…{PROGRAM_ID.slice(-4)} · Stocklana 2026
          </div>
        </div>
      </div>
    </Container>
  );
}
