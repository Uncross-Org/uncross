// One auction, in full: every order, the curves at the cross, the clearing
// rule replayed step by step, the Pyth check the program recorded, and every
// transaction. The answer to "how do I check this price?" — each figure is read
// from the auction's own account, and the replayed price is compared with the
// one the program recorded.

import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useState } from "react";
import { explorerAddr, explorerTx, type ClusterConfig } from "../config";
import { PROGRAM } from "../hooks";
import { auctionPhase, decodeAuction, GATE_REASONS, type Auction } from "../lib/auction";
import { bookOrders } from "../lib/book";
import { traceClearing } from "../lib/clearing";
import { fmtInt, fmtLocal, fmtShares, shortAddr } from "../lib/format";
import { fetchOrders, type OrderAccount } from "../lib/order";
import { orderStatus, STATUS_HELP } from "../lib/settlement";
import { programToPerShare, quoteToUsd, rawToShares } from "../lib/units";
import { DepthChart } from "./DepthChart";

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
const KINDS: Record<string, string> = {
  InitializeAuction: "Opened",
  PlaceOrder: "Order placed",
  CancelOrder: "Order cancelled",
  ComputeClearing: "Cross",
  SettleBatch: "Settlement",
  CancelAndRefund: "Refund",
  CloseAuction: "Closed, rent returned",
};

interface Tx {
  sig: string;
  time: number | null;
  kind: string;
  failed: boolean;
}

interface Props {
  cluster: ClusterConfig;
  address: string;
  slot: number | null;
  slotMs: number;
  now: number;
  multipliers: Map<string, number>;
  symbolOf: (mint: string | null) => string;
  onOpenTicker: (symbol: string) => void;
  onOpenWallet: (wallet: string) => void;
}

