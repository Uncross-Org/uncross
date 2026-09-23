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
import { fmtDuration, fmtPct, fmtPrice, fmtShares, shortAddr } from "./lib/format";
import { referenceState } from "./lib/reference";
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
  const [ticker, setTicker] = useState<TickerSymbol>(tickerFromUrl);
  const [sideOpen, setSideOpen] = useState(false);
  const [view, setView] = useState<"candles" | "depth">("candles");
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
    window.history.replaceState(null, "", u);
  }, [ticker]);

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
  // Buyers willing to pay more than sellers are asking: normal here, alarming
  // anywhere else, so the stats row explains it when it happens.
  const crossedBook = bid != null && ask != null && bid >= ask;
  const vsRef = ref.fresh && ref.price != null && indicative && indicative.volume > 0 ? ((indicative.price - ref.price) / ref.price) * 100 : null;

  // What this ticker last actually traded at. For a name with no Pyth feed —
  // IBMx, the whole point of this venue — an empty book offers no price at
  // all, and the first person to arrive has nothing to type. The previous
  // auction's clearing price is real, on-chain, and the honest anchor.
  const lastCross = useMemo(() => {
    if (!m) return null;
    const traded = (venue.auctions ?? [])
      .filter((a) => a.status !== "open" && a.executableVolume > 0n)
      .sort((x, y) => y.closeSlot - x.closeSlot)[0];
    return traded ? programToPerShare(traded.clearingPrice, m) : null;
  }, [venue.auctions, m]);

  const suggestions = useMemo(() => {
    const s: { label: string; price: number }[] = [];
    if (ref.fresh && ref.price != null) s.push({ label: "Pyth mainnet", price: ref.price });
    if (indicative && indicative.volume > 0 && !crossed) s.push({ label: "Cross", price: indicative.price });
    if (lastCross != null) s.push({ label: "Last cross", price: lastCross });
    if (bid != null) s.push({ label: "Bid", price: bid });
    if (ask != null) s.push({ label: "Ask", price: ask });
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref.price, ref.fresh, indicative?.price, indicative?.volume, crossed, lastCross, bid, ask]);
  const loadingAuction = !!mint && venue.auctions === null && !venue.error;
  const secsLeft = current && slot != null && (phase === "open" || phase === "freeze") ? Math.max(0, (current.closeSlot - slot) * slotMs) : null;

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
          </div>
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
        {!onCadence && tk.mint && venue.auctions !== null && !(current && slot != null && current.status === "open" && slot < current.closeSlot) && (
          <OpenAuction tk={tk} halted={!!listed?.halted} notify={notify} onOpened={(a) => void venue.adopt(a)} />
        )}

        {/* The numbers that matter, in a row: the cross, the book's edges, the reference. */}
        <div className="stats num">
          <div className="stat">
            <span className="stat-l">{crossed ? "Clearing price" : "Indicative cross"}</span>
            <span className="stat-v accent">{indicative && indicative.volume > 0 ? fmtPrice(indicative.price) : "—"}</span>
            <span className="stat-s">
              {indicative && indicative.volume > 0 ? `${fmtShares(indicative.volume)} sh ${crossed ? "crossed" : "executable"}` : book.length ? "book not crossing yet" : "no orders yet"}
            </span>
          </div>
          {/* A bid above an ask is impossible in a continuous market and reads
              as broken data. Here it is the mechanism: orders wait for the
              cross instead of executing on arrival, so the two sides overlap
              and that overlap is exactly what trades. Say so where it shows. */}
          <div className="stat">
            <span className="stat-l">Best bid</span>
            <span className="stat-v buy">{fmtPrice(bid)}</span>
            <span className="stat-s">
              {book.filter((o) => o.side === "buy").length} buy orders
              {crossedBook ? " · above best ask" : ""}
            </span>
          </div>
          <div className="stat">
            <span className="stat-l">Best ask</span>
            <span className="stat-v sell">{fmtPrice(ask)}</span>
            <span className="stat-s">
              {book.filter((o) => o.side === "sell").length} sell orders
              {crossedBook ? " · below best bid" : ""}
            </span>
          </div>
          {crossedBook && (
            <div className="stat stat-explain">
              <span className="stat-l">Why the bid is above the ask</span>
              <span className="stat-v overlap">
                {indicative && indicative.volume > 0 ? `${fmtShares(indicative.volume)} sh` : "—"}
              </span>
              <span className="stat-s">
                nothing executes on arrival — they overlap until the cross, and the overlap is what trades
              </span>
            </div>
          )}
          <div className="stat">
            <span className="stat-l">Pyth · {tk.underlying}/USD · mainnet</span>
            <span className={`stat-v${ref.fresh ? "" : " muted"}`}>{ref.price != null ? fmtPrice(ref.price) : ref.kind === "none" ? "no feed" : "—"}</span>
            <span className="stat-s">
              {ref.kind === "none"
                ? "no Pyth price on Solana for this name"
                : ref.kind === "stale"
                  ? `stale · ${fmtDuration(ref.ageMs ?? 0)} old`
                  : ref.fresh
                    ? `${ref.kind === "extended" ? "extended hours" : "live"} · ${Math.round((ref.ageMs ?? 0) / 1000)}s ago${vsRef != null ? ` · cross ${fmtPct(vsRef)}` : ""}`
                    : "reading…"}
            </span>
          </div>
          {m != null && m !== 1 && (
            <div className="stat">
              <span className="stat-l">Multiplier</span>
              <span className="stat-v">{m.toFixed(4)}</span>
              <span className="stat-s">1 token unit = {m.toFixed(4)} shares</span>
            </div>
          )}
        </div>

        {venue.error && <div className="banner err">Couldn't load auctions: {venue.error}. Retrying automatically.</div>}

        <main className="work-grid">
          <section className="card panel-chart">
            <div className="card-head">
              <div className="seg seg-sm" role="tablist" aria-label="View">
                <button role="tab" aria-selected={view === "candles"} className={view === "candles" ? "on" : ""} onClick={() => setView("candles")}>
                  Candles
                </button>
                <button role="tab" aria-selected={view === "depth"} className={view === "depth" ? "on" : ""} onClick={() => setView("depth")}>
                  Depth
                </button>
              </div>
              <span className="muted small num">
                {view === "candles" ? "one candle per auction" : "cumulative demand and supply"}
              </span>
            </div>
            {view === "candles" ? (
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

          {current && phase && m != null && (
            <div className="panel-mine">
              <MyOrders tk={tk} auction={current} phase={phase} m={m} mine={mine} notify={notify} onChange={refresh} />
            </div>
          )}

          {venue.auctions && m != null && (
            <div className="panel-past">
              <PastAuctions auctions={venue.auctions} m={m} slot={slot} slotMs={slotMs} now={now} cluster={cluster} />
            </div>
          )}
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
          <span>Auctions settle on Solana devnet · reference prices are read from Pyth on Solana mainnet</span>
          <a href="/">How it works ↗</a>
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
