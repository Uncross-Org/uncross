// Every order this wallet has placed on Uncross, on any ticker.
//
// Read from the wallet's own order accounts, which are never closed, so the
// list is complete. Each row is one order and what it came to at its
// auction's single clearing price. Figures come from the same place as the
// receipt (lib/settlement.ts); a row rebuilt from its settlement transaction,
// because its auction has been closed, is marked.

import { useMemo, useState } from "react";
import { explorerTx, type ClusterConfig } from "../config";
import { auctionPhase } from "../lib/auction";
import { fmtDuration, fmtLocal, shortAddr } from "../lib/format";
import { orderStatus, receiptOf, STATUS_HELP, type MyOrder, type OrderStatus } from "../lib/settlement";
import { programToPerShare, quoteToUsd, rawToShares } from "../lib/units";
import { CopyLink } from "./CopyLink";

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });
// The table prints dollars to the cent and shares to four places, so digits line
// up down each column; the exact figure, as the program settled it, is in the
// cell's tooltip.
const usd2 = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sh4 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const Usd = ({ n }: { n: number }) => <span title={usd(n)}>{usd2(n)}</span>;
const Sh = ({ n }: { n: number }) => <span title={n.toLocaleString("en-US", { maximumFractionDigits: 8 })}>{sh4(n)}</span>;

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
  onOpenAuction: (address: string) => void;
  owner: string | null;
  readOnly: boolean;
}

export function OrdersPage({ cluster, orders, truncated, connected, slot, slotMs, multipliers, symbolOf, onOpenTicker, onOpenAuction, owner, readOnly }: Props) {
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
        <div className="page-title-row">
          <h2 className="display">{readOnly ? "Orders" : "Your orders"}</h2>
          {owner && <CopyLink wallet={owner} />}
        </div>
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
      <p className="fine muted orders-count">
        {shown.length === rows.length
          ? `${rows.length} ${rows.length === 1 ? "order" : "orders"} on ${assets.length} ${assets.length === 1 ? "ticker" : "tickers"}`
          : `Showing ${shown.length} of ${rows.length} orders: ${[
              tab !== "all" && TABS.find((t) => t.id === tab)!.label.toLowerCase(),
              asset !== "all" && asset,
              side !== "all" && `${side}s only`,
            ]
              .filter(Boolean)
              .join(", ")}`}
      </p>

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
                <th className="num-r">Limit</th>
                <th className="num-r">Filled / asked</th>
                <th className="num-r">Clearing price</th>
                <th className="num-r">Paid / received</th>
                <th className="num-r">Returned</th>
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
                      <span className="status-line">
                        <span className={`status-pill st-${status.replace(/ /g, "-").toLowerCase()}`}>{status}</span>
                        {msToCross != null && !o.order.cancelled && <span className="muted small">crosses in {fmtDuration(msToCross)}</span>}
                        {r?.source === "rebuilt" && (
                          <span className="muted small" title="Its auction has been closed; these figures are rebuilt from the settlement transaction">
                            rebuilt
                          </span>
                        )}
                      </span>
                    </td>
                    <td data-label="Limit" className="num-r">
                      <Usd n={programToPerShare(o.order.limitPrice, m)} />
                    </td>
                    <td data-label="Filled / asked" className="num-r">
                      {r ? <Sh n={rawToShares(filled, m)} /> : "—"} / <Sh n={rawToShares(o.order.quantity, m)} />
                    </td>
                    <td data-label="Clearing price" className="num-r">
                      {r?.clearingPrice != null ? <Usd n={programToPerShare(r.clearingPrice, m)} /> : "—"}
                    </td>
                    <td data-label="Paid / received" className="num-r">
                      {r && r.filled > 0n && r.traded != null ? (
                        <>
                          <span className="muted">{buy ? "paid" : "got"}</span> <Usd n={quoteToUsd(r.traded)} />
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Returned" className="num-r">
                      {r?.returned != null ? (
                        buy ? (
                          <Usd n={quoteToUsd(r.returned)} />
                        ) : (
                          <>
                            <Sh n={rawToShares(r.returned, m)} /> <span className="muted">shares</span>
                          </>
                        )
                      ) : status === "Cancelled" && !s ? (
                        "all"
                      ) : r?.shared ? (
                        "with your other orders"
                      ) : (
                        "—"
                      )}
                    </td>
                    <td data-label="Settled">{s?.time ? fmtLocal(s.time * 1000) : r ? "settling" : "—"}</td>
                    <td data-label="Links" className="links">
                      <span className="links-row">
                      <button className="link-btn" onClick={() => onOpenAuction(o.auctionAddress)} title="Every order in that auction and how its price was set">
                        auction
                      </button>
                      {o.placed && (
                        <a href={explorerTx(cluster, o.placed.sig)} target="_blank" rel="noreferrer" title="The transaction that placed it">
                          placed
                        </a>
                      )}
                      {s && (
                        <a href={explorerTx(cluster, s.sig)} target="_blank" rel="noreferrer" title={s.kind === "cancel" ? "The cancel transaction" : "The settlement transaction"}>
                          <span className="sig">{shortAddr(s.sig)}</span> ↗
                        </a>
                      )}
                      </span>
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
