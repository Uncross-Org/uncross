import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useState } from "react";
import { SETTLE_BATCH } from "../config";
import { PROGRAM } from "../hooks";
import type { Auction } from "../lib/auction";
import { fmtInt } from "../lib/format";
import { fetchOrders } from "../lib/order";
import { computeClearingIx, errorMessage, getProgram, sendIxs, sendMany, settleIx } from "../lib/tx";

interface Props {
  auctions: Auction[];
  slot: number | null;
  pythFeed: string | null;
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onDone: () => void;
}

/** Permissionless crank: anyone can run the cross and settle once a window closes. */
export function CrankPanel({ auctions, slot, pythFeed, notify, onDone }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState<string | null>(null);

  if (slot == null) return null;
  const due = auctions
    // A cleared auction with nothing left to settle is finished, even if it
    // predates the program fix that marks such auctions settled.
    .filter((a) => (a.status === "open" && slot >= a.closeSlot) || (a.status === "cleared" && a.settledCount < a.orderCount))
    .slice(0, 4);
  if (!due.length) return null;

  async function cross(a: Auction) {
    setBusy(a.address.toBase58());
    try {
      const ix = await computeClearingIx(getProgram(connection), a, wallet.publicKey!, pythFeed);
      const sig = await sendIxs(connection, wallet, [ix], 800_000);
      notify("ok", "Cross complete. Settle next to pay everyone out.", sig);
      onDone();
    } catch (e) {
      notify("err", errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  async function settle(a: Auction) {
    setBusy(a.address.toBase58());
    try {
      const program = getProgram(connection);
      const orders = (await fetchOrders(connection, PROGRAM, a.address, a.orderCount)).filter((o) => !o.settled);
      if (!orders.length) {
        onDone();
        return;
      }
      const mode = a.settlePath === "refund" ? "refund" : "settle";
      const groups = [];
      for (let i = 0; i < orders.length; i += SETTLE_BATCH) {
        groups.push([await settleIx(program, a, wallet.publicKey!, orders.slice(i, i + SETTLE_BATCH), mode)]);
      }
      const sigs = await sendMany(connection, wallet, groups, 1_000_000);
      notify("ok", `Settled ${orders.length} order${orders.length === 1 ? "" : "s"} in ${sigs.length} transaction${sigs.length === 1 ? "" : "s"}`, sigs[sigs.length - 1]);
      onDone();
    } catch (e) {
      notify("err", errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card crank" aria-label="Pending crank actions">
      <div className="crank-copy">
        <b>An auction is waiting to be finished.</b> Anyone can do it — no special keys. You only pay the network fee.
      </div>
      <div className="crank-list">
        {due.map((a) => {
          const k = a.address.toBase58();
          const needsCross = a.status === "open";
          const left = a.orderCount - a.settledCount;
          return (
            <div key={k} className="crank-row">
              <span className="num muted">
                Window {fmtInt(a.openSlot)} · {a.orderCount} order{a.orderCount === 1 ? "" : "s"}
                {!needsCross && ` · ${left} to settle`}
              </span>
              {!wallet.publicKey ? (
                <button className="btn btn-primary sm" onClick={() => setVisible(true)}>
                  Connect to {needsCross ? "run the cross" : "settle"}
                </button>
              ) : (
                <button className="btn btn-primary sm" disabled={busy !== null} onClick={() => (needsCross ? cross(a) : settle(a))}>
                  {busy === k ? "Working…" : needsCross ? "Run the cross" : `Settle ${left} order${left === 1 ? "" : "s"}`}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
