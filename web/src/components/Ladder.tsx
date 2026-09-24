// The book as a ladder: asks above, bids below, each level with its own size
// and the cumulative size behind it as a bar, the way an exchange draws
// depth. The indicative cross sits between the two sides.

import { levels, type BookOrder } from "../lib/book";
import { fmtPrice, fmtShares } from "../lib/format";

interface Props {
  book: BookOrder[];
  indicative: { price: number; volume: number } | null;
  crossed: boolean;
}

export function Ladder({ book, indicative, crossed }: Props) {
  const lv = levels(book);
  const asks = lv.filter((l) => l.sellShares > 0).sort((a, b) => b.price - a.price);
  const bids = lv.filter((l) => l.buyShares > 0).sort((a, b) => b.price - a.price);
  const max = Math.max(1, ...asks.map((l) => l.supply), ...bids.map((l) => l.demand));

  const row = (side: "ask" | "bid", price: number, size: number, cum: number) => (
    <div key={`${side}-${price}`} className={`ladder-row ladder-${side}`} style={{ ["--w" as string]: `${(cum / max) * 100}%` }}>
      <span className="num ladder-px">{fmtPrice(price)}</span>
      <span className="num ladder-sz">{fmtShares(size)}</span>
      <span className="num ladder-cum">{fmtShares(cum)}</span>
    </div>
  );

  return (
    <div className="ladder" aria-label="Order book ladder">
      <div className="ladder-head num">
        <span>price</span>
        <span>size</span>
        <span>cumulative</span>
      </div>
      {book.length === 0 ? (
        <div className="empty small">No live orders.</div>
      ) : (
        <>
          <div className="ladder-side">{asks.map((l) => row("ask", l.price, l.sellShares, l.supply))}</div>
          <div className={`ladder-mid num${indicative && indicative.volume > 0 ? "" : " ladder-mid-none"}`}>
            {indicative && indicative.volume > 0 ? (
              <>
                <span>{crossed ? "cleared at" : "would clear at"}</span>
                <b>{fmtPrice(indicative.price)}</b>
                <span>{fmtShares(indicative.volume)} shares {crossed ? "traded" : "would trade"}</span>
              </>
            ) : (
              <span>no cross yet — buyers and sellers do not overlap</span>
            )}
          </div>
          <div className="ladder-side">{bids.map((l) => row("bid", l.price, l.buyShares, l.demand))}</div>
        </>
      )}
    </div>
  );
}
