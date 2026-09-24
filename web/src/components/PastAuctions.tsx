import { useState } from "react";
import { explorerAddr, type ClusterConfig } from "../config";
import type { Auction } from "../lib/auction";
import { fmtExactPrice, fmtInt, fmtLocal, fmtPrice, fmtShares, fmtUsd } from "../lib/format";
import { programToPerShare, rawToShares } from "../lib/units";

interface Props {
  auctions: Auction[];
  m: number;
  slot: number | null;
  slotMs: number;
  now: number;
  cluster: ClusterConfig;
}

export function PastAuctions({ auctions, m, slot, slotMs, now, cluster }: Props) {
  const [n, setN] = useState(8);
  const past = auctions.filter((a) => a.status !== "open");
  // The last price this ticker actually traded at: history, so it lives here
  // rather than beside the order form.
  const last = past.filter((a) => a.executableVolume > 0n).sort((x, y) => y.closeSlot - x.closeSlot)[0];
  const lastMs = last && slot != null ? now - (slot - last.closeSlot) * slotMs : null;
  return (
    <section className="card past" aria-label="Past auctions">
      <div className="card-head">
        <h2>Past crosses</h2>
        <span className="muted small">{past.length ? `${past.length} total` : ""}</span>
      </div>
      {last && (
        <p className="past-last num">
          Last cross <b>{fmtExactPrice(programToPerShare(last.clearingPrice, m))}</b> · {fmtShares(rawToShares(last.executableVolume, m))}{" "}
          {rawToShares(last.executableVolume, m) === 1 ? "share" : "shares"}
          {lastMs != null ? ` · window closed ≈ ${fmtLocal(lastMs)}` : ""}
        </p>
      )}
      {past.length === 0 ? (
        <div className="empty small">No completed auctions yet.</div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="tbl num">
              <thead>
                <tr>
                  <th>Closed</th>
                  <th>Clearing price</th>
                  <th>Volume</th>
                  <th>Orders</th>
                  <th>Pyth anchor</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {past.slice(0, n).map((a) => {
                  const traded = a.executableVolume > 0n;
                  const price = programToPerShare(a.clearingPrice, m);
                  const vol = rawToShares(a.executableVolume, m);
                  const closedMs = slot != null ? now - (slot - a.closeSlot) * slotMs : null;
                  return (
                    <tr key={a.address.toBase58()}>
                      <td>
                        <a href={explorerAddr(cluster, a.address.toBase58())} target="_blank" rel="noreferrer" title={`Slot ${fmtInt(a.closeSlot)}`}>
                          {closedMs ? `≈ ${fmtLocal(closedMs)}` : `slot ${fmtInt(a.closeSlot)}`}
                        </a>
                      </td>
                      <td>{traded ? fmtExactPrice(price) : <span className="muted">no trade</span>}</td>
                      <td>
                        {traded ? (
                          <>
                            {fmtShares(vol)} <span className="muted">· {fmtUsd(vol * price)}</span>
                          </>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td>{a.orderCount}</td>
                      <td>
                        {a.referencePriceSet ? (
                          <span title="A live Pyth price was used to break a tie">Yes · {fmtPrice(programToPerShare(a.referencePrice, m))}</span>
                        ) : (
                          <span className="muted">No</span>
                        )}
                      </td>
                      <td>{a.status === "settled" ? (a.settlePath === "refund" ? "Refunded" : "Settled") : "Settling"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {past.length > n && (
            <button className="link-btn" onClick={() => setN((x) => x + 12)}>
              Show more
            </button>
          )}
        </>
      )}
    </section>
  );
}
