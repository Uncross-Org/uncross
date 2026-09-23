"use client";

// The hero: the claim on the left, the thing itself on the right — the live
// order book of a running auction, drawn large inside a browser frame. Not a
// screenshot: it is the same chart the dashboard draws, from the same devnet
// read, and it moves when an order lands.

import { DEVNET_SLOT_MS } from "@/lib/uncross/config";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, useScroll, useTransform } from "motion/react";
import { Container } from "@/components/container";
import { HeroHighlight, Highlight } from "@/components/ui/hero-highlight";
import { Stagger, StaggerItem } from "@/components/landing/motion";
import { PhoneLive } from "@/components/landing/v2/phone-live";
import { DepthChart } from "@/components/landing/depth-chart";
import { useVenue } from "@/lib/use-venue";
import { fmtPrice, fmtShares } from "@/lib/uncross/format";
import type { Snapshot } from "@/lib/snapshot";

const PHASE: Record<string, string> = {
  upcoming: "Opening",
  open: "Taking orders",
  freeze: "Closing — no more cancelling",
  "awaiting-cross": "Crossing",
  cleared: "Cleared",
  settled: "Settled",
};

function LiveBook() {
  const { book, indicative, phase, current, slot, loading, stale } = useVenue("AAPLx");
  const running = phase === "open" || phase === "freeze" || phase === "upcoming";
  const secs = running && current && slot != null ? Math.max(0, Math.round(((current.closeSlot - slot) * DEVNET_SLOT_MS) / 1000)) : null;

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[0_24px_80px_-32px_rgba(11,14,20,0.35)]">
      {/* Browser chrome, as in the template. */}
      <div className="flex items-center gap-3 border-b border-line bg-raise px-4 py-2.5">
        <span className="flex gap-1.5" aria-hidden="true">
          <i className="size-2.5 rounded-full bg-ask/70" />
          <i className="size-2.5 rounded-full bg-amber/70" />
          <i className="size-2.5 rounded-full bg-bid/70" />
        </span>
        <span className="num flex-1 text-center text-[12px] text-muted">uncross.0xo.in/app</span>
        <span className="num rounded-md border border-line px-2 py-0.5 text-[10.5px] tracking-[0.06em] text-text-2 uppercase">
          Devnet
        </span>
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-5 pt-4 md:px-6">
        <div>
          <div className="eyebrow">AAPLx · current book{stale ? " · last good read" : ""}</div>
          <div className="display-tight num mt-1 text-[36px] leading-none font-semibold md:text-[44px]">
            {indicative ? fmtPrice(indicative.price) : loading ? "…" : "—"}
          </div>
          <div className="num mt-1 text-[12.5px] text-muted">
            {indicative ? `would clear · ${fmtShares(indicative.volume)} shares` : "no crossing orders yet"}
          </div>
        </div>
        <div className="num text-right text-[12.5px] leading-relaxed text-text-2">
          <div className={phase === "freeze" ? "font-semibold text-amber" : "font-semibold"}>
            {phase ? PHASE[phase] ?? phase : loading ? "reading…" : "—"}
          </div>
          <div className="text-muted">
            {book.length} orders in{secs != null ? ` · ~${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, "0")}s to cross` : ""}
          </div>
        </div>
      </div>

      <div className="px-2 pt-2 pb-3 md:px-4">
        <DepthChart book={book} indicative={indicative} loading={loading} height={340} />
      </div>
    </div>
  );
}

// Stage 2 of the hero: the browser frame stands slightly tilted back and
// straightens as the page scrolls — the mechanics of the template's
// container-scroll-animation, applied to our own frame instead of its
// 80rem stage and dark bezel. Under prefers-reduced-motion it simply stands
// straight.
const TILT_DEG = 14;
const TILT_OVER_PX = 480;

