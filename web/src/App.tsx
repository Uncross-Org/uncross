import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CountdownSkeleton } from "./components/Skeletons";
import { Countdown } from "./components/Countdown";
import { CrankPanel } from "./components/CrankPanel";
import { DepthChart } from "./components/DepthChart";
import { Hero } from "./components/Hero";
import { HowItWorks } from "./components/HowItWorks";
import { MyOrders } from "./components/MyOrders";
import { OrderForm } from "./components/OrderForm";
import { PastAuctions } from "./components/PastAuctions";
import { explorerAddr, explorerTx, PROGRAM_ID, TICKERS, tickerFromUrl, type ClusterConfig, type TickerSymbol } from "./config";
import { useBalances, useMultiplier, useNow, useOrders, usePyth, useSlotClock, useTheme, useVenue } from "./hooks";
import { auctionPhase } from "./lib/auction";
import { bestBidAsk, bookOrders } from "./lib/book";
import { shortAddr } from "./lib/format";
import { referenceState } from "./lib/reference";
import { programToPerShare, rawToShares } from "./lib/units";

interface Toast {
  id: number;
  kind: "ok" | "err";
  text: string;
  sig?: string;
}

export default function App({ cluster }: { cluster: ClusterConfig }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { theme, toggle } = useTheme();
  const [ticker, setTicker] = useState<TickerSymbol>(tickerFromUrl);
  const tk = cluster.tickers[ticker];
  const isMainnet = cluster.name === "mainnet";
  const mint = useMemo(() => (tk.mint ? new PublicKey(tk.mint) : null), [tk.mint]);
  const quoteMint = useMemo(() => new PublicKey(cluster.quoteMint), [cluster.quoteMint]);

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("ticker", ticker);
    window.history.replaceState(null, "", u);
  }, [ticker]);

  const now = useNow(1000);
  const { slot, slotMs } = useSlotClock(connection, now);
  const m = useMultiplier(connection, mint);
  const venue = useVenue(connection, mint);
  const pyth = usePyth(tk);
  const ref = referenceState(pyth, now);
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void venue.refreshCurrent();
    void venue.reload();
  }, [venue]);

  const current = venue.current;
  const phase = current && slot != null ? auctionPhase(current, slot) : null;
  const orders = useOrders(connection, current, refreshKey);
  const mine = wallet.publicKey ? orders.filter((o) => o.owner.equals(wallet.publicKey!)) : [];
  const balances = useBalances(connection, wallet.publicKey, mint, quoteMint, refreshKey);
  const book = useMemo(() => (current && m ? bookOrders(current, m) : []), [current, m]);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((kind: "ok" | "err", text: string, sig?: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.slice(-3), { id, kind, text, sig }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 12000 : 8000);
  }, []);

  const crossed = phase === "cleared" || phase === "settled";
  const indicative =
    current && m
      ? {
          price: programToPerShare(crossed ? current.clearingPrice : current.indicativePrice, m),
          volume: rawToShares(crossed ? current.executableVolume : current.indicativeVolume, m),
        }
      : null;

  const suggestions = useMemo(() => {
    const s: { label: string; price: number }[] = [];
    if (isMainnet && ref.price != null) s.push({ label: ref.fresh ? "Pyth" : "Last Pyth", price: ref.price });
    if (indicative && indicative.volume > 0 && !crossed) s.push({ label: "Cross", price: indicative.price });
    const { bid, ask } = bestBidAsk(book);
    if (bid != null) s.push({ label: "Bid", price: bid });
    if (ask != null) s.push({ label: "Ask", price: ask });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMainnet, ref.price, ref.fresh, indicative?.price, indicative?.volume, crossed, book]);

  const otherCluster = cluster.name === "devnet" ? "mainnet" : "devnet";
  const loadingAuction = !!mint && venue.auctions === null && !venue.error;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
            <rect width="32" height="32" rx="7" className="logo-bg" />
            <path d="M7 9 L25 23 M7 23 L25 9" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
            <circle cx="16" cy="16" r="3.2" className="logo-dot" />
          </svg>
          <div>
            <div className="brand-name">Uncross</div>
            <div className="brand-tag">Fair fills when the market is thin and Wall Street is closed.</div>
          </div>
        </div>
        <nav className="seg tickers" aria-label="Ticker">
          {TICKERS.map((t) => (
            <button key={t} className={t === ticker ? "on" : ""} aria-pressed={t === ticker} onClick={() => setTicker(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="top-actions">
          <a className={`cluster cluster-${cluster.name}`} href={`?cluster=${otherCluster}&ticker=${ticker}`} title={`Switch to ${otherCluster}`}>
            {cluster.label}
          </a>
          <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
            {theme === "dark" ? "☀" : "☾"}
          </button>
          <WalletMultiButton />
        </div>
      </header>

      <main className="main">
        <div className="ticker-line">
          <h1>
            {tk.symbol} <span className="muted">· {tk.name} tokenized stock</span>
          </h1>
          {m != null && m !== 1 && (
            <span className="muted small num" title="Token-2022 scaled UI multiplier: wallets show raw × this. Prices here are per real share.">
              1 token unit = {m.toFixed(4)} shares
            </span>
          )}
        </div>

        <Hero
          tk={tk}
          ref_={ref}
          auction={current}
          phase={phase}
          book={book}
          m={m}
          now={now}
          loadingAuction={loadingAuction}
          isMainnet={isMainnet}
        />

        {venue.error && <div className="banner err">Couldn't load auctions: {venue.error}. Retrying automatically.</div>}

        {current && phase ? (
          <Countdown auction={current} phase={phase} slot={slot} slotMs={slotMs} now={now} />
        ) : loadingAuction ? (
          <CountdownSkeleton />
        ) : null}

        {venue.auctions && <CrankPanel auctions={venue.auctions} slot={slot} pythFeed={tk.pythAccount} notify={notify} onDone={refresh} />}

        <div className="work">
          <DepthChart
            orders={book}
            indicative={indicative}
            reference={isMainnet && ref.price != null ? { price: ref.price, fresh: ref.fresh } : null}
            crossed={crossed}
          />
          <OrderForm
            tk={tk}
            auction={current}
            phase={phase}
            m={m}
            balances={balances}
            quoteSymbol={cluster.quoteSymbol}
            suggestions={suggestions}
            notify={notify}
            onPlaced={refresh}
          />
        </div>

        {current && phase && m != null && (
          <MyOrders tk={tk} auction={current} phase={phase} m={m} mine={mine} notify={notify} onChange={refresh} />
        )}

        {venue.auctions && m != null && (
          <PastAuctions auctions={venue.auctions} m={m} slot={slot} slotMs={slotMs} now={now} cluster={cluster} />
        )}

        <HowItWorks />
      </main>

      <footer className="footer">
        <span>
          Program{" "}
          <a href={explorerAddr(cluster, PROGRAM_ID)} target="_blank" rel="noreferrer">
            {shortAddr(PROGRAM_ID)}
          </a>{" "}
          on {cluster.label}
        </span>
        {current && (
          <span>
            Auction{" "}
            <a href={explorerAddr(cluster, current.address.toBase58())} target="_blank" rel="noreferrer">
              {shortAddr(current.address.toBase58())}
            </a>
          </span>
        )}
        <span>Reference prices: Pyth Network on Solana mainnet</span>
        {cluster.name === "devnet" && <span>Devnet uses test tokens with no value.</span>}
      </footer>

      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.sig && (
              <a href={explorerTx(cluster, t.sig)} target="_blank" rel="noreferrer">
                View
              </a>
            )}
            <button aria-label="Dismiss" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
