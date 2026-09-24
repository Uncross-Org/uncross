// What your last auction came to, in your terms.
//
// Keyed to your orders, not to the ticker's newest auction, so it stays on
// screen after the next auction opens — which the keeper does seconds after a
// cross, before settlement lands. Every figure is on-chain settlement data;
// see lib/settlement.ts for where each comes from. A receipt rebuilt from the
// settlement transaction, because its auction has been closed, says so.

import { explorerAddr, explorerTx, type ClusterConfig, type TickerConfig } from "../config";
import { fmtLocal, fmtShares, shortAddr } from "../lib/format";
import { receiptOf, STATUS_HELP, type MyOrder, type Receipt as R } from "../lib/settlement";
import { programToPerShare, quoteToUsd, rawToShares } from "../lib/units";
import { CopyLink } from "./CopyLink";

const shareText = (n: number) => `${fmtShares(n)} ${n === 1 ? "share" : "shares"}`;
/** Dollars to the cent where that is exact, otherwise to the micro-dollar the program settles in. */
const exactUsd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

interface Props {
  tk: TickerConfig;
  m: number;
  cluster: ClusterConfig;
  items: MyOrder[];
  /** The wallet these orders belong to, for a shareable link. */
  wallet?: string | null;
  onOpenAuction?: (address: string) => void;
}

