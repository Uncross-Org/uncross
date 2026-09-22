"use client";

// Live proof: the IBMx book — the ticker Jupiter cannot route — trading here,
// read from devnet in the browser, with the crosses already settled beneath
// it, every one a link to its account on the explorer.
//
// The frame is a laptop whose lid opens as the section comes into view, an
// idea taken from the template's macbook skeleton and rebuilt at a size that
// holds a legible chart; it rests fully open so nothing is skewed, and under
// prefers-reduced-motion it simply stands open. The cards below use the
// card-hover-effect's mechanics — one shared highlight that slides between
// cards — on our surfaces.

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Container } from "@/components/container";
import { SectionHead } from "@/components/landing/sections";
import { DepthChart } from "@/components/landing/depth-chart";
import { explorerAddr } from "@/lib/uncross/config";
import { fmtEt, fmtPrice, fmtShares } from "@/lib/uncross/format";
import { programToPerShare, rawToShares } from "@/lib/uncross/units";
import { useVenue } from "@/lib/use-venue";

const TICKER = "IBMx";

const PHASE_LABEL: Record<string, string> = {
  upcoming: "Opening",
  open: "Taking orders",
  freeze: "Frozen — no more cancelling",
  "awaiting-cross": "Awaiting the cross",
  cleared: "Cleared",
  settled: "Settled",
};

const FOR = [
  {
    title: "Thin tickers",
    body: "Names like IBMx, whose pool holds a few thousand dollars. Orders meet each other instead of walking a curve.",
  },
  {
    title: "Hours when the tape is thin",
    body: "The reference price keeps printing overnight, but with no session marker you cannot tell a thin print from a liquid one. A book that clears on its own orders does not need to.",
  },
  {
    title: "Same price, same moment",
    body: "Everyone who trades in one auction trades at one price, whatever they each bid or asked.",
  },
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

/** Cards with one highlight that slides to whichever is under the pointer. */
function HoverCards({ items, group }: { items: { key: string; href?: string; head: React.ReactNode; body: React.ReactNode }[]; group: string }) {
  const [hovered, setHovered] = useState<number | null>(null);
  return (
    <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((it, i) => {
        const Tag = it.href ? "a" : "div";
        return (
          <Tag
            key={it.key}
            href={it.href}
            target={it.href ? "_blank" : undefined}
            rel={it.href ? "noreferrer" : undefined}
            className="group relative block h-full p-1.5"
            onMouseEnter={() => setHovered(i)}
            onMouseLeave={() => setHovered(null)}
          >
            <AnimatePresence>
              {hovered === i && (
                <motion.span
                  layoutId={`hover-${group}`}
                  className="absolute inset-0 block rounded-2xl bg-raise"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1, transition: { duration: 0.15 } }}
                  exit={{ opacity: 0, transition: { duration: 0.15, delay: 0.2 } }}
                />
              )}
            </AnimatePresence>
            <div className="relative z-10 flex h-full flex-col gap-2 rounded-xl border border-line bg-surface p-5 transition-colors group-hover:border-accent/40">
              {it.head}
              {it.body}
            </div>
          </Tag>
        );
      })}
    </div>
  );
}

