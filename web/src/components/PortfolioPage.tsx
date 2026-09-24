// What this wallet owns, and how much of it is waiting in an auction.
//
// On a batch venue, what you "have" has two parts: what is in your wallet,
// free to use, and what is locked in an order until its auction crosses —
// dollars behind a buy, shares behind a sell. Both are shown for every asset,
// with the orders that hold the locked part, so "$1,000 USDC, $339.72 locked
// in an AAPLx buy" reads at a glance. Holdings are valued at the Pyth
// reference where one exists; a ticker with no feed is shown, not valued.

import { explorerAddr, type ClusterConfig, type TickerConfig } from "../config";
import { auctionPhase } from "../lib/auction";
import { fmtDuration, fmtShares, shortAddr } from "../lib/format";
import type { WalletTokens } from "../lib/holdings";
import type { PythPrice } from "../lib/pyth";
import { orderStatus, type MyOrder } from "../lib/settlement";
import { quoteToUsd, rawToShares } from "../lib/units";
import { ORACLE_MAX_AGE_SECS } from "../config";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Lock {
  symbol: string;
  side: "buy" | "sell";
  /** Quote atomic for a buy, raw ticker for a sell. */
  raw: bigint;
  msToCross: number | null;
  settling: boolean;
}

interface Props {
  cluster: ClusterConfig;
  tickers: TickerConfig[];
  quoteMint: string;
  quoteSymbol: string;
  wallet: WalletTokens | null;
  orders: MyOrder[] | null;
  connected: boolean;
  owner: string | null;
  slot: number | null;
  slotMs: number;
  multipliers: Map<string, number>;
  prices: Map<string, PythPrice>;
  symbolOf: (mint: string | null) => string;
  onOpenTicker: (symbol: string) => void;
}

