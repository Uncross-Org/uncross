"use client";

// How it works: the five stages of one auction, walked by scrolling. The
// stages stack on the left and light up as they pass the middle of the
// viewport; a panel on the right stays put and shows the stage's picture —
// the same four example orders the table below spells out, at each point in
// their life. This is the sticky-scroll-reveal's mechanics (scroll progress
// picks the active step, the visual is sticky) on page scroll with our own
// surfaces, not its fixed-height dark scroller.
//
// At phone width the picture sits under each step instead. Under
// prefers-reduced-motion nothing fades and the beam does not run.

import { useEffect, useRef, useState } from "react";
import { useMotionValueEvent, useScroll } from "motion/react";
import { Container } from "@/components/container";
import { SectionHead } from "@/components/landing/sections";
import { AnimatedBeamPathIllustration } from "@/components/ui/animated-path";
import { Scales } from "@/components/ui/scales";

const STEPS = [
  { n: "stage 1", h: "Open", p: "A new auction opens for each ticker." },
  { n: "stage 2", h: "Orders", p: "Buy or sell, how many, at what price. Funds wait in escrow." },
  { n: "stage 3", h: "Freeze", p: "The final stretch. No more cancelling.", freeze: true },
  { n: "stage 4", h: "The cross", p: "One price: the one that trades the most shares." },
  { n: "stage 5", h: "Settle", p: "Everyone fills at that price. Unused escrow returns." },
];

const EXAMPLE = [
  { side: "Sell", limit: "$240.00", qty: "10", out: "All 10 sold at $247.50, $7.50 more than asked" },
  { side: "Buy", limit: "$250.00", qty: "10", out: "All 10 bought at $247.50, $25 returned" },
  { side: "Sell", limit: "$245.00", qty: "5", out: "Not filled; shares returned" },
  { side: "Buy", limit: "$243.00", qty: "8", out: "Not filled; money returned" },
];

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

function OrderRow({ o, dim, out }: { o: (typeof EXAMPLE)[number]; dim?: boolean; out?: boolean }) {
  return (
    <div className={`flex items-baseline gap-3 border-b border-line py-2.5 last:border-b-0 ${dim ? "opacity-50" : ""}`}>
      <span className={`w-9 text-[12px] font-semibold ${o.side === "Buy" ? "text-bid" : "text-ask"}`}>{o.side}</span>
      <span className="num w-16 text-[13px] text-text">{o.limit}</span>
      <span className="num w-8 text-[13px] text-text-2">{o.qty}</span>
      {out && <span className="flex-1 text-[12px] text-text-2">{o.out}</span>}
    </div>
  );
}

/** The stage's picture: the same four orders, at that point in their life. */
function Picture({ step, reduced }: { step: number; reduced: boolean }) {
  if (step === 0)
    return (
      <div className="flex h-full flex-col justify-center gap-4">
        <div className="eyebrow">A new auction</div>
        {reduced ? (
          <svg className="h-12 w-full" viewBox="0 0 600 80" preserveAspectRatio="none" aria-hidden="true">
            <path d="M 0 40 L 100 40 L 200 15 L 400 15 L 500 40 L 600 40" stroke="var(--line)" strokeWidth="2" strokeDasharray="1 6" strokeLinecap="round" fill="none" />
          </svg>
        ) : (
          <AnimatedBeamPathIllustration />
        )}
        <div className="num text-[12.5px] text-muted">IBMx · opens, takes orders for ~20 minutes, then crosses</div>
      </div>
    );
  if (step === 1)
    return (
      <div>
        <div className="eyebrow mb-2">Four orders arrive</div>
        {EXAMPLE.map((o) => (
          <OrderRow key={o.out} o={o} />
        ))}
        <div className="num mt-3 text-[12px] text-muted">Each one's funds wait in escrow.</div>
      </div>
    );
  if (step === 2)
    return (
      <div className="relative flex h-full flex-col justify-center overflow-hidden rounded-lg">
        <Scales orientation="diagonal" size={10} />
        <div className="relative px-4 py-8 text-center">
          <div className="eyebrow text-amber">Frozen</div>
          <div className="mt-2 text-[15px] font-semibold text-text">Orders still accepted. Cancelling is closed.</div>
          <div className="num mt-1 text-[12px] text-muted">the last 700 slots before the cross</div>
        </div>
      </div>
    );
  if (step === 3)
    return (
      <div>
        <div className="eyebrow">The price that trades the most shares</div>
        <div className="display-tight num mt-2 text-[44px] leading-none font-semibold text-text">$247.50</div>
        <div className="num mt-2 text-[12.5px] text-muted">10 shares change hands · buyers at ≥ $247.50 meet sellers at ≤ $247.50</div>
        <div className="mt-4">
          {EXAMPLE.map((o, i) => (
            <OrderRow key={o.out} o={o} dim={i >= 2} />
          ))}
        </div>
      </div>
    );
  return (
    <div>
      <div className="eyebrow mb-2">Everyone fills at $247.50</div>
      {EXAMPLE.map((o) => (
        <OrderRow key={o.out} o={o} out />
      ))}
    </div>
  );
}

