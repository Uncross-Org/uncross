// The numbers at the top of a ticker, in two groups that never mix.
//
// "This auction" is everything Uncross itself produces from the book: the
// price it would clear at, how much would trade, the best bid and ask, and when
// it crosses. "External reference" is the one number from outside — Pyth — with
// its age and what the program's own check made of it at the last cross. A
// first-time visitor should be able to say which number came from where in one
// glance, and every card says in a line what it means.
//
// Where each value comes from and how often it refreshes: docs/numbers.md.

import type { TickerConfig } from "../config";
import { GATE_REASONS, type Auction, type Phase } from "../lib/auction";
import type { BookOrder } from "../lib/book";
import { fmtDuration, fmtPct, fmtPrice, fmtShares } from "../lib/format";
import type { RefState } from "../lib/reference";

interface Props {
  tk: TickerConfig;
  phase: Phase | null;
  auction: Auction | null;
  indicative: { price: number; volume: number } | null;
  bid: number | null;
  ask: number | null;
  book: BookOrder[];
  ref_: RefState;
  vsRef: number | null;
  /** The most recent crossed auction of this ticker, for its recorded Pyth check. */
  lastCrossed: Auction | null;
  msToCross: number | null;
  msToFreeze: number | null;
  m: number | null;
}

export function AuctionStats({ tk, phase, auction, indicative, bid, ask, book, ref_, vsRef, lastCrossed, msToCross, msToFreeze, m }: Props) {
  const crossed = phase === "cleared" || phase === "settled";
  const trades = indicative != null && indicative.volume > 0;
  const buys = book.filter((o) => o.side === "buy").length;
  const sells = book.filter((o) => o.side === "sell").length;
  const overlap = bid != null && ask != null && bid >= ask;

  let timing: { value: string; sub: string };
  if (!auction || !phase) timing = { value: "—", sub: "No auction running for this ticker." };
  else if (phase === "open") timing = { value: fmtDuration(msToCross ?? 0), sub: `Orders can be cancelled for ${fmtDuration(msToFreeze ?? 0)} more.` };
  else if (phase === "freeze") timing = { value: fmtDuration(msToCross ?? 0), sub: "Frozen: orders are still accepted, no longer cancelled." };
  else if (phase === "awaiting-cross") timing = { value: "now", sub: "The window has closed; the cross runs in the next few seconds." };
  else if (phase === "upcoming") timing = { value: "soon", sub: "This auction has not opened yet." };
  else timing = { value: phase === "settled" ? "Settled" : "Crossed", sub: "The next auction opens right after this one crosses." };

  const gate = lastCrossed ? (GATE_REASONS[lastCrossed.oracleGate] ?? "not recorded") : null;

  return (
    <div className="stat-groups num">
      <section className="stat-group stat-group-venue" aria-label="This auction, from the Uncross book">
        <div className="stat-group-head">
          <span className="stat-group-title">This auction</span>
          <span className="stat-group-src">computed on chain from the orders in this book</span>
        </div>
        <div className="stat-row">
          <div className="stat">
            <span className="stat-l">{crossed ? "Cleared at" : "Would clear at"}</span>
            <span className="stat-v accent">{trades ? fmtPrice(indicative!.price) : "—"}</span>
            <span className="stat-s">
              {trades
                ? crossed
                  ? `${fmtShares(indicative!.volume)} shares traded, everyone at this one price.`
                  : `${fmtShares(indicative!.volume)} shares would trade if the auction crossed now. Recalculated with every order.`
                : book.length
                  ? "No buyer's limit reaches any seller's yet, so nothing would trade."
                  : "No orders yet. A price appears once a buy meets a sell."}
            </span>
          </div>
          <div className="stat">
            <span className="stat-l">Best bid</span>
            <span className="stat-v buy">{fmtPrice(bid)}</span>
            <span className="stat-s">
              The highest price a buyer will pay. {buys} buy order{buys === 1 ? "" : "s"}.
            </span>
          </div>
          <div className="stat">
            <span className="stat-l">Best ask</span>
            <span className="stat-v sell">{fmtPrice(ask)}</span>
            <span className="stat-s">
              The lowest price a seller will take. {sells} sell order{sells === 1 ? "" : "s"}.
            </span>
          </div>
          <div className="stat">
            <span className="stat-l">{phase === "open" || phase === "freeze" ? "Crosses in" : "Cross"}</span>
            <span className="stat-v">{timing.value}</span>
            <span className="stat-s">{timing.sub}</span>
          </div>
        </div>
        {overlap && !crossed && (
          <p className="stat-note">
            The best bid is above the best ask. Here that is normal: nothing executes on arrival, so buyers and sellers
            overlap until the cross, and the overlap is what trades.
          </p>
        )}
        {m != null && m !== 1 && <p className="stat-note">One token of {tk.symbol} is {m.toFixed(4)} shares. Every price and quantity here is per share.</p>}
      </section>

      <section className="stat-group stat-group-ref" aria-label="External reference price, not from Uncross">
        <div className="stat-group-head">
          <span className="stat-group-title">External reference</span>
          <span className="stat-group-src">not from Uncross</span>
        </div>
        <div className="stat">
          <span className="stat-l">Pyth · {tk.underlying}/USD</span>
          <span className={`stat-v${ref_.fresh ? "" : " muted"}`}>
            {ref_.price != null ? fmtPrice(ref_.price) : ref_.kind === "none" ? "No feed" : "—"}
          </span>
          <span className="stat-s">
            {ref_.kind === "none"
              ? `Pyth publishes no ${tk.underlying} price on Solana. This book is the only price.`
              : ref_.kind === "stale"
                ? `Last published ${fmtDuration(ref_.ageMs ?? 0)} ago: too old to use.`
                : ref_.fresh
                  ? `Published ${Math.round((ref_.ageMs ?? 0) / 1000)}s ago on Solana mainnet${ref_.kind === "extended" ? ", extended hours" : ""}.${vsRef != null ? ` The book would clear ${fmtPct(vsRef)} from it.` : ""}`
                  : "Reading Pyth…"}
          </span>
        </div>
        {tk.pythAccount && (
          <p className="stat-note">
            {gate
              ? `The program checks Pyth itself at the cross, on devnet, and uses it only to break a tie between equally good prices. Last check: ${gate === "passed" ? "passed" : `${gate}, not used`}.`
              : "The program checks Pyth itself at the cross, on devnet, and uses it only to break a tie between equally good prices."}
          </p>
        )}
      </section>
    </div>
  );
}
