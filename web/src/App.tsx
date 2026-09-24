import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Candles } from "./components/Candles";
import { Countdown } from "./components/Countdown";
import { CrankPanel } from "./components/CrankPanel";
import { DepthChart } from "./components/DepthChart";
import { EventBar } from "./components/EventBar";
import { GetTestTokens } from "./components/GetTestTokens";
import { Ladder } from "./components/Ladder";
import { OpenAuction } from "./components/OpenAuction";
import { MyOrders } from "./components/MyOrders";
import { OrderForm } from "./components/OrderForm";
import { PastAuctions } from "./components/PastAuctions";
import { Sidebar } from "./components/Sidebar";
import { CountdownSkeleton } from "./components/Skeletons";
import { explorerAddr, explorerTx, PROGRAM_ID, tickerFromUrl, type ClusterConfig, type TickerSymbol } from "./config";
import { useBalances, useMultiplier, useNow, useOrders, usePyth, useSlotClock, useTheme, useVenue, useVenueAll } from "./hooks";
import { auctionPhase } from "./lib/auction";
import { bestBidAsk, bookOrders } from "./lib/book";
import { fmtDuration, shortAddr } from "./lib/format";
import { referenceState } from "./lib/reference";
import { useMyOrders } from "./lib/settlement";
import { useMultipliers, usePythPrices, useWalletTokens } from "./lib/holdings";
import { AuctionStats } from "./components/AuctionStats";
import { OrdersPage } from "./components/OrdersPage";
import { PortfolioPage } from "./components/PortfolioPage";
import { toConfig, useUniverse } from "./lib/universe";
import { programToPerShare, rawToShares } from "./lib/units";

// The dashboard as an app shell: tickers down the side, the selected
// ticker's auction across the top, and the work area beneath — price history
// as one candle per auction, the book as a ladder and as curves, order entry,
// the visitor's own orders, and every past cross. No motion beyond the data
// changing.

interface Toast {
  id: number;
  kind: "ok" | "err";
  text: string;
  sig?: string;
}

type View = "trade" | "orders" | "portfolio";
const VIEWS: { id: View; label: string }[] = [
  { id: "trade", label: "Trade" },
  { id: "orders", label: "Your orders" },
  { id: "portfolio", label: "Portfolio" },
];
const viewFromUrl = (): View => {
  const v = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("view");
  return v === "orders" || v === "portfolio" ? v : "trade";
};

const PHASE_SHORT: Record<string, string> = {
  upcoming: "Opens soon",
  open: "Taking orders",
  freeze: "Closing — no more cancelling",
  "awaiting-cross": "Ready to cross",
  cleared: "Crossed",
  settled: "Settled",
};