export function AuctionPage({ cluster, address, slot, slotMs, now, multipliers, symbolOf, onOpenTicker, onOpenWallet }: Props) {
  const { connection } = useConnection();
  const [auction, setAuction] = useState<Auction | null | undefined>(undefined);
  const [orders, setOrders] = useState<OrderAccount[]>([]);
  const [txs, setTxs] = useState<Tx[] | null>(null);

  useEffect(() => {
    let dead = false;
    setAuction(undefined);
    setOrders([]);
    setTxs(null);
    let key: PublicKey;
    try {
      key = new PublicKey(address);
    } catch {
      setAuction(null);
      return;
    }
    void (async () => {
      const info = await connection.getAccountInfo(key, "confirmed").catch(() => null);
      const a = info && info.owner.equals(PROGRAM) && info.data.length === 2880 ? decodeAuction(key, info.data) : null;
      if (dead) return;
      setAuction(a);
      if (a) fetchOrders(connection, PROGRAM, key, a.orderCount).then((o) => !dead && setOrders(o)).catch(() => {});
      // Every transaction that touched it, named by the instruction it ran.
      const sigs = await connection.getSignaturesForAddress(key, { limit: 200 }, "confirmed").catch(() => []);
      const out: Tx[] = [];
      for (let i = 0; i < sigs.length; i += 20) {
        const chunk = sigs.slice(i, i + 20);
        const got = await connection.getTransactions(chunk.map((s) => s.signature), { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => chunk.map(() => null));
        // Matched by signature, not position: a batched reply need not keep order.
        const bySig = new Map<string, (typeof got)[number]>();
        for (const t of got) if (t) bySig.set(t.transaction.signatures[0], t);
        // Anything the batch did not return is read on its own, a few times:
        // the public endpoint drops batched reads under load.
        for (const s of chunk) {
          for (let attempt = 0; attempt < 3 && !bySig.has(s.signature); attempt++) {
            const one = await connection.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }).catch(() => null);
            if (one) bySig.set(s.signature, one);
            else await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
          }
        }
        chunk.forEach((s) => {
          const tx = bySig.get(s.signature);
          const logs = tx?.meta?.logMessages ?? [];
          const ix = logs.map((l) => l.match(/^Program log: Instruction: (\w+)$/)?.[1]).find((x) => x && KINDS[x]);
          // Unread is "…", never a guess.
          out.push({ sig: s.signature, time: s.blockTime ?? null, kind: ix ? KINDS[ix] : tx ? "Other" : "…", failed: !!s.err });
        });
      }
      if (!dead) setTxs(out.sort((x, y) => (x.time ?? 0) - (y.time ?? 0)));
    })();
    return () => {
      dead = true;
    };
  }, [connection, address]);

  const m = (auction && multipliers.get(auction.tickerMint.toBase58())) || 1;
  const phase = auction && slot != null ? auctionPhase(auction, slot) : null;
  const crossed = auction ? auction.status !== "open" : false;
  const trace = useMemo(
    () => (auction ? traceClearing(auction.orders, crossed && auction.referencePriceSet ? auction.referencePrice : null) : null),
    [auction, crossed],
  );
  const book = useMemo(() => (auction ? bookOrders(auction, m) : []), [auction, m]);

  if (auction === undefined) return <div className="card empty page-empty">Reading the auction from chain…</div>;
  if (auction === null)
    return (
      <section className="page">
        <div className="card empty">
          No auction account at <span className="num">{shortAddr(address)}</span>. It may have been closed after it settled, returning
          its rent; its orders' own accounts remain, and its history is on the{" "}
          <a href={explorerAddr(cluster, address)} target="_blank" rel="noreferrer">
            explorer
          </a>
          .
        </div>
      </section>
    );

  const symbol = symbolOf(auction.tickerMint.toBase58());
  const at = (s: number) => (slot != null ? now - (slot - s) * slotMs : null);
  const opened = at(auction.openSlot), closed = at(auction.closeSlot);
  const price = trace && trace.volume > 0n ? programToPerShare(trace.price, m) : null;
  const matches = !crossed || (trace && trace.price === auction.clearingPrice && trace.volume === auction.executableVolume);
  const gate = GATE_REASONS[auction.oracleGate] ?? "not recorded";
  const tied = trace?.tiedOnBalance.length ? trace.tiedOnBalance : trace?.tiedOnVolume ?? [];
  const list = (ps: bigint[]) => ps.map((p) => usd(programToPerShare(p, m))).join(" and ");

  let why = "";
  if (trace) {
    const vol = `${fmtShares(rawToShares(trace.volume, m))} shares`;
    if (trace.decidedBy === "nothing traded") why = "No buyer's limit reached any seller's, so nothing traded and every order got back what it locked.";
    else if (trace.decidedBy === "most volume") why = `At ${usd(price!)} more shares trade than at any other price: ${vol}.`;
    else if (trace.decidedBy === "closest balance")
      why = `${vol} trade at each of ${list(trace.tiedOnVolume)}. At ${usd(price!)} buyers and sellers are closest to balanced, so that price is chosen.`;
    else if (trace.decidedBy === "nearest the oracle")
      why = `${list(trace.tiedOnBalance)} tie on volume and on balance. A fresh Pyth price of ${usd(programToPerShare(auction.referencePrice, m))} passed the program's check, so the tied price nearest to it, ${usd(price!)}, is chosen.`;
    else
      why = `${list(trace.tiedOnBalance)} tie on volume and on balance. ${crossed ? `The program's Pyth check recorded "${gate}", so no oracle broke the tie` : "Before the cross no oracle is consulted"}, and the midpoint of the tied range sets the price: ${usd(price!)}.`;
  }

  return (
    <section className="page" aria-label={`${symbol} auction`}>
      <div className="page-head">
        <div className="page-title-row">
          <h2 className="display">
            <button className="link-btn title-link" onClick={() => onOpenTicker(symbol)}>
              {symbol}
            </button>{" "}
            auction <span className="muted num">{shortAddr(address)}</span>
          </h2>
          <a className="btn btn-ghost sm" href={explorerAddr(cluster, address)} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
        </div>
        <p className="page-sub num">
          {phase === "open" || phase === "freeze" ? "Taking orders" : crossed ? (auction.status === "settled" ? "Crossed and settled" : "Crossed, settling") : "Window closed, crossing"} ·
          window slots {fmtInt(auction.openSlot)} → {fmtInt(auction.closeSlot)}
          {opened != null && closed != null ? ` (≈ ${fmtLocal(opened)} → ${fmtLocal(closed)})` : ""} · {auction.orderCount} order{auction.orderCount === 1 ? "" : "s"}
        </p>
      </div>

      <div className="auction-grid">
        <div className="card auction-result">
          <span className="stat-l">{crossed ? "Cleared at" : "Would clear at, if it crossed now"}</span>
          <span className="port-big num accent">{price != null ? usd(price) : "No trade"}</span>
          <span className="stat-s num">
            {trace && trace.volume > 0n
              ? `${fmtShares(rawToShares(trace.volume, m))} ${rawToShares(trace.volume, m) === 1 ? "share" : "shares"} traded, every fill at this one price`
              : "Buyers and sellers did not overlap."}
          </span>
          <h3 className="auction-h">How the price was set</h3>
          <p className="auction-why">{why}</p>
          {crossed && (
            <p className={`fine ${matches ? "muted" : "err-text"}`}>
              {matches
                ? "Replaying the program's rule on these orders gives exactly the price and volume the program recorded at the cross."
                : "Replaying the rule does not match the recorded price. Please report this."}
            </p>
          )}
          {trace && trace.candidates.length > 0 && (
            <div className="table-scroll">
              <table className="tbl num cand-tbl">
                <thead>
                  <tr>
                    <th>Price</th>
                    <th>Buyers at or above</th>
                    <th>Sellers at or below</th>
                    <th>Would trade</th>
                    <th>Imbalance</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.candidates.map((c) => (
                    <tr key={String(c.price)} className={tied.includes(c.price) ? "cand-tied" : ""}>
                      <td>{usd(programToPerShare(c.price, m))}</td>
                      <td>{fmtShares(rawToShares(c.demand, m))}</td>
                      <td>{fmtShares(rawToShares(c.supply, m))}</td>
                      <td>
                        <b>{fmtShares(rawToShares(c.volume, m))}</b>
                      </td>
                      <td>{fmtShares(rawToShares(c.imbalance, m))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="fine muted">
            Candidates are the orders' own limit prices. Shaded rows are the ones tied for the most shares traded
            {trace?.tiedOnBalance.length ? " and closest balance" : ""}.
          </p>
        </div>

        <div className="card">
          <DepthChart orders={book} indicative={price != null && trace ? { price, volume: rawToShares(trace.volume, m) } : null} reference={null} crossed={crossed} />
        </div>

        <div className="card">
          <h3 className="auction-h">The Pyth check</h3>
          <p className="auction-why">
            {auction.pythFeedId === "0".repeat(64)
              ? "This auction has no Pyth feed configured: no oracle price exists for it on this cluster."
              : crossed
                ? `Recorded at the cross: ${gate}.${auction.oraclePublishTime ? ` The price it examined was published ${fmtLocal(auction.oraclePublishTime * 1000)}.` : ""}${auction.referencePriceSet ? ` A price of ${usd(programToPerShare(auction.referencePrice, m))} passed and was available to break a tie.` : " No oracle price was available to break a tie."}`
                : "Runs at the cross. It only ever breaks a tie between equally good prices; it never sets the price."}
          </p>
        </div>
      </div>

      <div className="card table-scroll">
        <h3 className="auction-h">Orders</h3>
        <table className="tbl num orders-tbl">
          <thead>
            <tr>
              <th>#</th>
              <th>Wallet</th>
              <th>Side</th>
              <th>Limit</th>
              <th>Shares</th>
              <th>Filled</th>
              <th>Paid / received</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {auction.orders.map((sum) => {
              const o = orders.find((x) => x.orderIndex === sum.index);
              const status = o ? orderStatus(o, auction, phase, null) : sum.cancelled ? "Cancelled" : "—";
              return (
                <tr key={sum.index}>
                  <td data-label="#">{sum.index}</td>
                  <td data-label="Wallet">
                    {o ? (
                      <button className="link-btn" title="Open this wallet's orders, read-only" onClick={() => onOpenWallet(o.owner.toBase58())}>
                        {shortAddr(o.owner.toBase58())}
                      </button>
                    ) : (
                      "…"
                    )}
                  </td>
                  <td data-label="Side">
                    <span className={`order-side order-side-${sum.side}`}>{sum.side === "buy" ? "Buy" : "Sell"}</span>
                  </td>
                  <td data-label="Limit">{usd(programToPerShare(sum.limitPrice, m))}</td>
                  <td data-label="Shares">{fmtShares(rawToShares(sum.quantity, m))}</td>
                  <td data-label="Filled">{crossed ? fmtShares(rawToShares(sum.filledQuantity, m)) : "—"}</td>
                  <td data-label="Paid / received">{crossed && sum.filledQuantity > 0n ? `${sum.side === "buy" ? "paid" : "got"} ${usd(quoteToUsd(sum.quoteAmount))}` : "—"}</td>
                  <td data-label="Status" title={status in STATUS_HELP ? STATUS_HELP[status as keyof typeof STATUS_HELP] : undefined}>
                    {status}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card table-scroll">
        <h3 className="auction-h">Transactions</h3>
        {txs === null ? (
          <div className="empty small">Reading its transactions…</div>
        ) : (
          <table className="tbl num tx-tbl">
            <tbody>
              {txs.map((t) => (
                <tr key={t.sig}>
                  <td>{t.time ? fmtLocal(t.time * 1000) : "—"}</td>
                  <td>
                    {t.kind}
                    {t.failed ? <span className="muted"> · failed</span> : ""}
                  </td>
                  <td>
                    <a href={explorerTx(cluster, t.sig)} target="_blank" rel="noreferrer">
                      {shortAddr(t.sig)} ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