export function HowItWorksV2() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLOListElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start center", "end center"] });
  useMotionValueEvent(scrollYProgress, "change", (v) => {
    setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length))));
  });

  return (
    <Container as="section" id="how" className="py-16 md:py-24">
      <SectionHead
        eyebrow="How it works"
        title="Collect, freeze, cross, settle. Every few minutes."
        lede="Orders do not trade the moment they arrive. They wait for each other, and then they all trade at once."
      />

      <div className="mt-10 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:gap-14">
        {/* A real sequence, so the numbering carries the order of events rather than decorating them. */}
        <ol ref={ref} className="flex flex-col">
          {STEPS.map((s, i) => {
            const on = i === active;
            return (
              <li
                key={s.h}
                className={`relative border-l-2 py-8 pl-6 transition-colors duration-300 lg:min-h-[52vh] lg:py-10 ${
                  on ? "border-accent" : "border-line"
                } ${reduced ? "" : on ? "lg:opacity-100" : "lg:opacity-45"} ${reduced ? "" : "transition-opacity"}`}
              >
                <span className="num text-xs text-muted">{s.n}</span>
                <h3 className={`mt-1 text-[22px] leading-tight font-semibold md:text-[26px] ${s.freeze ? "text-amber" : "text-text"}`}>
                  {s.h}
                </h3>
                <p className="mt-2 max-w-[38ch] text-[15.5px] text-text-2">{s.p}</p>
                {/* Phone width: the picture under its step. */}
                <div className="mt-5 rounded-xl border border-line bg-surface p-5 lg:hidden">
                  <Picture step={i} reduced={reduced} />
                </div>
              </li>
            );
          })}
        </ol>

        <div className="hidden lg:block">
          <div className="sticky top-24">
            <div className="min-h-[360px] rounded-2xl border border-line bg-surface p-7 shadow-[0_24px_80px_-40px_rgba(11,14,20,0.3)]">
              <Picture step={active} reduced={reduced} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-12 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <caption className="px-4 pt-4 text-left text-[13px] text-muted">
            One auction, four orders, clearing at $247.50.
          </caption>
          <thead>
            <tr>
              {["Order", "Limit", "Shares", "At the cross of $247.50"].map((h) => (
                <th
                  key={h}
                  className="num border-b border-line px-4 py-3 text-left text-[11.5px] tracking-[0.06em] text-muted uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EXAMPLE.map((r) => (
              <tr key={r.out}>
                <td className={`border-t border-line px-4 py-3 font-semibold ${r.side === "Buy" ? "text-bid" : "text-ask"}`}>
                  {r.side}
                </td>
                <td className="num border-t border-line px-4 py-3">{r.limit}</td>
                <td className="num border-t border-line px-4 py-3">{r.qty}</td>
                <td className="border-t border-line px-4 py-3 text-text-2">{r.out}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-[62ch] text-sm text-text-2">
        Nobody trades at a worse price than they asked for, and nobody in an auction gets a worse price than anyone
        else in it.
      </p>
    </Container>
  );
}
