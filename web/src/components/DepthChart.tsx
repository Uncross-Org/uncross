import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { demandAt, levels, niceCeil, niceTicks, supplyAt, type BookOrder } from "../lib/book";
import { fmtPrice, fmtShares } from "../lib/format";

interface Props {
  orders: BookOrder[];
  indicative: { price: number; volume: number } | null;
  reference: { price: number; fresh: boolean } | null;
  crossed: boolean;
}

const M = { l: 52, r: 16, t: 26, b: 34 };

/** Approximate rendered width of the cross label (12px semibold ≈ 7px/char). */
const crossLabelW = (ind: { price: number; volume: number }, crossed: boolean) =>
  `${crossed ? "Cleared at" : "Would clear at"} ${fmtPrice(ind.price)} · ${fmtShares(ind.volume)} shares`.length * 7;

export function DepthChart({ orders, indicative, reference, crossed }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(320);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = W < 520 ? 240 : 310;
  const narrow = W < 520;

  const geo = useMemo(() => {
    if (!orders.length) return null;
    const P = Array.from(new Set(orders.map((o) => o.price))).sort((a, b) => a - b);
    let lo = P[0];
    let hi = P[P.length - 1];
    if (indicative && indicative.volume > 0) {
      lo = Math.min(lo, indicative.price);
      hi = Math.max(hi, indicative.price);
    }
    let refIn = false;
    if (reference) {
      const mid = (lo + hi) / 2;
      if (Math.abs(reference.price - mid) / mid <= 0.25) {
        lo = Math.min(lo, reference.price);
        hi = Math.max(hi, reference.price);
        refIn = true;
      }
    }
    const span = hi - lo;
    const mid = (lo + hi) / 2;
    const pad = span > 0 ? Math.max(span * 0.18, mid * 0.004) : Math.max(mid * 0.02, 0.01);
    const x0 = Math.max(0, lo - pad);
    const x1 = hi + pad;
    const totalBuy = demandAt(orders, -Infinity);
    const totalSell = supplyAt(orders, Infinity);
    const yMax = niceCeil(Math.max(totalBuy, totalSell) * 1.12);
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const sx = (p: number) => M.l + ((p - x0) / (x1 - x0)) * pw;
    const sy = (q: number) => M.t + (1 - q / yMax) * ph;

    // Demand: D(x) = D(P[i+1]) on (P[i], P[i+1]]; steps down just after each price.
    let dPath = `M ${sx(x0)} ${sy(demandAt(orders, P[0]))}`;
    P.forEach((p, i) => {
      dPath += ` H ${sx(p)} V ${sy(i + 1 < P.length ? demandAt(orders, P[i + 1]) : 0)}`;
    });
    dPath += ` H ${sx(x1)}`;
    // Supply: S(x) = S(P[i]) on [P[i], P[i+1]); steps up at each price.
    let sPath = `M ${sx(x0)} ${sy(0)}`;
    P.forEach((p) => {
      sPath += ` H ${sx(p)} V ${sy(supplyAt(orders, p))}`;
    });
    sPath += ` H ${sx(x1)}`;
    const close = ` V ${sy(0)} H ${sx(x0)} Z`;

    return {
      x0,
      x1,
      yMax,
      sx,
      sy,
      pw,
      dPath,
      sPath,
      dArea: dPath + close,
      sArea: sPath + close,
      xt: niceTicks(x0, x1, narrow ? 4 : 6),
      yt: niceTicks(0, yMax, 4),
      refIn,
      hasBuys: totalBuy > 0,
      hasSells: totalSell > 0,
    };
  }, [orders, indicative, reference, W, H, narrow]);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!geo) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const p = geo.x0 + ((px - M.l) / geo.pw) * (geo.x1 - geo.x0);
    setHover(Math.min(geo.x1, Math.max(geo.x0, p)));
  };

  const lv = useMemo(() => levels(orders), [orders]);

  return (
    <section className="card depth" aria-label="Order book depth">
      <div className="card-head">
        <h2>Order book</h2>
        <div className="legend" role="list">
          <span role="listitem">
            <i className="key key-buy" /> Buyers (at or above price)
          </span>
          <span role="listitem">
            <i className="key key-sell" /> Sellers (at or below price)
          </span>
          {orders.length > 0 && (
            <button className="link-btn" onClick={() => setShowTable((v) => !v)} aria-pressed={showTable}>
              {showTable ? "Chart" : "Table"}
            </button>
          )}
        </div>
      </div>

      <div ref={wrap} className="depth-wrap">
        {!geo ? (
          <div className="empty" style={{ height: H }}>
            <div className="empty-title">No orders in this auction yet</div>
            <div className="empty-sub">Place the first order. Demand and supply curves appear here, and cross at the auction price.</div>
          </div>
        ) : showTable ? (
          <div className="table-scroll" style={{ minHeight: H }}>
            <table className="tbl num">
              <thead>
                <tr>
                  <th>Price / share</th>
                  <th>Buy shares</th>
                  <th>Sell shares</th>
                  <th>Buyers ≥ price</th>
                  <th>Sellers ≤ price</th>
                </tr>
              </thead>
              <tbody>
                {lv
                  .slice()
                  .reverse()
                  .map((l) => (
                    <tr key={l.price}>
                      <td>{fmtPrice(l.price)}</td>
                      <td>{l.buyShares ? fmtShares(l.buyShares) : ""}</td>
                      <td>{l.sellShares ? fmtShares(l.sellShares) : ""}</td>
                      <td>{fmtShares(l.demand)}</td>
                      <td>{fmtShares(l.supply)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="svg-box">
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label="Cumulative buy demand and sell supply by price"
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
            >
              {geo.yt.map((q) => (
                <g key={`y${q}`}>
                  <line className="grid" x1={M.l} x2={W - M.r} y1={geo.sy(q)} y2={geo.sy(q)} />
                  <text className="axis" x={M.l - 8} y={geo.sy(q)} dy="0.32em" textAnchor="end">
                    {fmtShares(q)}
                  </text>
                </g>
              ))}
              {geo.xt.map((p) => (
                <text key={`x${p}`} className="axis" x={geo.sx(p)} y={H - M.b + 18} textAnchor="middle">
                  {fmtPrice(p)}
                </text>
              ))}
              <text className="axis axis-title" x={M.l - 8} y={M.t - 12} textAnchor="end">
                shares
              </text>

              <path d={geo.dArea} className="area-buy" />
              <path d={geo.sArea} className="area-sell" />
              {geo.hasBuys && <path d={geo.dPath} className="line-buy" />}
              {geo.hasSells && <path d={geo.sPath} className="line-sell" />}

              {reference &&
                (geo.refIn ? (
                  <g className={reference.fresh ? "ref-mark" : "ref-mark stale"}>
                    <line x1={geo.sx(reference.price)} x2={geo.sx(reference.price)} y1={M.t} y2={H - M.b} />
                    <text x={geo.sx(reference.price)} y={M.t - 8} textAnchor="middle">
                      Pyth mainnet {reference.fresh ? "" : "(stale) "}
                      {fmtPrice(reference.price)}
                    </text>
                  </g>
                ) : (
                  <text
                    className="axis ref-edge"
                    x={reference.price > geo.x1 ? W - M.r : M.l}
                    y={M.t - 8}
                    textAnchor={reference.price > geo.x1 ? "end" : "start"}
                  >
                    {reference.price > geo.x1 ? "" : "← "}Pyth mainnet {reference.fresh ? "" : "(stale) "}
                    {fmtPrice(reference.price)}
                    {reference.price > geo.x1 ? " →" : ""}
                  </text>
                ))}

              {indicative && indicative.volume > 0 && (
                <g className="cross-mark">
                  <line x1={geo.sx(indicative.price)} x2={geo.sx(indicative.price)} y1={geo.sy(indicative.volume)} y2={H - M.b} />
                  <line x1={M.l} x2={geo.sx(indicative.price)} y1={geo.sy(indicative.volume)} y2={geo.sy(indicative.volume)} className="cross-h" />
                  <circle cx={geo.sx(indicative.price)} cy={geo.sy(indicative.volume)} r={5} />
                  <text
                    x={Math.max(M.l, Math.min(geo.sx(indicative.price) + 10, W - M.r - crossLabelW(indicative, crossed)))}
                    y={Math.max(M.t + 12, geo.sy(indicative.volume) - 12)}
                    textAnchor="start"
                  >
                    {crossed ? "Cleared at" : "Would clear at"} {fmtPrice(indicative.price)} · {fmtShares(indicative.volume)} shares
                  </text>
                </g>
              )}

              {hover != null && <line className="crosshair" x1={geo.sx(hover)} x2={geo.sx(hover)} y1={M.t} y2={H - M.b} />}
              <rect x={M.l} y={M.t} width={geo.pw} height={H - M.t - M.b} fill="transparent" />
            </svg>
            {hover != null && (
              <div
                className="tooltip num"
                style={{
                  left: Math.min(W - 190, Math.max(0, geo.sx(hover) + 12)),
                  top: M.t + 4,
                }}
              >
                <div className="tt-title">{fmtPrice(hover)} / share</div>
                <div>
                  <i className="key key-buy" /> Buyers ≥ price <b>{fmtShares(demandAt(orders, hover))}</b>
                </div>
                <div>
                  <i className="key key-sell" /> Sellers ≤ price <b>{fmtShares(supplyAt(orders, hover))}</b>
                </div>
                <div className="tt-foot">
                  Would trade <b>{fmtShares(Math.min(demandAt(orders, hover), supplyAt(orders, hover)))}</b> sh
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