export function LiveSectionV2() {
  const reduced = usePrefersReducedMotion();
  const { book, indicative, traded, loading, error, phase, current, slot, readAt, stale } = useVenue(TICKER);
  const lidRef = useRef<HTMLDivElement>(null);
  // Opened by scroll position, measured directly, rather than an
  // IntersectionObserver, which has proven unreliable for reveals on this
  // page: once the frame's top passes 85% of the viewport it opens and stays open.
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = lidRef.current;
      if (el && el.getBoundingClientRect().top < window.innerHeight * 0.85) setInView(true);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);

  const slotsLeft = current && slot != null ? Math.max(0, current.closeSlot - slot) : null;
  const secsLeft = slotsLeft == null ? null : Math.round((slotsLeft * 400) / 1000);
  const open = reduced || inView;

  // overflow-x-clip, because the lid is a 3D object: while it is still shut,
  // perspective projects its 358px layout box to about 532px of visual bounds,
  // and those bounds gave the whole page a horizontal scrollbar on a phone
  // until the reader scrolled far enough to open it. Clip rather than hidden —
  // clip creates no scroll container, so the drop shadow and the sticky
  // sections elsewhere are untouched.
  return (
    <Container as="section" id="live" className="overflow-x-clip py-16 md:py-24">
      <SectionHead
        eyebrow="Live · no wallet needed"
        title="The auction running right now."
        lede="Real devnet transactions, every one clickable. This is the same data the app uses."
      />

      {/* When the devnet RPC rate-limits us, the page says how old its numbers
          are rather than showing nothing or passing them off as current. */}
      {stale && (
        <p className="mt-6 max-w-[68ch] rounded-lg border border-line bg-amber-soft px-4 py-3 text-sm text-text-2">
          <strong className="font-semibold text-amber">Showing the last good read.</strong> The public devnet RPC is
          rate-limiting this query, so these figures are from{" "}
          {readAt ? <span className="num">{fmtEt(readAt)}</span> : "an earlier read"} rather than this moment.
        </p>
      )}
      {!stale && error && (
        <p className="mt-6 max-w-[68ch] rounded-lg border border-line bg-raise px-4 py-3 text-sm text-text-2">
          Could not read devnet just now ({error}).
        </p>
      )}

      {/* The laptop: lid, screen, base. */}
      <div ref={lidRef} className="mx-auto mt-10 w-full max-w-4xl" style={{ perspective: 1600 }}>
        <motion.div
          initial={false}
          animate={{ rotateX: open ? 0 : -55 }}
          transition={reduced ? { duration: 0 } : { duration: 0.9, ease: [0.9, 0.02, 0, 1] }}
          style={{ transformOrigin: "50% 100%" }}
          className="rounded-t-2xl border border-line bg-raise p-2 shadow-[0_24px_80px_-32px_rgba(11,14,20,0.35)]"
        >
          <div className="rounded-t-xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div>
                <div className="eyebrow">
                  {TICKER} · current book{phase ? ` · ${PHASE_LABEL[phase] ?? phase}` : ""}
                </div>
                <div className="num mt-1 text-[13px] text-text-2">
                  {indicative
                    ? `would clear at ${fmtPrice(indicative.price)} · ${fmtShares(indicative.volume)} sh`
                    : loading
                      ? "reading…"
                      : "no crossing orders yet"}
                </div>
              </div>
              <div className="num text-right text-[13px] text-text-2">
                <span className="text-muted">{phase === "freeze" ? "freeze window" : "next cross"}</span>
                {secsLeft != null && (
                  <span className="ml-2 font-semibold text-text">
                    {secsLeft > 60 ? `${Math.floor(secsLeft / 60)}m ${String(secsLeft % 60).padStart(2, "0")}s` : `${secsLeft}s`}
                  </span>
                )}
              </div>
            </div>
            <div className="mt-3">
              <DepthChart book={book} indicative={indicative} loading={loading} height={300} />
            </div>
            <p className="mt-3 max-w-[70ch] text-[12.5px] text-muted">
              Each step is one order placed by a devnet wallet. The curves cross where the most shares can change hands
              — that price is what everyone in this auction will pay or receive.
            </p>
          </div>
        </motion.div>
        <div className="relative mx-auto h-3.5 w-[104%] -translate-x-[2%] rounded-b-2xl rounded-t-md border border-line bg-gradient-to-b from-raise to-line/60">
          <div className="absolute inset-x-0 top-0 mx-auto h-1.5 w-16 rounded-b-sm bg-line" />
        </div>
      </div>

      <div className="mt-12">
        <div className="eyebrow mb-3">Recent crosses · {TICKER}</div>
        {traded.length === 0 ? (
          <p className="text-sm text-text-2">{loading ? "Reading settled auctions…" : "No settled auctions read yet."}</p>
        ) : (
          <HoverCards
            group="crosses"
            items={traded.slice(0, 6).map((a) => ({
              key: a.address.toBase58(),
              href: explorerAddr(a.address.toBase58()),
              head: (
                <div className="num text-[20px] font-semibold text-text">
                  {fmtPrice(programToPerShare(a.clearingPrice, 1))}
                  <span className="ml-2 text-[13px] font-medium text-muted">× {fmtShares(rawToShares(a.executableVolume, 1))} sh</span>
                </div>
              ),
              body: (
                <div className="num flex items-baseline justify-between text-[12.5px] text-text-2">
                  <span>{a.orderCount} orders · slot {a.closeSlot.toLocaleString("en-US")}</span>
                  <span className="text-bid">explorer ↗</span>
                </div>
              ),
            }))}
          />
        )}
      </div>

      <div className="mt-14">
        <div className="eyebrow mb-3">What it&apos;s for · trades a continuous pool handles badly</div>
        <HoverCards
          group="for"
          items={FOR.map((f) => ({
            key: f.title,
            head: <h3 className="text-[17px] font-semibold text-text">{f.title}</h3>,
            body: <p className="text-[14.5px] text-text-2">{f.body}</p>,
          }))}
        />
      </div>
    </Container>
  );
}
