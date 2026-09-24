// Every order this wallet has placed on Uncross, on any ticker.
//
// Read from the wallet's own order accounts, which are never closed, so the
// list is complete. Each row is one order and what it came to at its
// auction's single clearing price. Figures come from the same place as the
// receipt (lib/settlement.ts); a row rebuilt from its settlement transaction,
// because its auction has been closed, is marked.

import { useMemo, useState } from "react";
import { explorerAddr, explorerTx, type ClusterConfig } from "../config";
import { auctionPhase } from "../lib/auction";
import { fmtDuration, fmtLocal, fmtShares, shortAddr } from "../lib/format";
import { orderStatus, receiptOf, STATUS_HELP, type MyOrder, type OrderStatus } from "../lib/settlement";
import { programToPerShare, quoteToUsd, rawToShares } from "../lib/units";

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

type Tab = "open" | "history" | "fills" | "unfilled" | "all";
const TABS: { id: Tab; label: string; help: string }[] = [
  { id: "open", label: "Open", help: "In an auction that has not crossed yet." },
  { id: "history", label: "History", help: "Every order whose auction has crossed, or that you cancelled." },
  { id: "fills", label: "Fills", help: "Orders that traded, in full or in part." },
  { id: "unfilled", label: "Cancelled / unfilled", help: "Orders that traded nothing. Everything they locked came back." },
  { id: "all", label: "All", help: "Every order." },
];
const inTab = (t: Tab, s: OrderStatus) =>
  t === "all" ||
  (t === "open" && (s === "Open" || s === "Frozen")) ||
  (t === "history" && s !== "Open" && s !== "Frozen") ||
  (t === "fills" && (s === "Filled" || s === "Partially filled")) ||
  (t === "unfilled" && (s === "Unfilled" || s === "Cancelled" || s === "Refunded"));

interface Props {
  cluster: ClusterConfig;
  orders: MyOrder[] | null;
  truncated: boolean;
  connected: boolean;
  slot: number | null;
  slotMs: number;
  multipliers: Map<string, number>;
  symbolOf: (mint: string | null) => string;
  onOpenTicker: (symbol: string) => void;
}