export function Receipt({ tk, m, cluster, items, wallet, onOpenAuction }: Props) {
  const rows = items.map((it) => ({ it, r: receiptOf(it) })).filter((x): x is { it: MyOrder; r: R } => x.r !== null);
  if (!rows.length) return null;
  const a = items[0].auction;
  const rebuilt = rows.some((x) => x.r.source === "rebuilt");
  const price = rows.find((x) => x.r.clearingPrice != null)?.r.clearingPrice ?? null;
  const settledAt = rows.map((x) => x.r.settlement?.time ?? null).find((t) => t != null) ?? null;
  const settling = rows.some((x) => !x.r.settlement && x.r.status !== "Cancelled");
  const anyTrade = a ? a.executableVolume > 0n : rows.some((x) => x.r.filled > 0n);

  return (
    <div className="receipt" aria-label={`Your result in this ${tk.symbol} auction`}>
      <div className="receipt-head">
        <div>
          <div className="receipt-eyebrow">
            Your result · {tk.symbol} auction{" "}
            {onOpenAuction ? (
              <button className="link-btn num" onClick={() => onOpenAuction(items[0].auctionAddress)} title="Every order and how the price was set">
                {shortAddr(items[0].auctionAddress)}
              </button>
            ) : (
              <a href={explorerAddr(cluster, items[0].auctionAddress)} target="_blank" rel="noreferrer" className="num">
                {shortAddr(items[0].auctionAddress)}
              </a>
            )}
          </div>
          <div className="receipt-title num">
            {price != null ? (
              <>
                Cleared at <b>{exactUsd(programToPerShare(price, m))}</b> per share
              </>
            ) : anyTrade ? (
              "Crossed"
            ) : (
              "No trade this round"
            )}
          </div>
        </div>
        <div className="receipt-meta">
          <span className={`tag ${settling ? "tag-ext" : "tag-live"}`}>{settling ? "Settling" : "Settled"}</span>
          {settledAt != null && <span className="muted small num">{fmtLocal(settledAt * 1000)}</span>}
          {wallet && <CopyLink wallet={wallet} />}
        </div>
      </div>
      {rebuilt && (
        <p className="receipt-source">
          Rebuilt from the settlement transaction: this auction has since been closed and its rent returned, so its own record
          of the cross is gone. The fill is from your order account; the amounts are what that transaction moved.
        </p>
      )}

      {rows.map(({ it, r }) => {
        const buy = r.side === "buy";
        const filled = rawToShares(r.filled, m);
        const asked = rawToShares(r.requested, m);
        const s = r.settlement;
        return (
          <div key={it.order.address.toBase58()} className="receipt-order">
            <div className="receipt-line">
              <span className={`status-pill st-${r.status.replace(/ /g, "-").toLowerCase()}`}>{r.status}</span>
              <span className="num">
                <span className={`order-side order-side-${r.side}`}>{buy ? "Buy" : "Sell"}</span> {fmtShares(filled)} of {shareText(asked)} filled
              </span>
            </div>
            <dl className="receipt-grid num">
              <div>
                <dt>Your limit</dt>
                <dd>{exactUsd(programToPerShare(r.limitPrice, m))}</dd>
              </div>
              <div>
                <dt>Clearing price</dt>
                <dd>{r.clearingPrice != null ? exactUsd(programToPerShare(r.clearingPrice, m)) : "—"}</dd>
              </div>
              {/* What traded, what was delivered, what came back. A sell's
                  proceeds are one figure: the program's record of what the
                  order received, then the transfer that paid it. */}
              {r.filled > 0n && buy && (
                <div>
                  <dt>You paid</dt>
                  <dd>{r.traded != null ? exactUsd(quoteToUsd(r.traded)) : "—"}</dd>
                </div>
              )}
              {r.filled > 0n && buy && !r.shared && (
                <div>
                  <dt>{tk.symbol} delivered</dt>
                  <dd>{s ? shareText(rawToShares(r.delivered ?? 0n, m)) : "at settlement"}</dd>
                </div>
              )}
              {r.filled > 0n && !buy && (
                <div>
                  <dt>You received</dt>
                  <dd>{s && !r.shared ? exactUsd(quoteToUsd(r.delivered ?? 0n)) : r.traded != null ? `${exactUsd(quoteToUsd(r.traded))}${s ? "" : " at settlement"}` : "—"}</dd>
                </div>
              )}
              {!r.shared && (r.filled < r.requested || buy) && (
                <div>
                  <dt>Returned to you</dt>
                  <dd>{s ? (buy ? exactUsd(quoteToUsd(r.returned ?? 0n)) : shareText(rawToShares(r.returned ?? 0n, m))) : "at settlement"}</dd>
                </div>
              )}
              <div>
                <dt>{s?.kind === "cancel" ? "Cancelled" : "Settlement"}</dt>
                <dd>
                  {s ? (
                    <a href={explorerTx(cluster, s.sig)} target="_blank" rel="noreferrer">
                      {shortAddr(s.sig)} ↗
                    </a>
                  ) : (
                    "not landed yet"
                  )}
                </dd>
              </div>
            </dl>
            {r.shared && s && (
              <p className="fine muted">
                Settled in one transaction with your other orders in this auction. Between them,{" "}
                {exactUsd(quoteToUsd(s.quoteDelta))} and {fmtShares(rawToShares(s.tickerDelta, m))} {tk.symbol} came back to you.
              </p>
            )}
            <p className="fine muted">
              {STATUS_HELP[r.status]}
              {buy && r.status === "Filled" && r.clearingPrice != null && r.clearingPrice < r.limitPrice
                ? ` You paid ${exactUsd(programToPerShare(r.limitPrice - r.clearingPrice, m))} a share less than your limit.`
                : ""}
              {!buy && r.status === "Filled" && r.clearingPrice != null && r.clearingPrice > r.limitPrice
                ? ` You received ${exactUsd(programToPerShare(r.clearingPrice - r.limitPrice, m))} a share more than your limit.`
                : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/** The auction whose receipt to show for this ticker: the most recent one you had orders in that has crossed. */
export function latestReceiptGroup(orders: MyOrder[] | null, mint: string | null): MyOrder[] {
  if (!orders || !mint) return [];
  const groups = new Map<string, MyOrder[]>();
  for (const o of orders) {
    if (o.tickerMint !== mint) continue;
    const crossed = o.auction ? o.auction.status !== "open" : !!o.settled;
    if (!crossed) continue;
    groups.set(o.auctionAddress, [...(groups.get(o.auctionAddress) ?? []), o]);
  }
  // Most recent first: a live auction by its slot, a closed one by its settlement time.
  const rank = (g: MyOrder[]) => {
    const a = g[0].auction;
    if (a) return a.closeSlot * 1e3;
    return Math.max(...g.map((x) => x.settled?.time ?? 0));
  };
  const live = [...groups.values()].filter((g) => g[0].auction);
  const pool = live.length ? live : [...groups.values()];
  return pool.sort((x, y) => rank(y) - rank(x))[0] ?? [];
}
