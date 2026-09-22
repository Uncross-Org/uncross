// The ticker list: every listed ticker with its last clearing price and what
// its newest auction is doing now, from one venue read. The selected ticker
// is the one the rest of the shell shows.

import type { ClusterConfig, TickerSymbol } from "../config";
import { TICKERS } from "../config";
import type { Auction } from "../lib/auction";
import { fmtPrice } from "../lib/format";
import { programToPerShare } from "../lib/units";

interface Props {
  cluster: ClusterConfig;
  ticker: TickerSymbol;
  onSelect: (t: TickerSymbol) => void;
  all: Auction[];
  loading: boolean;
  slot: number | null;
  open: boolean;
  onClose: () => void;
}

export function Sidebar({ cluster, ticker, onSelect, all, loading, slot, open, onClose }: Props) {
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
                <span className="side-px num">{loading ? "…" : (last ?? "—")}</span>
                <span className="side-name">{tk.name}</span>
                <span className="side-state num">{frozen ? "frozen" : running ? "taking orders" : crossed ? "last cross" : "no cross yet"}</span>
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
