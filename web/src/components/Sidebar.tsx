// The ticker picker: a search box over every listed xStock, with the books
// that are actually running shown first.
//
// A fixed list stopped working once every xStock was listed — a thousand-odd
// names cannot be scrolled. With nothing typed, the picker shows only live
// books and the tickers on the keeper's cadence; typing searches the whole
// listing by symbol, name or underlying. A dormant ticker reads as listed and
// available, never as a live book with nothing in it.

import { useMemo, useState } from "react";
import type { ClusterConfig, TickerSymbol } from "../config";
import type { Auction } from "../lib/auction";
import { fmtPrice } from "../lib/format";
import type { ListedTicker } from "../lib/universe";
import { programToPerShare } from "../lib/units";

/** Past this, a last-cross price is shown muted: it is history, not a quote. */
const STALE_MS = 60 * 60 * 1000;
/** Rendered at most, so a one-letter search over a thousand names stays quick. */
const MAX_RESULTS = 40;

function ago(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

interface Props {
  cluster: ClusterConfig;
  universe: ListedTicker[] | null;
  ticker: TickerSymbol;
  onSelect: (t: TickerSymbol) => void;
  all: Auction[];
  loading: boolean;
  slot: number | null;
  /** Measured milliseconds per slot, to turn a slot distance into an age. */
  slotMs: number;
  open: boolean;
  onClose: () => void;
}

interface Row {
  symbol: string;
  name: string;
  mint: string | null;
  active: boolean;
  halted: boolean;
  tvl: number | null;
}

export function Sidebar({ cluster, universe, ticker, onSelect, all, loading, slot, slotMs, open, onClose }: Props) {
  const [query, setQuery] = useState("");

  // Every row the picker can show: the compiled-in ten, then the listing.
  const rows = useMemo<Row[]>(() => {
    const out = new Map<string, Row>();
    for (const t of Object.values(cluster.tickers)) out.set(t.symbol, { symbol: t.symbol, name: t.name, mint: t.mint, active: true, halted: false, tvl: null });
    for (const t of universe ?? []) {
      const had = out.get(t.symbol);
      out.set(t.symbol, { symbol: t.symbol, name: had?.name ?? t.name.replace(/ xStock$/, ""), mint: t.devnetMint, active: t.active || !!had, halted: t.halted, tvl: t.poolTvlUsd });
    }
    return [...out.values()];
  }, [cluster, universe]);

  // What each ticker's newest auction is doing, from the one venue read.
  const state = useMemo(() => {
    const byMint = new Map<string, Auction[]>();
    for (const a of all) {
      const k = a.tickerMint.toBase58();
      byMint.set(k, [...(byMint.get(k) ?? []), a]);
    }
    return (mint: string | null) => {
      const mine = mint ? (byMint.get(mint) ?? []) : [];
      const newest = mine.slice().sort((a, b) => b.openSlot - a.openSlot)[0];
      const crossed = mine.filter((a) => a.executableVolume > 0n).sort((a, b) => b.closeSlot - a.closeSlot)[0];
      const running = !!newest && newest.status === "open" && slot != null && slot < newest.closeSlot;
      const frozen = running && slot != null && slot >= newest.closeSlot - newest.freezeSlots;
      const ageMs = crossed && slot != null ? Math.max(0, (slot - crossed.closeSlot) * slotMs) : null;
      return { running, frozen, crossed, ageMs, any: mine.length > 0 };
    };
  }, [all, slot, slotMs]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const scored = rows.map((r) => ({ r, s: state(r.mint) }));
    const pool = q
      ? scored.filter(({ r }) => r.symbol.toLowerCase().includes(q) || r.name.toLowerCase().includes(q))
      : // Nothing typed: the live books, the tickers on cadence, and whichever
        // ticker is being viewed, so the one on screen is always highlighted.
        scored.filter(({ r, s }) => r.active || s.running || r.symbol === ticker);
    return pool
      .sort((a, b) => {
        // Live books first, then tickers on cadence, then by real pool size.
        if (a.s.running !== b.s.running) return a.s.running ? -1 : 1;
        if (q) {
          const ap = a.r.symbol.toLowerCase().startsWith(q), bp = b.r.symbol.toLowerCase().startsWith(q);
          if (ap !== bp) return ap ? -1 : 1;
        }
        if (a.r.active !== b.r.active) return a.r.active ? -1 : 1;
        return (b.r.tvl ?? -1) - (a.r.tvl ?? -1);
      })
      .slice(0, MAX_RESULTS);
  }, [rows, state, q, ticker]);

  const listedCount = universe?.length ?? rows.length;
  const hidden = q ? 0 : listedCount - shown.length;

  return (
    <aside className={`side${open ? " side-open" : ""}`} aria-label="Tickers">
      <div className="side-head">
        <a className="wordmark" href="/" title="Back to the site">
          <span className="mark" aria-hidden />
          Uncross
        </a>
        <button className="icon-btn side-close" onClick={onClose} aria-label="Close ticker list">
          ×
        </button>
      </div>
      <div className="side-search">
        <input
          id="ticker-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={universe ? `Search ${listedCount.toLocaleString("en-US")} xStocks` : "Search tickers"}
          aria-label="Search tickers by symbol or company"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="side-label">{q ? `${shown.length === MAX_RESULTS ? `Top ${MAX_RESULTS}` : shown.length} matching` : `Running · ${cluster.label}`}</div>
      <ul className="side-list">
        {shown.map(({ r, s }) => {
          const last = s.crossed ? fmtPrice(programToPerShare(s.crossed.clearingPrice, 1)) : null;
          const stale = s.ageMs != null && s.ageMs > STALE_MS;
          const dormant = !r.active && !s.running;
          return (
            <li key={r.symbol}>
              <button
                className={`side-item${r.symbol === ticker ? " on" : ""}`}
                aria-pressed={r.symbol === ticker}
                onClick={() => {
                  onSelect(r.symbol);
                  onClose();
                }}
              >
                <span className="side-sym">
                  <span className={`dot ${s.frozen ? "dot-warn" : s.running ? "dot-live" : "dot-off"}`} aria-hidden />
                  {r.symbol}
                </span>
                <span className={`side-px num${last == null || stale ? " side-px-muted" : ""}`}>
                  {loading ? "…" : (last ?? (dormant ? "" : "No trades yet"))}
                </span>
                <span className="side-name">{r.name}</span>
                <span className={`side-state num${dormant ? " side-listed" : ""}`} title={s.frozen ? "Closing — no more cancelling" : undefined}>
                  {r.halted && dormant
                    ? "halted"
                    : s.frozen
                      ? "closing"
                      : dormant
                        ? "listed · open one"
                        : s.ageMs != null
                          ? `traded ${ago(s.ageMs)}`
                          : s.running
                            ? "taking orders"
                            : "between auctions"}
                </span>
              </button>
            </li>
          );
        })}
        {q && shown.length === 0 && <li className="side-empty">No listed xStock matches “{query}”.</li>}
      </ul>
      {hidden > 0 && (
        <div className="side-more">
          <span className="num">{hidden.toLocaleString("en-US")}</span> more listed — search to find one and open its auction.
        </div>
      )}
      <div className="side-foot">
        <span className="num">prices per token unit · updates every 15s</span>
      </div>
    </aside>
  );
}
