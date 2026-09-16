"use client";

// The hero. Two things sit side by side: the price an auction actually
// produced, and the reference price beside it — not above it, and not as a
// target that was hit.
//
// The shader is the template's, recoloured: bid-blue and ask-orange bands
// drifting past each other, the two sides of a book that has not met yet. It
// renders one still frame under prefers-reduced-motion (the component handles
// that itself) and stops when scrolled out of view.

import Link from "next/link";
import { LinesGradientShader } from "@/components/lines-gradient-shader";
import { Container } from "@/components/container";
import type { Snapshot } from "@/lib/snapshot";
import { latestFor } from "@/lib/snapshot";
import { CrossPanel } from "./cross-panel";
import { OraclePanel } from "./oracle-panel";
import { LiveCurves } from "./live-section";

// Bid blue fading into ask orange: the book's own two colours, nothing else.
const BAND_COLORS = [
  "rgba(57, 135, 229, 0.55)",
  "rgba(57, 135, 229, 0.34)",
  "rgba(87, 113, 190, 0.24)",
  "rgba(140, 100, 140, 0.2)",
  "rgba(196, 92, 74, 0.24)",
  "rgba(217, 89, 38, 0.3)",
  "rgba(217, 89, 38, 0.16)",
  "rgba(217, 89, 38, 0.05)",
];

export function Hero({ snapshot }: { snapshot: Snapshot }) {
  const cross = latestFor(snapshot, "AAPLx") ?? snapshot.crosses[0] ?? null;

  return (
    <header className="relative overflow-hidden">
      <LinesGradientShader
        className="absolute inset-0 bg-transparent"
        colors={BAND_COLORS}
        bandSpacing={44}
        bandThickness={96}
        waveAmplitude={0.18}
        speed={0.8}
        targetFps={30}
      />

      <Container className="relative z-10 pt-9 pb-14 md:pt-16 md:pb-20">
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-bg/70 px-3 py-1.5 text-[13px] text-text-2">
          <span className="size-[7px] rounded-full bg-bid shadow-[0_0_0_3px_rgba(57,135,229,0.3)]" aria-hidden="true" />
          Live on Solana devnet · auctions every few minutes
        </span>

        <h1 className="display mt-5 max-w-[15ch] text-[40px] leading-none font-semibold md:text-[72px]">
          One price for everyone, even when the market is thin.
        </h1>

        <p className="mt-5 max-w-[52ch] text-base leading-relaxed text-text-2 md:text-xl">
          Uncross collects orders for a few minutes, then fills all of them at the single price that trades the most
          shares. Built for tokenized stocks that trade around the clock on Solana.
        </p>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/app"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-cta-bg px-4 py-3 text-sm font-semibold text-cta-fg transition active:scale-[0.98]"
          >
            Connect wallet &amp; open app →
          </Link>
          <a
            href="#live"
            className="inline-flex items-center justify-center rounded-lg border border-line px-4 py-3 text-sm font-medium text-text transition hover:bg-raise"
          >
            Watch the live auction
          </a>
        </div>

        {/* The window frame is the template's; what sits inside it is live data, not a screenshot. */}
        <div className="mt-10 overflow-hidden rounded-2xl border border-line bg-surface/85 backdrop-blur-sm md:mt-14">
          <div className="num flex items-center justify-between border-b border-line px-4 py-3 text-xs text-muted">
            <span>
              <span className="text-text-2">{cross ? cross.ticker : "AAPLx"}</span>
              {cross && <> · auction {cross.auction.slice(0, 8)}</>}
            </span>
            <span>devnet</span>
          </div>

          <div className="grid md:grid-cols-[1.35fr_1fr]">
            <CrossPanel cross={cross} />
            <OraclePanel oracle={snapshot.oracle} />
          </div>

          {/* Cumulative demand and supply, assembling from the live book. */}
          <div className="border-t border-line p-4 md:p-6">
            <LiveCurves />
          </div>
        </div>
      </Container>
    </header>
  );
}
