import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import type { TickerConfig } from "../config";
import type { Auction, Phase } from "../lib/auction";
import { fmtPrice, fmtShares, fmtUsd } from "../lib/format";
import type { OrderAccount } from "../lib/order";
import { cancelOrderIx, errorMessage, getProgram, sendIxs } from "../lib/tx";
import { programToPerShare, quoteToUsd, rawToShares } from "../lib/units";

interface Props {
  tk: TickerConfig;
  auction: Auction;
  phase: Phase;
  m: number;
  mine: OrderAccount[];
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onChange: () => void;
}

export function MyOrders({ tk, auction, phase, m, mine, notify, onChange }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [busy, setBusy] = useState<number | null>(null);
  const crossed = phase === "cleared" || phase === "settled";
  const clearing = programToPerShare(auction.clearingPrice, m);

  if (!wallet.publicKey) {
    return (
      <section className="card mine">
        <div className="card-head">
          <h2>Your orders</h2>
        </div>
        <div className="empty small">Connect a wallet to see your orders in this auction.</div>
      </section>
    );
  }

  async function cancel(o: OrderAccount) {
    setBusy(o.orderIndex);
    try {
      const ix = await cancelOrderIx(getProgram(connection), auction, wallet.publicKey!, o.orderIndex);
      const sig = await sendIxs(connection, wallet, [ix], 300_000);
      notify("ok", "Order cancelled and refunded", sig);
      onChange();
    } catch (e) {
      notify("err", errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // Post-cross totals, from the auction's own order summaries.
  let bought = 0,
    sold = 0,
    paid = 0,
    received = 0,
    refundUsd = 0,
    returnedShares = 0;
  if (crossed) {
    for (const o of mine) {
      const s = auction.orders[o.orderIndex];
      if (!s || o.cancelled) continue;
      if (o.side === "buy") {
        bought += rawToShares(s.filledQuantity, m);
        paid += quoteToUsd(s.quoteAmount);
        refundUsd += quoteToUsd(o.escrowAmount - s.quoteAmount);
      } else {
        sold += rawToShares(s.filledQuantity, m);
        received += quoteToUsd(s.quoteAmount);
        returnedShares += rawToShares(o.quantity - s.filledQuantity, m);
      }
    }
  }
  const settledAll = mine.every((o) => o.settled);

  return (
    <section className="card mine" aria-label="Your orders">
      <div className="card-head">
        <h2>Your orders</h2>
        {mine.length > 0 && <span className="muted small">{mine.length} in this auction</span>}
      </div>

      {crossed && mine.some((o) => !o.cancelled) && (
        <div className="result">
          <div className="result-title">
            {auction.executableVolume > 0n ? <>Cleared at <b className="num">{fmtPrice(clearing)}</b> per share</> : "No trade this round"}
            <span className={`tag ${settledAll ? "tag-live" : "tag-ext"}`}>{settledAll ? "Settled to your wallet" : "Awaiting settlement"}</span>
          </div>
          <div className="result-grid num">
            {bought > 0 && (
              <div>
                <span>You bought</span>
                <b>{fmtShares(bought)} {tk.symbol}</b>
                <small>paid {fmtUsd(paid)}</small>
              </div>
            )}
            {sold > 0 && (
              <div>
                <span>You sold</span>
                <b>{fmtShares(sold)} {tk.symbol}</b>
                <small>received {fmtUsd(received)}</small>
              </div>
            )}
            {refundUsd > 0 && (
              <div>
                <span>Refunded</span>
                <b>{fmtUsd(refundUsd)}</b>
                <small>unused buy escrow</small>
              </div>
            )}
            {returnedShares > 0 && (
              <div>
                <span>Returned</span>
                <b>{fmtShares(returnedShares)} {tk.symbol}</b>
                <small>unsold shares</small>
              </div>
            )}
            {bought === 0 && sold === 0 && <div><span>Your orders didn't fill</span><small>all escrow is returned at settlement</small></div>}
          </div>
        </div>
      )}

      {mine.length === 0 ? (
        <div className="empty small">You have no orders in this auction.</div>
      ) : (
        <div className="table-scroll">
          <table className="tbl num">
            <thead>
              <tr>
                <th>Side</th>
                <th>Price / share</th>
                <th>Shares</th>
                <th>{crossed ? "Filled" : "Locked"}</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {mine.map((o) => {
                const s = auction.orders[o.orderIndex];
                const qty = rawToShares(o.quantity, m);
                const locked = o.side === "buy" ? fmtUsd(quoteToUsd(o.escrowAmount)) : `${fmtShares(qty)} sh`;
                const status = o.cancelled
                  ? "Cancelled · refunded"
                  : o.refunded
                    ? "Refunded"
                    : crossed
                      ? o.settled
                        ? "Settled"
                        : "Awaiting settlement"
                      : phase === "freeze"
                        ? "Locked in"
                        : "Resting";
                const canCancel = phase === "open" && !o.cancelled && !o.settled;
                return (
                  <tr key={o.orderIndex} className={o.cancelled ? "dim" : ""}>
                    <td>
                      <span className={`side side-${o.side}`}>{o.side === "buy" ? "Buy" : "Sell"}</span>
                    </td>
                    <td>{fmtPrice(programToPerShare(o.limitPrice, m))}</td>
                    <td>{fmtShares(qty)}</td>
                    <td>{crossed && s && !o.cancelled ? fmtShares(rawToShares(s.filledQuantity, m)) : locked}</td>
                    <td className="status">{status}</td>
                    <td className="act">
                      {!crossed && !o.cancelled && (
                        <button
                          className="btn btn-ghost sm"
                          disabled={!canCancel || busy !== null}
                          title={canCancel ? "Cancel and refund" : "Cancellations are closed during the freeze window"}
                          onClick={() => cancel(o)}
                        >
                          {busy === o.orderIndex ? "…" : "Cancel"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
