import type { TickerConfig } from "../config";
import type { Auction, Phase } from "../lib/auction";
import { bestBidAsk, type BookOrder } from "../lib/book";
import { fmtDuration, fmtEt, fmtEtDay, fmtEtShort, fmtPct, fmtPrice, fmtShares, fmtUsd } from "../lib/format";
import type { RefState } from "../lib/reference";
import { programToPerShare, rawToShares } from "../lib/units";
import { Flash } from "./Flash";

interface Props {
  tk: TickerConfig;
  ref_: RefState;
  auction: Auction | null;
  phase: Phase | null;
  book: BookOrder[];
  m: number | null;
  now: number;
  loadingAuction: boolean;
  /** Devnet auctions trade test tokens, so comparing them to real Pyth prices is meaningless. */
  isMainnet: boolean;
}

function ReferenceSide({ tk, r, now }: { tk: TickerConfig; r: RefState; now: number }) {
  const reopen = r.market?.nextOpen ? (
    <div className="ref-sub">
      NASDAQ reopens {fmtEtShort(r.market.nextOpen)} · in {fmtDuration(r.market.nextOpen - now)}
    </div>
  ) : null;

  if (r.kind === "none") {
    return (
      <div className="hero-side ref">
        <div className="hero-label">
          <span className="dot dot-off" /> NASDAQ reference · Pyth
        </div>
        <div className="hero-none">No Pyth price on Solana for {tk.underlying}</div>
        <div className="ref-sub strong">The auction book is the only on-chain price.</div>
        {r.market && (r.market.open ? <div className="ref-sub">NASDAQ regular session is open.</div> : reopen)}
      </div>
    );
  }
  if (r.kind === "loading") {
    return (
      <div className="hero-side ref">
        <div className="hero-label">NASDAQ reference · Pyth</div>
        <div className="hero-price skeleton">&nbsp;</div>
        <div className="ref-sub">Reading Pyth on Solana mainnet…</div>
      </div>
    );
  }
  if (r.kind === "error" || r.price == null) {
    return (
      <div className="hero-side ref">
        <div className="hero-label">NASDAQ reference · Pyth</div>
        <div className="hero-none">Reference price unavailable</div>
        <div className="ref-sub">Couldn't reach Solana mainnet. Retrying.</div>
      </div>
    );
  }
  if (r.kind === "stale") {
    return (
      <div className="hero-side ref">
        <div className="hero-label">
          <span className="dot dot-warn" /> NASDAQ reference · Pyth
        </div>
        <div className="hero-none warn">No reference price for {fmtDuration(r.ageMs!)}</div>
        <div className="ref-stale num">
          last print {fmtPrice(r.price)} at {fmtEt(r.publishMs!)}
          {now - r.publishMs! > 20 * 3600_000 ? ` · ${fmtEtDay(r.publishMs!)}` : ""} <span className="tag">stale</span>
        </div>
        {r.market && !r.market.open ? reopen : null}
      </div>
    );
  }
  const regular = r.kind === "regular";
  return (
    <div className="hero-side ref">
      <div className="hero-label">
        <span className={`dot ${regular ? "dot-live" : "dot-ext"}`} /> NASDAQ reference · Pyth
        {regular ? <span className="tag tag-live">Trading</span> : r.kind === "extended" ? <span className="tag tag-ext">Extended hours</span> : null}
      </div>
      <div className="hero-price num">
        <Flash value={r.price.toFixed(4)}>{fmtPrice(r.price)}</Flash>
      </div>
      <div className="ref-sub num">
        {r.kind === "extended"
          ? "NASDAQ closed · Pyth still publishing extended-hours prices"
          : regular
            ? "Regular session · live reference"
            : "Live print"}
        {" · "}updated {Math.round(r.ageMs! / 1000)}s ago
      </div>
    </div>
  );
}

export function Hero({ tk, ref_, auction, phase, book, m, now, loadingAuction, isMainnet }: Props) {
  const crossed = phase === "cleared" || phase === "settled";
  let right: JSX.Element;
  if (!tk.mint) {
    right = (
      <div className="hero-side venue">
        <div className="hero-label">Uncross auction</div>
        <div className="hero-none">{tk.symbol} isn't listed on this network yet</div>
      </div>
    );
  } else if (loadingAuction || m == null) {
    right = (
      <div className="hero-side venue">
        <div className="hero-label">Uncross auction</div>
        <div className="hero-price skeleton">&nbsp;</div>
        <div className="ref-sub">Loading the book…</div>
      </div>
    );
  } else if (!auction) {
    right = (
      <div className="hero-side venue">
        <div className="hero-label">Uncross auction</div>
        <div className="hero-none">No auction yet for {tk.symbol}</div>
        <div className="ref-sub">The first auction window hasn't been opened on this network.</div>
      </div>
    );
  } else {
    const priceRaw = crossed ? auction.clearingPrice : auction.indicativePrice;
    const volRaw = crossed ? auction.executableVolume : auction.indicativeVolume;
    const price = programToPerShare(priceRaw, m);
    const vol = rawToShares(volRaw, m);
    const { bid, ask } = bestBidAsk(book);
    const flashKey = `${priceRaw}|${volRaw}`;
    const vsRef = isMainnet && ref_.price != null && volRaw > 0n ? ((price - ref_.price) / ref_.price) * 100 : null;
    right = (
      <div className="hero-side venue">
        <div className="hero-label">
          <span className={`dot ${crossed ? "dot-done" : "dot-accent"}`} />
          {crossed ? "Uncross clearing price" : "Uncross indicative cross"}
          {!crossed && volRaw > 0n && <span className="tag">updates on every order</span>}
        </div>
        {volRaw > 0n ? (
          <>
            <div className="hero-price num accent">
              <Flash value={flashKey}>{fmtPrice(price)}</Flash>
            </div>
            <div className="hero-vol num">
              <Flash value={flashKey}>
                <strong>{fmtShares(vol)}</strong> shares {crossed ? "crossed" : "executable"} · {fmtUsd(vol * price)}
              </Flash>
            </div>
            {vsRef != null && (
              <div className={`ref-sub num ${ref_.fresh ? "" : "muted"}`}>
                {fmtPct(vsRef)} vs {ref_.fresh ? "Pyth" : "last Pyth print"}
              </div>
            )}
            {!isMainnet && <div className="ref-sub muted">Devnet test prices</div>}
          </>
        ) : crossed ? (
          <>
            <div className="hero-none">No trade this round</div>
            <div className="ref-sub">Buyers and sellers didn't overlap. All escrow is returned.</div>
          </>
        ) : (
          <>
            <div className="hero-none">
              <Flash value={flashKey}>{book.length ? "Book not crossing yet" : "No orders yet"}</Flash>
            </div>
            <div className="hero-vol num">
              Best bid <strong>{fmtPrice(bid)}</strong> · Best ask <strong>{fmtPrice(ask)}</strong>
            </div>
            <div className="ref-sub">A price appears as soon as a buy meets a sell.</div>
          </>
        )}
      </div>
    );
  }

  return (
    <section className="hero card" aria-label="Reference price versus auction price">
      <ReferenceSide tk={tk} r={ref_} now={now} />
      <div className="hero-vs" aria-hidden>
        vs
      </div>
      {right}
    </section>
  );
}