export default function App({ cluster }: { cluster: ClusterConfig }) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { theme, toggle } = useTheme();
  const [ticker, setTickerState] = useState<TickerSymbol>(tickerFromUrl);
  const [view, setView] = useState<View>(viewFromUrl);
  // Choosing a ticker always means trading it.
  const setTicker = useCallback((t: TickerSymbol) => {
    setTickerState(t);
    setView("trade");
  }, []);
  const [sideOpen, setSideOpen] = useState(false);
  const [chartView, setChartView] = useState<"candles" | "depth">("candles");
  const universe = useUniverse();
  const listed = universe.bySymbol.get(ticker) ?? null;
  // The ten on cadence are compiled in; every other listed ticker resolves from
  // the listing once it loads. Until then the page says so rather than showing
  // another ticker's data.
  const tk = useMemo(
    () =>
      cluster.tickers[ticker] ??
      (listed
        ? toConfig(listed)
        : { symbol: ticker, name: universe.list ? "is not listed" : "Loading…", underlying: ticker, mint: null, pythAccount: null, pythFeedId: "0".repeat(64), hermesQuery: ticker }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cluster, ticker, listed?.devnetMint, universe.list === null],
  );
  const onCadence = !!cluster.tickers[ticker] || !!listed?.active;
  const mint = useMemo(() => (tk.mint ? new PublicKey(tk.mint) : null), [tk.mint]);
  const quoteMint = useMemo(() => new PublicKey(cluster.quoteMint), [cluster.quoteMint]);

  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("ticker", ticker);
    if (view === "trade") u.searchParams.delete("view");
    else u.searchParams.set("view", view);
    window.history.replaceState(null, "", u);
  }, [ticker, view]);

  const now = useNow(1000);
  const { slot, slotMs } = useSlotClock(connection, now);
  const m = useMultiplier(connection, mint);
  const venue = useVenue(connection, mint);
  const all = useVenueAll();
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
  // Every order this wallet has placed, keyed to the order rather than to the
  // ticker's newest auction, so a result outlives the next auction opening.
  const myOrders = useMyOrders(wallet.publicKey?.toBase58() ?? null, refreshKey);
  // For the Orders and Portfolio pages: every ticker, what the wallet holds,
  // and each ticker's multiplier and reference price.
  const allTickers = useMemo(() => Object.values(cluster.tickers), [cluster]);
  const symbolOf = useCallback(
    (mintKey: string | null) => allTickers.find((t) => t.mint === mintKey)?.symbol ?? (mintKey ? `${mintKey.slice(0, 4)}…` : "?"),
    [allTickers],
  );
  const multipliers = useMultipliers(connection, [
    ...allTickers.map((t) => t.mint).filter((x): x is string => !!x),
    ...(myOrders.orders ?? []).map((o) => o.tickerMint).filter((x): x is string => !!x),
  ]);
  const walletTokens = useWalletTokens(connection, view === "portfolio" ? wallet.publicKey : null, refreshKey);
  const prices = usePythPrices(view === "portfolio" ? allTickers : []);
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
  const { bid, ask } = bestBidAsk(book);
  const vsRef = ref.fresh && ref.price != null && indicative && indicative.volume > 0 ? ((indicative.price - ref.price) / ref.price) * 100 : null;

  // The latest auction of this ticker that has crossed, for the Pyth check the
  // program recorded there. Its price is history, and lives in Past crosses.
  const lastCrossed = useMemo(
    () => (venue.auctions ?? []).filter((a) => a.status !== "open").sort((x, y) => y.closeSlot - x.closeSlot)[0] ?? null,
    [venue.auctions],
  );

  // Prices to start an order from: the external reference, then this book.
  const suggestions = useMemo(() => {
    const s: { label: string; price: number }[] = [];
    if (ref.fresh && ref.price != null) s.push({ label: "Pyth reference", price: ref.price });
    if (indicative && indicative.volume > 0 && !crossed) s.push({ label: "Would clear", price: indicative.price });
    if (bid != null) s.push({ label: "Best bid", price: bid });
    if (ask != null) s.push({ label: "Best ask", price: ask });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.price, ref.fresh, indicative?.price, indicative?.volume, crossed, bid, ask]);
  const loadingAuction = !!mint && venue.auctions === null && !venue.error;
  const secsLeft = current && slot != null && (phase === "open" || phase === "freeze") ? Math.max(0, (current.closeSlot - slot) * slotMs) : null;
  const msToFreeze = current && slot != null && phase === "open" ? Math.max(0, (current.closeSlot - current.freezeSlots - slot) * slotMs) : null;

  return (
    <div className="shell">
      <Sidebar
        cluster={cluster}
        universe={universe.list}
        ticker={ticker}
        onSelect={setTicker}
        all={all.auctions}
        loading={all.loading}
        slot={slot}
        slotMs={slotMs}
        open={sideOpen}
        onClose={() => setSideOpen(false)}
      />
      {sideOpen && <div className="scrim" onClick={() => setSideOpen(false)} aria-hidden />}

      <div className="shell-main">
        <header className="topbar">
          <button className="icon-btn side-toggle" onClick={() => setSideOpen(true)} aria-label="Open ticker list">
            ☰
          </button>
          <div className="top-title">
            {view === "trade" ? (
            <>
            <h1 className="display">
              {tk.symbol} <span className="muted">{tk.name}</span>
            </h1>
            {phase && (
              <span className={`pill pill-${phase}`}>
                <span className="dot" aria-hidden />
                <span className="pill-label">{PHASE_SHORT[phase]}</span>
                {secsLeft != null && <span className="pill-time">{fmtDuration(secsLeft)}</span>}
              </span>
            )}
            </>
            ) : (
              <h1 className="display">{VIEWS.find((v) => v.id === view)!.label}</h1>
            )}
          </div>
          <nav className="top-nav" aria-label="Pages">
            {VIEWS.map((v) => (
              <button key={v.id} className={view === v.id ? "on" : ""} aria-current={view === v.id ? "page" : undefined} onClick={() => setView(v.id)}>
                {v.label}
              </button>
            ))}
          </nav>
          <div className="top-actions">
            <span className="cluster">{cluster.label}</span>
            <button className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? "☀" : "☾"}
            </button>
            <WalletMultiButton />
          </div>
        </header>

        <EventBar ticker={ticker} onGo={setTicker} />

        {/* A dormant ticker: listed, nothing running. The way to start a book is
            the first thing on the page, not a disabled button further down. */}
        {view === "trade" && !onCadence && tk.mint && venue.auctions !== null && !(current && slot != null && current.status === "open" && slot < current.closeSlot) && (
          <OpenAuction tk={tk} halted={!!listed?.halted} notify={notify} onOpened={(a) => void venue.adopt(a)} />
        )}

        {/* Two groups that never mix: what this book says, and the one number from outside. */}
        {view === "trade" && (
          <AuctionStats
            tk={tk}
            phase={phase}
            auction={current}
            indicative={indicative}
            bid={bid}
            ask={ask}
            book={book}
            ref_={ref}
            vsRef={vsRef}
            lastCrossed={lastCrossed}
            msToCross={secsLeft}
            msToFreeze={msToFreeze}
            m={m}
          />
        )}
        {view === "trade" && venue.error && <div className="banner err">Couldn't load auctions: {venue.error}. Retrying automatically.</div>}

        {view === "orders" && (
          <OrdersPage
            cluster={cluster}
            orders={myOrders.orders}
            truncated={myOrders.truncated}
            connected={!!wallet.publicKey}
            slot={slot}
            slotMs={slotMs}
            multipliers={multipliers}
            symbolOf={symbolOf}
            onOpenTicker={setTicker}
          />
        )}
        {view === "portfolio" && (
          <PortfolioPage
            cluster={cluster}
            tickers={allTickers}
            quoteMint={cluster.quoteMint}
            quoteSymbol={cluster.quoteSymbol}
            wallet={walletTokens}
            orders={myOrders.orders}
            connected={!!wallet.publicKey}
            owner={wallet.publicKey?.toBase58() ?? null}
            slot={slot}
            slotMs={slotMs}
            multipliers={multipliers}
            prices={prices}
            symbolOf={symbolOf}
            onOpenTicker={setTicker}
          />
        )}

        {view === "trade" && (
        <main className="work-grid">
          <section className="card panel-chart">
            <div className="card-head">
              <div className="seg seg-sm" role="tablist" aria-label="View">
                <button role="tab" aria-selected={chartView === "candles"} className={chartView === "candles" ? "on" : ""} onClick={() => setChartView("candles")}>
                  Candles
                </button>
                <button role="tab" aria-selected={chartView === "depth"} className={chartView === "depth" ? "on" : ""} onClick={() => setChartView("depth")}>
                  Depth
                </button>
              </div>
              <span className="muted small num">
                {chartView === "candles" ? "one candle per auction" : "cumulative demand and supply"}
              </span>
            </div>
            {chartView === "candles" ? (
              m != null && venue.auctions ? (
                <Candles auctions={venue.auctions} m={m} slot={slot} slotMs={slotMs} now={now} theme={theme} />
              ) : (
                <div className="empty">Loading auctions…</div>
              )
            ) : (
              <DepthChart
                orders={book}
                indicative={indicative}
                reference={ref.fresh && ref.price != null ? { price: ref.price, fresh: true } : null}
                crossed={crossed}
              />
            )}
          </section>

          <section className="panel-order">
            <GetTestTokens
              tk={tk}
              sol={balances.sol}
              tickerRaw={balances.tickerRaw}
              quoteRaw={balances.quoteRaw}
              notify={notify}
              onFunded={refresh}
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
          </section>

          <section className="card panel-ladder">
            <div className="card-head">
              <h2>Book</h2>
              <span className="muted small num">{book.length} live orders</span>
            </div>
            <Ladder book={book} indicative={indicative} crossed={crossed} />
          </section>

          <section className="panel-status">
            {current && phase ? (
              <Countdown auction={current} phase={phase} slot={slot} slotMs={slotMs} now={now} />
            ) : loadingAuction ? (
              <CountdownSkeleton />
            ) : (
              <div className="card empty">{onCadence ? `Opening the next ${tk.symbol} auction…` : `No auction running for ${tk.symbol} — open one above.`}</div>
            )}
            {venue.auctions && <CrankPanel auctions={venue.auctions} slot={slot} pythFeed={tk.pythAccount} notify={notify} onDone={refresh} />}
          </section>

          {m != null && (
            <div className="panel-mine">
              <MyOrders
                tk={tk}
                cluster={cluster}
                auction={current}
                phase={phase}
                m={m}
                mine={mine}
                myOrders={myOrders.orders}
                notify={notify}
                onChange={refresh}
                onOpenOrders={() => setView("orders")}
              />
            </div>
          )}

          {venue.auctions && m != null && (
            <div className="panel-past">
              <PastAuctions auctions={venue.auctions} m={m} slot={slot} slotMs={slotMs} now={now} cluster={cluster} />
            </div>
          )}
        </main>
        )}

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
          <span>Auctions settle on Solana devnet · reference prices are read from Pyth on Solana mainnet</span>
          <a href="/#how">How it works ↗</a>
        </footer>
      </div>

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
