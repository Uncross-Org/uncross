// The ticker list: every listed ticker with its last clearing price and what
// its newest auction is doing now, from one venue read. The selected ticker
// is the one the rest of the shell shows.

import type { ClusterConfig, TickerSymbol } from "../config";
import { TICKERS } from "../config";
import type { Auction } from "../lib/auction";
import { fmtPrice } from "../lib/format";
import { programToPerShare } from "../lib/units";

/** Past this, a last-cross price is shown muted: it is history, not a quote. */
const STALE_MS = 60 * 60 * 1000;

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

export function Sidebar({ cluster, ticker, onSelect, all, loading, slot, slotMs, open, onClose }: Props) {
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
      <div className="side-label">Tickers · {cluster.label}</div>
      <ul className="side-list">
        {TICKERS.map((t) => {
          const tk = cluster.tickers[t];
          const mine = tk.mint ? all.filter((a) => a.tickerMint.toBase58() === tk.mint) : [];
          const newest = mine.slice().sort((a, b) => b.openSlot - a.openSlot)[0];
          const crossed = mine.filter((a) => a.executableVolume > 0n).sort((a, b) => b.closeSlot - a.closeSlot)[0];
          // Multipliers are per-ticker reads; the sidebar shows per token unit
          // and the main panel, which has the multiplier, shows per share.
          const last = crossed ? fmtPrice(programToPerShare(crossed.clearingPrice, 1)) : null;
          const running = newest && newest.status === "open" && slot != null && slot < newest.closeSlot;
          const frozen = running && slot != null && slot >= newest.closeSlot - newest.freezeSlots;
          // How long ago the price shown actually traded. A bare figure with no
          // age read as current even when it was days old.
          const ageMs = crossed && slot != null ? Math.max(0, (slot - crossed.closeSlot) * slotMs) : null;
          const stale = ageMs != null && ageMs > STALE_MS;
          return (
            <li key={t}>
              <button
                className={`side-item${t === ticker ? " on" : ""}`}
                aria-pressed={t === ticker}
                onClick={() => {
                  onSelect(t);
                  onClose();
                }}
              >
                <span className="side-sym">
                  <span className={`dot ${frozen ? "dot-warn" : running ? "dot-live" : "dot-off"}`} aria-hidden />
                  {t}
                </span>
                <span className={`side-px num${last == null || stale ? " side-px-muted" : ""}`}>
                  {loading ? "…" : (last ?? "No trades yet")}
                </span>
                <span className="side-name">{tk.name}</span>
                <span className="side-state num" title={frozen ? "Closing — no more cancelling" : undefined}>
                  {frozen ? "closing" : ageMs != null ? `traded ${ago(ageMs)}` : running ? "taking orders" : "between auctions"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="side-foot">
        <span className="num">prices per token unit · updates every 15s</span>
      </div>
    </aside>
  );
}
