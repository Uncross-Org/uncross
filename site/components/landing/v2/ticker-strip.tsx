"use client";

// The ticker strip: every listed ticker with its last cross, from the same
// venue read the rest of the page uses. Built on the mechanics of the
// template's infinite-moving-cards — the row is duplicated once and slid by a
// CSS keyframe, paused on hover — with our own chips instead of its
// testimonial cards. Under prefers-reduced-motion the row simply sits still
// and scrolls by hand.
//
// Nothing here is made up: a ticker with no cross yet says so.

import { useEffect, useMemo, useState } from "react";
import { CLUSTER, TICKERS } from "@/lib/uncross/config";
import { useVenueAll } from "@/lib/use-venue";
import { fmtPrice } from "@/lib/uncross/format";
import { programToPerShare } from "@/lib/uncross/units";
import { isReserved, RESERVED_LABEL, RESERVED_SHORT } from "@/lib/uncross/reserved";

const SLOT_MS = 400;

function ago(slots: number): string {
  const s = Math.max(0, Math.round((slots * SLOT_MS) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

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

interface Chip {
  symbol: string;
  name: string;
  line: string; // what the price is: last cross, indicative, or nothing yet
  price: string | null;
  tone: "cross" | "indicative" | "none";
}

export function TickerStrip() {
  const { auctions, slot, loading } = useVenueAll();
  const reduced = usePrefersReducedMotion();

  const chips = useMemo<Chip[]>(
    () =>
      TICKERS.map((symbol) => {
        const name = CLUSTER.tickers[symbol]?.name ?? symbol;
        const mine = auctions.filter((a) => a.ticker === symbol);
        const crossed = mine.filter((a) => a.executableVolume > 0n).sort((x, y) => y.closeSlot - x.closeSlot)[0];
        const running = mine.find((a) => a.status === "open" && a.indicativeVolume > 0n);
        if (crossed) {
          return {
            symbol,
            name,
            price: fmtPrice(programToPerShare(crossed.clearingPrice, 1)),
            line: slot != null ? `crossed ${ago(slot - crossed.closeSlot)}` : "last cross",
            tone: "cross",
          };
        }
        if (running) {
          return {
            symbol,
            name,
            price: fmtPrice(programToPerShare(running.indicativePrice, 1)),
            line: "indicative, auction open",
            tone: "indicative",
          };
        }
        return { symbol, name, price: null, line: loading ? "reading…" : "no cross yet", tone: "none" };
      }),
    [auctions, slot, loading],
  );

  const row = (dup: boolean) =>
    chips.map((c) => (
      <li
        key={`${c.symbol}${dup ? "-dup" : ""}`}
        aria-hidden={dup || undefined}
        className="flex shrink-0 items-baseline gap-3 rounded-lg border border-line bg-surface px-4 py-2.5"
      >
        <span className="text-[13px] font-semibold text-text">{c.symbol}</span>
        <span className="num text-[15px] font-semibold tabular-nums text-text">{c.price ?? "—"}</span>
        {/* The chip has room for a word, not a sentence; the sentence is still
            there for anyone hovering or reading with a screen reader. */}
        {isReserved(c.symbol) ? (
          <span
            title={RESERVED_LABEL}
            className="num rounded-md border border-accent/40 bg-accent-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-accent"
          >
            {RESERVED_SHORT}
            <span className="sr-only"> — {RESERVED_LABEL}</span>
          </span>
        ) : (
          <span className={`num text-[11.5px] ${c.tone === "cross" ? "text-muted" : c.tone === "indicative" ? "text-accent" : "text-muted"}`}>
            {c.line}
          </span>
        )}
      </li>
    ));

  return (
    <section aria-label="Tickers and their last cross" className="border-y border-line bg-bg">
      <div
        className={
          reduced
            ? "overflow-x-auto"
            : "overflow-hidden [mask-image:linear-gradient(to_right,transparent,white_8%,white_92%,transparent)]"
        }
      >
        <ul
          className={`flex w-max min-w-full flex-nowrap gap-3 py-3 ${reduced ? "px-4" : "ticker-scroll hover:[animation-play-state:paused]"}`}
          style={reduced ? undefined : { ["--ticker-duration" as string]: `${Math.max(40, chips.length * 6)}s` }}
        >
          {row(false)}
          {!reduced && row(true)}
        </ul>
      </div>
    </section>
  );
}
