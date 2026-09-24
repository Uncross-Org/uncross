import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useEffect, useRef, useState } from "react";
import type { ClusterConfig, TickerConfig } from "../config";
import type { Auction, Phase } from "../lib/auction";
import { fmtPrice, fmtShares, fmtUsd } from "../lib/format";
import type { OrderAccount } from "../lib/order";
import { orderStatus, receiptOf, STATUS_HELP, type MyOrder } from "../lib/settlement";
import { cancelOrderIx, errorMessage, getProgram, sendIxs } from "../lib/tx";
import { programToPerShare, quoteToUsd, rawToShares } from "../lib/units";
import { latestReceiptGroup, Receipt } from "./Receipt";

// Your orders for this ticker: the result of your last auction, kept on screen
// after the next auction opens, then your orders in the auction running now.

interface Props {
  tk: TickerConfig;
  cluster: ClusterConfig;
  auction: Auction | null;
  phase: Phase | null;
  m: number;
  /** Your orders in the current auction, read with its book. */
  mine: OrderAccount[];
  /** Every order this wallet has placed, from its own order accounts. */
  myOrders: MyOrder[] | null;
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onChange: () => void;
  onOpenOrders: () => void;
}

export function MyOrders({ tk, cluster, auction, phase, m, mine, myOrders, notify, onChange, onOpenOrders }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [busy, setBusy] = useState<number | null>(null);
  const group = latestReceiptGroup(myOrders, tk.mint);

  // Tell the wallet the moment one of its orders crosses, whichever auction is
  // on screen by then.
  const seen = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    if (!myOrders) return;
    for (const o of myOrders) {
      const k = o.order.address.toBase58();
      const crossed = o.auction ? o.auction.status !== "open" : !!o.settled;
      const before = seen.current.get(k);
      seen.current.set(k, crossed);
      if (before !== false || !crossed || o.order.cancelled) continue;
      const r = receiptOf(o);
      if (!r) continue;
      const sym = o.tickerMint === tk.mint ? tk.symbol : "Your auction";
      const price = r.clearingPrice != null ? ` at ${fmtPrice(programToPerShare(r.clearingPrice, m))}` : "";
      notify("ok", `${sym} crossed${price}. Your ${r.side}: ${r.status.toLowerCase()}. The result is under Your orders.`);
    }
  }, [myOrders, tk, m, notify]);

  if (!wallet.publicKey) {
    return (
      <section className="card mine">
        <div className="card-head">
          <h2>Your orders</h2>
        </div>
        <div className="empty small">Connect a wallet to see your orders and what they came to.</div>
      </section>
    );
  }

  async function cancel(o: OrderAccount) {
    if (!auction) return;
    setBusy(o.orderIndex);
    try {
      const ix = await cancelOrderIx(getProgram(connection), auction, wallet.publicKey!, o.orderIndex);
      const sig = await sendIxs(connection, wallet, [ix], 300_000);
      notify("ok", "Order cancelled. Everything it locked is back in your wallet.", sig);
      onChange();
    } catch (e) {
      notify("err", errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  // The running auction's orders. Once it crosses, its receipt says it all.
  const running = auction && auction.status === "open" ? mine : [];
  const receiptIsCurrent = !!auction && group[0]?.auctionAddress === auction.address.toBase58();

  return (
    <section className="card mine" aria-label="Your orders">
      <div className="card-head">
        <h2>Your orders</h2>
        {running.length > 0 && <span className="muted small">{running.length} in the running auction</span>}
        <button className="link-btn" onClick={onOpenOrders}>
          All your orders →
        </button>
      </div>

      {group.length > 0 && <Receipt tk={tk} m={m} cluster={cluster} items={group} />}

      {running.length === 0 ? (
        !group.length && (
          <div className="empty small">
            {myOrders === null ? "Reading your orders…" : `You have no ${tk.symbol} orders yet. Place one and its result will show here after the cross.`}
          </div>
        )
      ) : (
        <>
          {group.length > 0 && !receiptIsCurrent && <div className="mine-sub">In the running auction</div>}
          <div className="table-scroll mine-scroll">
            <table className="tbl num">
              <thead>
                <tr>
                  <th>Side</th>
                  <th>Limit / share</th>
                  <th>Shares</th>
                  <th>Locked</th>
                  <th>Status</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {running.map((o) => {
                  const qty = rawToShares(o.quantity, m);
                  const locked = o.side === "buy" ? fmtUsd(quoteToUsd(o.escrowAmount)) : `${fmtShares(qty)} shares`;
                  const status = orderStatus(o, auction, phase, null);
                  const canCancel = status === "Open";
                  return (
                    <tr key={o.orderIndex} className={o.cancelled ? "dim" : ""}>
                      <td>
                        <span className={`order-side order-side-${o.side}`}>{o.side === "buy" ? "Buy" : "Sell"}</span>
                      </td>
                      <td>{fmtPrice(programToPerShare(o.limitPrice, m))}</td>
                      <td>{fmtShares(qty)}</td>
                      <td>{o.cancelled ? "returned" : locked}</td>
                      <td className="status" title={STATUS_HELP[status]}>
                        {status}
                      </td>
                      <td className="act">
                        {!o.cancelled && (
                          <button
                            className="btn btn-ghost sm"
                            disabled={!canCancel || busy !== null}
                            title={canCancel ? "Cancel and get back what it locked" : STATUS_HELP.Frozen}
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
        </>
      )}
    </section>
  );
}