export function OrdersPage({ cluster, orders, truncated, connected, slot, slotMs, multipliers, symbolOf, onOpenTicker }: Props) {
  const [tab, setTab] = useState<Tab>("all");
  const [asset, setAsset] = useState("all");
  const [side, setSide] = useState<"all" | "buy" | "sell">("all");

  const rows = useMemo(
    () =>
      (orders ?? [])
        .map((o) => {
          const phase = o.auction && slot != null ? auctionPhase(o.auction, slot) : null;
          const status = orderStatus(o.order, o.auction, phase, o.settled);
          const m = (o.tickerMint && multipliers.get(o.tickerMint)) || 1;
          const msToCross = o.auction && slot != null && o.auction.status === "open" ? Math.max(0, (o.auction.closeSlot - slot) * slotMs) : null;
          // Newest first: a live auction's close slot, else the order's own times.
          const when = o.settled?.time ?? o.placed?.time ?? 0;
          return { o, status, m, msToCross, symbol: symbolOf(o.tickerMint), when, receipt: receiptOf(o) };
        })
        .sort((a, b) => b.when - a.when),
    [orders, slot, slotMs, multipliers, symbolOf],
  );

  if (!connected) return <div className="card empty page-empty">Connect a wallet to see every order it has placed.</div>;
  if (orders === null) return <div className="card empty page-empty">Reading your orders from chain…</div>;

  const assets = [...new Set(rows.map((r) => r.symbol))].sort();
  const shown = rows.filter((r) => inTab(tab, r.status) && (asset === "all" || r.symbol === asset) && (side === "all" || r.o.order.side === side));
  const next = rows.filter((r) => r.msToCross != null && !r.o.order.cancelled).sort((a, b) => a.msToCross! - b.msToCross!)[0];

  return (
    <section className="page" aria-label="Your orders">
      <div className="page-head">
        <h2 className="display">Your orders</h2>
        <p className="page-sub">
          Every order this wallet has placed, on any ticker, read from its order accounts on chain. Each auction fills
          everyone at one clearing price, so a fill's price is that auction's price, not your limit.
        </p>
        {next && (
          <p className="page-callout">
            Your next cross: <b>{next.symbol}</b> in <b className="num">{fmtDuration(next.msToCross!)}</b>.
          </p>
        )}
      </div>

      <div className="filters">
        <div className="seg" role="tablist" aria-label="Which orders">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} title={t.help} onClick={() => setTab(t.id)}>
              {t.label} <span className="seg-count num">{rows.filter((r) => inTab(t.id, r.status)).length}</span>
            </button>
          ))}
        </div>
        <label className="filter">
          <span>Asset</span>
          <select id="orders-asset" value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="all">All</option>
            {assets.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span>Side</span>
          <select id="orders-side" value={side} onChange={(e) => setSide(e.target.value as "all" | "buy" | "sell")}>
            <option value="all">Both</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
          </select>
        </label>
      </div>
      <p className="fine muted">{TABS.find((t) => t.id === tab)!.help}</p>

      {shown.length === 0 ? (
        <div className="card empty">{rows.length ? "No orders match these filters." : "This wallet has not placed an order yet."}</div>
      ) : (
        <div className="card table-scroll">
          <table className="tbl num orders-tbl">
            <thead>
              <tr>
                <th>Placed</th>
                <th>Asset</th>
                <th>Side</th>
                <th>Status</th>
                <th>Limit</th>
                <th>Filled / asked</th>
                <th>Clearing price</th>
                <th>Paid / received</th>
                <th>Returned</th>
                <th>Settled</th>
                <th>Links</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ o, status, m, msToCross, symbol, receipt: r }) => {
                const buy = o.order.side === "buy";
                const filled = r ? r.filled : 0n;
                const s = o.settled;
                return (
                  <tr key={o.order.address.toBase58()}>
                    <td data-label="Placed">{o.placed?.time ? fmtLocal(o.placed.time * 1000) : "—"}</td>
                    <td data-label="Asset">
                      <button className="link-btn" onClick={() => onOpenTicker(symbol)}>
                        {symbol}
                      </button>
                    </td>
                    <td data-label="Side">
                      <span className={`order-side order-side-${o.order.side}`}>{buy ? "Buy" : "Sell"}</span>
                    </td>
                    <td data-label="Status" title={STATUS_HELP[status]}>
                      <span className={`status-pill st-${status.replace(/ /g, "-").toLowerCase()}`}>{status}</span>
                      {msToCross != null && !o.order.cancelled && <div className="muted small">crosses in {fmtDuration(msToCross)}</div>}
                      {r?.source === "rebuilt" && <div className="muted small">rebuilt from settlement tx</div>}
                    </td>
                    <td data-label="Limit">{usd(programToPerShare(o.order.limitPrice, m))}</td>
                    <td data-label="Filled / asked">
                      {r ? fmtShares(rawToShares(filled, m)) : "—"} / {fmtShares(rawToShares(o.order.quantity, m))}
                    </td>
                    <td data-label="Clearing price">{r?.clearingPrice != null ? usd(programToPerShare(r.clearingPrice, m)) : "—"}</td>
                    <td data-label="Paid / received">{r && r.filled > 0n && r.traded != null ? `${buy ? "paid" : "got"} ${usd(quoteToUsd(r.traded))}` : "—"}</td>
                    <td data-label="Returned">
                      {r?.returned != null
                        ? buy
                          ? usd(quoteToUsd(r.returned))
                          : `${fmtShares(rawToShares(r.returned, m))} shares`
                        : status === "Cancelled" && !s
                          ? "all"
                          : r?.shared
                            ? "with your other orders"
                            : "—"}
                    </td>
                    <td data-label="Settled">{s?.time ? fmtLocal(s.time * 1000) : r ? "settling" : "—"}</td>
                    <td data-label="Links" className="links">
                      <a href={explorerAddr(cluster, o.auctionAddress)} target="_blank" rel="noreferrer" title="The auction">
                        auction
                      </a>
                      {o.placed && (
                        <a href={explorerTx(cluster, o.placed.sig)} target="_blank" rel="noreferrer" title="The transaction that placed it">
                          placed
                        </a>
                      )}
                      {s && (
                        <a href={explorerTx(cluster, s.sig)} target="_blank" rel="noreferrer" title={s.kind === "cancel" ? "The cancel transaction" : "The settlement transaction"}>
                          {s.kind === "cancel" ? "cancel" : "settlement"} {shortAddr(s.sig)}
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {truncated && <p className="fine muted">Still reading the settlement details of some older orders; they fill in over the next few refreshes.</p>}
    </section>
  );
}
