"use client";

// The hero's right side: cumulative demand and cumulative supply assembling as
// orders arrive, and meeting at the cross.
//
// The data is the live devnet book, not a canned loop — each step in these
// curves is a real order someone's wallet placed. When a new order lands the
// curves redraw to the new shape; nothing loops for decoration.
//
// Reduced motion renders exactly the same curves, fully drawn, with no
// transition.

import { useEffect, useMemo, useRef, useState } from "react";
import { demandAt, niceCeil, niceTicks, supplyAt, type BookOrder } from "@/lib/uncross/book";
import { fmtPrice, fmtShares } from "@/lib/uncross/format";

const M = { l: 46, r: 18, t: 22, b: 30 };

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

interface Props {
  book: BookOrder[];
  indicative: { price: number; volume: number } | null;
  height?: number;
  /** Shown while the first read is in flight. */
  loading?: boolean;
}

export function DepthCurves({ book, indicative, height = 260, loading = false }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = height;

  const geo = useMemo(() => {
    if (!book.length) return null;
    const P = Array.from(new Set(book.map((o) => o.price))).sort((a, b) => a - b);
    let lo = P[0];
    let hi = P[P.length - 1];
    if (indicative && indicative.volume > 0) {
      lo = Math.min(lo, indicative.price);
      hi = Math.max(hi, indicative.price);
    }
    const span = hi - lo;
    const mid = (lo + hi) / 2;
    const pad = span > 0 ? Math.max(span * 0.18, mid * 0.004) : Math.max(mid * 0.02, 0.01);
    const x0 = Math.max(0, lo - pad);
    const x1 = hi + pad;
    const yMax = niceCeil(Math.max(demandAt(book, -Infinity), supplyAt(book, Infinity)) * 1.12);
    const pw = W - M.l - M.r;
    const ph = H - M.t - M.b;
    const sx = (p: number) => M.l + ((p - x0) / (x1 - x0)) * pw;
    const sy = (q: number) => M.t + (1 - q / yMax) * ph;

    // Demand steps down just after each price; supply steps up at each price.
    let dPath = `M ${sx(x0)} ${sy(demandAt(book, P[0]))}`;
    P.forEach((p, i) => {
      dPath += ` H ${sx(p)} V ${sy(i + 1 < P.length ? demandAt(book, P[i + 1]) : 0)}`;
    });
    dPath += ` H ${sx(x1)}`;
    let sPath = `M ${sx(x0)} ${sy(0)}`;
    P.forEach((p) => {
      sPath += ` H ${sx(p)} V ${sy(supplyAt(book, p))}`;
    });
    sPath += ` H ${sx(x1)}`;
    const close = ` V ${sy(0)} H ${sx(x0)} Z`;

    return {
      x0,
      x1,
      sx,
      sy,
      pw,
      dPath,
      sPath,
      dArea: dPath + close,
      sArea: sPath + close,
      xt: niceTicks(x0, x1, W < 480 ? 3 : 5),
      yt: niceTicks(0, yMax, 3),
      hasBuys: demandAt(book, -Infinity) > 0,
      hasSells: supplyAt(book, Infinity) > 0,
    };
  }, [book, indicative, W, H]);

  // Redraw key: the curves re-run their draw-on transition whenever the book
  // actually changes, so motion marks a real event (an order arrived).
  const bookKey = useMemo(
    () => book.map((o) => `${o.index}:${o.side}:${o.price}:${o.shares}`).join("|"),
    [book],
  );

  return (
    <div ref={wrap} className="w-full">
      {!geo ? (
        <div
          className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-5 text-center"
          style={{ height: H }}
        >
          <div className="text-sm font-semibold text-text-2">
            {loading ? "Reading the book from devnet…" : "No orders in this auction yet"}
          </div>
          <div className="max-w-[38ch] text-[13px] text-muted">
            {loading ? "" : "Demand and supply curves appear here as orders arrive, and cross at the auction price."}
          </div>
        </div>
      ) : (
        <svg
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={
            indicative
              ? `Cumulative demand and supply by price, crossing at ${fmtPrice(indicative.price)} for ${fmtShares(indicative.volume)} shares`
              : "Cumulative demand and supply by price"
          }
        >
          {geo.yt.map((q) => (
            <g key={`y${q}`}>
              <line
                x1={M.l}
                x2={W - M.r}
                y1={geo.sy(q)}
                y2={geo.sy(q)}
                stroke="var(--grid)"
                strokeDasharray="3 4"
              />
              <text
                x={M.l - 8}
                y={geo.sy(q)}
                dy="0.32em"
                textAnchor="end"
                fill="var(--muted)"
                fontSize="11"
                fontFamily="var(--font-geist-mono), monospace"
              >
                {fmtShares(q)}
              </text>
            </g>
          ))}
          {geo.xt.map((p) => (
            <text
              key={`x${p}`}
              x={geo.sx(p)}
              y={H - M.b + 18}
              textAnchor="middle"
              fill="var(--muted)"
              fontSize="11"
              fontFamily="var(--font-geist-mono), monospace"
            >
              {fmtPrice(p)}
            </text>
          ))}

          <path d={geo.dArea} fill="var(--bid)" opacity={0.1} />
          <path d={geo.sArea} fill="var(--ask)" opacity={0.1} />

          {geo.hasBuys && (
            <path
              key={`d${bookKey}`}
              d={geo.dPath}
              fill="none"
              stroke="var(--bid)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={reduced ? undefined : "draw-in"}
            />
          )}
          {geo.hasSells && (
            <path
              key={`s${bookKey}`}
              d={geo.sPath}
              fill="none"
              stroke="var(--ask)"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              className={reduced ? undefined : "draw-in draw-in-delay"}
            />
          )}

          {indicative && indicative.volume > 0 && (
            <g>
              <line
                x1={geo.sx(indicative.price)}
                x2={geo.sx(indicative.price)}
                y1={M.t}
                y2={H - M.b}
                stroke="var(--text)"
                strokeWidth={1}
                strokeDasharray="2 3"
              />
              <circle cx={geo.sx(indicative.price)} cy={geo.sy(indicative.volume)} r={5} fill="var(--text)" />
              <text
                x={Math.min(geo.sx(indicative.price) + 10, W - M.r - 130)}
                y={Math.max(M.t + 12, geo.sy(indicative.volume) - 12)}
                fill="var(--text)"
                fontSize="12"
                fontWeight={600}
                fontFamily="var(--font-geist-mono), monospace"
              >
                cross {fmtPrice(indicative.price)}
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
