"use client";

// The hero's right column: the auction that is running right now, small.
//
// This deliberately does NOT repeat the depth chart in the wide card below.
// That card answers "what does the book look like"; this one answers "is
// anything happening". Orders appear as they land, the countdown runs down to
// the cross, and the indicative price moves with the book — all from the same
// live devnet read, no canned loop.

import { useEffect, useRef, useState } from "react";
import { fmtEt, fmtPrice, fmtShares } from "@/lib/uncross/format";
import { useVenue } from "@/lib/use-venue";

const PHASE_COPY: Record<string, string> = {
  upcoming: "Opening",
  open: "Taking orders",
  freeze: "Frozen",
  "awaiting-cross": "Crossing",
  cleared: "Cleared",
  settled: "Settled",
};

/** Devnet slots are ~400ms; good enough for a countdown, and labelled as approximate. */
const SLOT_MS = 400;

export function LivePulse() {
  const { current, book, indicative, phase, slot, loading, stale, readAt } = useVenue("AAPLx");

  // Newly arrived orders get marked once, so the animation marks a real event
  // rather than replaying on every render.
  const seen = useRef<Set<number>>(new Set());
  const [fresh, setFresh] = useState<Set<number>>(new Set());

  const live = book.slice().sort((a, b) => b.index - a.index);
  const key = live.map((o) => o.index).join(",");

  useEffect(() => {
    const arrived = live.filter((o) => !seen.current.has(o.index)).map((o) => o.index);
    live.forEach((o) => seen.current.add(o.index));
    if (arrived.length === 0) return;
    setFresh(new Set(arrived));
    const t = setTimeout(() => setFresh(new Set()), 1400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const running = phase === "open" || phase === "freeze" || phase === "upcoming";
  const slotsLeft = running && current && slot != null ? Math.max(0, current.closeSlot - slot) : null;
  const secsLeft = slotsLeft == null ? null : Math.round((slotsLeft * SLOT_MS) / 1000);
  const span = current ? current.closeSlot - current.openSlot : 0;
  const elapsed = current && slot != null ? Math.min(Math.max(slot - current.openSlot, 0), span) : 0;
  const pctDone = span > 0 ? (elapsed / span) * 100 : 0;
  const pctFreeze = current && span > 0 ? (current.freezeSlots / span) * 100 : 0;

  return (
    <aside
      className="flex flex-col gap-4 rounded-2xl border border-line bg-surface/80 p-5 backdrop-blur-sm"
      aria-label="The auction running now"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow flex items-center gap-2">
          <span
            className={`size-[7px] rounded-full ${phase === "freeze" ? "bg-amber" : running ? "bg-bid" : "bg-muted"} ${
              stale || !running ? "" : "pulse-dot"
            }`}
            aria-hidden="true"
          />
          {/* Only claim "running now" when it actually is. When the newest
              auction with a book has already crossed, say so. */}
          {running ? "Running now" : "Last auction"}
        </span>
        <span className={`num text-[11px] ${phase === "freeze" ? "text-amber" : "text-muted"}`}>
          {phase ? (PHASE_COPY[phase] ?? phase) : loading ? "reading…" : "—"}
        </span>
      </div>

      <div>
        <div className="num text-[11px] text-muted">{running ? "Would clear at" : "Cleared at"}</div>
        <div className="display-tight num text-[38px] leading-none font-semibold">
          {indicative ? fmtPrice(indicative.price) : "—"}
        </div>
        <div className="num mt-1 text-[11.5px] text-muted">
          {indicative ? `${fmtShares(indicative.volume)} shares would trade` : "no crossing orders yet"}
        </div>
      </div>

      {/* Open stretch, then the hatched freeze window, with a marker for now. */}
      <div>
        <div className="relative h-2 overflow-hidden rounded-[3px] bg-raise">
          <div className="absolute inset-y-0 right-0 hatch-freeze" style={{ width: `${pctFreeze}%` }} />
          <div className="absolute inset-y-0 left-0 bg-bid/45" style={{ width: `${pctDone}%` }} />
        </div>
        <div className="num mt-1.5 flex justify-between text-[11px] text-muted">
          <span>{current ? `${book.length} orders in` : "—"}</span>
          <span className={phase === "freeze" ? "text-amber" : ""}>
            {!running
              ? "crossed"
              : secsLeft == null
                ? "—"
                : secsLeft > 60
                  ? `~${Math.floor(secsLeft / 60)}m ${String(secsLeft % 60).padStart(2, "0")}s to cross`
                  : `~${secsLeft}s to cross`}
          </span>
        </div>
      </div>

      <div className="flex flex-col">
        <div className="num mb-1 text-[11px] text-muted">Orders as they arrive</div>
        {live.length === 0 ? (
          <p className="text-[12.5px] text-muted">
            {loading ? "Reading the book from devnet…" : "No orders in this auction yet."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {live.slice(0, 5).map((o) => (
              <li
                key={o.index}
                className={`num flex items-baseline justify-between gap-3 border-t border-line py-1.5 text-[12.5px] first:border-t-0 ${
                  fresh.has(o.index) ? "arrive" : ""
                }`}
              >
                <span className={o.side === "buy" ? "font-semibold text-bid" : "font-semibold text-ask"}>
                  {o.side === "buy" ? "Buy" : "Sell"}
                </span>
                <span className="text-text-2">{fmtShares(o.shares)}</span>
                <span>{fmtPrice(o.price)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {stale && readAt && (
        <p className="num text-[11px] text-amber">last read {fmtEt(readAt)} — devnet RPC is rate-limiting</p>
      )}
    </aside>
  );
}