export function PortfolioPage({ cluster, tickers, quoteMint, quoteSymbol, wallet, orders, connected, owner, slot, slotMs, multipliers, prices, symbolOf, onOpenTicker }: Props) {
  if (!connected) return <div className="card empty page-empty">Connect a wallet to see what it holds and what is locked in orders.</div>;
  if (!wallet || orders === null) return <div className="card empty page-empty">Reading this wallet from chain…</div>;

  // Locked: escrow of every order whose auction has not paid it out yet.
  const locks: (Lock & { mint: string | null })[] = [];
  for (const o of orders) {
    if (o.order.cancelled || o.order.settled) continue;
    const phase = o.auction && slot != null ? auctionPhase(o.auction, slot) : null;
    const status = orderStatus(o.order, o.auction, phase, o.settled);
    locks.push({
      mint: o.tickerMint,
      symbol: symbolOf(o.tickerMint),
      side: o.order.side,
      raw: o.order.escrowAmount,
      msToCross: o.auction && slot != null && o.auction.status === "open" ? Math.max(0, (o.auction.closeSlot - slot) * slotMs) : null,
      settling: status !== "Open" && status !== "Frozen",
    });
  }
  const buyLocks = locks.filter((l) => l.side === "buy");
  const usdcFree = quoteToUsd(wallet.raw.get(quoteMint) ?? 0n);
  const usdcLocked = buyLocks.reduce((s, l) => s + quoteToUsd(l.raw), 0);

  const now = Date.now();
  const rows = tickers
    .map((t) => {
      const m = (t.mint && multipliers.get(t.mint)) || 1;
      const free = rawToShares((t.mint && wallet.raw.get(t.mint)) || 0n, m);
      const lk = locks.filter((l) => l.side === "sell" && l.mint === t.mint);
      const locked = lk.reduce((s, l) => s + rawToShares(l.raw, m), 0);
      const p = prices.get(t.symbol) ?? null;
      const fresh = p ? now - p.publishTime * 1000 <= ORACLE_MAX_AGE_SECS * 1000 : false;
      return { t, free, locked, total: free + locked, lk, p, fresh };
    })
    .filter((r) => r.total > 0 || r.lk.length);
  const valued = rows.filter((r) => r.p);
  const holdingsValue = valued.reduce((s, r) => s + r.total * r.p!.price, 0);
  const unvalued = rows.filter((r) => !r.p);
  const lockText = (l: Lock, amount: string) =>
    `${amount} in your ${l.symbol} ${l.side}${l.settling ? ", settling" : l.msToCross != null ? `, crosses in ${fmtDuration(l.msToCross)}` : ""}`;

  return (
    <section className="page" aria-label="Portfolio">
      <div className="page-head">
        <h2 className="display">Portfolio</h2>
        <p className="page-sub">
          What this wallet holds on devnet. <b>In wallet</b> is yours to use now. <b>Locked</b> is held by the auction
          program behind an order until that auction crosses; then it comes back or is exchanged at the clearing price.
          Everything here is a test token with no real value.
        </p>
        {owner && (
          <p className="fine muted num">
            Wallet{" "}
            <a href={explorerAddr(cluster, owner)} target="_blank" rel="noreferrer">
              {shortAddr(owner)}
            </a>
          </p>
        )}
      </div>

      <div className="port-cards">
        <div className="card port-card">
          <span className="stat-l">{quoteSymbol} (test dollars)</span>
          <span className="port-big num">{usd(usdcFree + usdcLocked)}</span>
          <span className="stat-s num">
            {usd(usdcFree)} in wallet · {usd(usdcLocked)} locked{buyLocks.length ? ` in ${buyLocks.length} buy order${buyLocks.length === 1 ? "" : "s"}` : ""}
          </span>
          {buyLocks.length > 0 && (
            <ul className="lock-list num">
              {buyLocks.map((l, i) => (
                <li key={i}>{lockText(l, usd(quoteToUsd(l.raw)))}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="card port-card">
          <span className="stat-l">Shares at the reference price</span>
          <span className="port-big num">{usd(holdingsValue)}</span>
          <span className="stat-s">
            {valued.length ? `Valued at Pyth for ${valued.map((r) => r.t.symbol).join(", ")}.` : "No holdings with a reference price."}
            {unvalued.length ? ` Not valued, no reference price: ${unvalued.map((r) => r.t.symbol).join(", ")}.` : ""}
          </span>
        </div>
        <div className="card port-card">
          <span className="stat-l">SOL (devnet)</span>
          <span className="port-big num">{wallet.sol != null ? wallet.sol.toFixed(4) : "—"}</span>
          <span className="stat-s">Pays transaction fees and each order's small account rent. Not valued.</span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card empty">This wallet holds no shares and has no sell orders open.</div>
      ) : (
        <div className="card table-scroll">
          <table className="tbl num port-tbl">
            <thead>
              <tr>
                <th>Asset</th>
                <th>In wallet</th>
                <th>Locked in sell orders</th>
                <th>Total shares</th>
                <th>Reference price</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.t.symbol}>
                  <td data-label="Asset">
                    <button className="link-btn" onClick={() => onOpenTicker(r.t.symbol)}>
                      {r.t.symbol}
                    </button>
                  </td>
                  <td data-label="In wallet">{fmtShares(r.free)}</td>
                  <td data-label="Locked in sell orders">
                    {r.locked > 0 ? fmtShares(r.locked) : "—"}
                    {r.lk.map((l, i) => (
                      <div key={i} className="muted small">
                        {lockText(l, `${fmtShares(rawToShares(l.raw, (r.t.mint && multipliers.get(r.t.mint)) || 1))} shares`)}
                      </div>
                    ))}
                  </td>
                  <td data-label="Total shares">{fmtShares(r.total)}</td>
                  <td data-label="Reference price">
                    {r.p ? (
                      <>
                        {usd(r.p.price)} <span className="muted small">Pyth{r.fresh ? "" : ", stale"}</span>
                      </>
                    ) : (
                      <span className="muted">no reference</span>
                    )}
                  </td>
                  <td data-label="Value">{r.p ? usd(r.total * r.p.price) : <span className="muted">not valued</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