function TiltFrame({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const { scrollY } = useScroll();
  const rotateX = useTransform(scrollY, [0, TILT_OVER_PX], [reduced ? 0 : TILT_DEG, 0]);
  const y = useTransform(scrollY, [0, TILT_OVER_PX], [0, reduced ? 0 : -24]);

  return (
    <div ref={ref} style={{ perspective: 1400 }}>
      <motion.div style={{ rotateX, y, transformOrigin: "50% 100%" }} data-tilt={reduced ? "static" : "animated"}>
        {children}
      </motion.div>
    </div>
  );
}

export function HeroV2({ snapshot }: { snapshot: Snapshot }) {
  const crosses = snapshot.crosses.length;

  return (
    <header className="relative overflow-hidden bg-bg">
      {/* Stage 1 of the hero: the template's dot grid, which follows the
          cursor, behind the claim. Pointer-driven only, so it costs nothing
          at rest and needs no reduced-motion variant. */}
      <HeroHighlight containerClassName="items-stretch">
      <Container className="grid items-center gap-12 pt-12 pb-16 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14 lg:pt-20 lg:pb-24">
        <Stagger className="flex flex-col items-start">
          <StaggerItem>
            <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1.5 text-[13px] font-medium text-accent">
              <span className="pulse-dot size-[7px] rounded-full bg-accent" aria-hidden="true" />
              Live on Solana devnet · ten tickers · a cross every twenty minutes
            </span>
          </StaggerItem>
          <StaggerItem>
            <h1 className="display mt-6 max-w-[14ch] text-[44px] leading-[0.98] font-semibold text-text md:text-[76px]">
              <Highlight>One price</Highlight> for everyone, even when the market is thin.
            </h1>
          </StaggerItem>
          <StaggerItem>
            <p className="mt-6 max-w-[46ch] text-lg leading-relaxed text-text-2 md:text-xl">
              Uncross gathers everyone who wants to trade a thin tokenized stock into the same few minutes, then fills
              them all at one price — instead of leaving each person to walk an empty pool alone.
            </p>
          </StaggerItem>
          <StaggerItem className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/app"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-cta-bg px-5 py-3 text-[15px] font-semibold text-cta-fg shadow-[0_8px_24px_-8px_var(--accent)] transition hover:brightness-110 active:scale-[0.98]"
            >
              Open the app →
            </Link>
            <a
              href="#live"
              className="inline-flex items-center justify-center rounded-lg border border-line bg-surface px-5 py-3 text-[15px] font-medium text-text transition hover:bg-raise"
            >
              Watch a cross land
            </a>
          </StaggerItem>
          <StaggerItem className="num mt-10 grid w-full max-w-[420px] grid-cols-3 gap-6 border-t border-line pt-6 text-[13px] text-muted">
            <div>
              <div className="display-tight text-[28px] font-semibold text-text">10</div>
              tickers, devnet mints matching the real xStocks
            </div>
            <div>
              <div className="display-tight text-[28px] font-semibold text-text">1</div>
              price per auction, whatever each person bid
            </div>
            <div>
              <div className="display-tight text-[28px] font-semibold text-text">{crosses > 0 ? `${crosses}+` : "—"}</div>
              recent crosses on chain, every one clickable
            </div>
          </StaggerItem>
        </Stagger>

        <div className="relative">
          {/* A soft field behind the frame so the white card reads on the white ground. */}
          <div
            aria-hidden="true"
            className="absolute -inset-6 -z-10 rounded-[32px] bg-[radial-gradient(60%_60%_at_30%_20%,var(--accent-soft),transparent_70%),radial-gradient(50%_50%_at_90%_90%,rgba(200,80,28,0.10),transparent_70%)]"
          />
          <TiltFrame>
            <LiveBook />
          </TiltFrame>
          {/* The mobile dashboard, live, on the frame's corner — another
              ticker, so the two screens are visibly two reads of the venue.
              Hidden at phone width: that visitor is already on the real thing. */}
          <PhoneLive
            ticker="NVDAx"
            className="absolute -right-24 -bottom-14 hidden origin-bottom-right scale-[0.5] lg:block"
          />
        </div>
      </Container>
      </HeroHighlight>
    </header>
  );
}
