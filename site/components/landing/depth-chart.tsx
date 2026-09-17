"use client";

// The depth curves, drawn with Recharts, finished as an instrument.
//
// Tremor was the first choice and is not usable here: its current release is
// 3.18.7, which declares react ^18 as a peer and expects a Tailwind v3
// tailwind.config.js colour preset. This app is React 19 on Tailwind v4,
// whose config is CSS-first, so the preset has nowhere to live. Recharts
// supports React 19 and has stepAfter/stepBefore interpolation, which is
// exactly the shape a cumulative order book makes.
//
// What is drawn is unchanged: cumulative demand (buyers at or above a price)
// against cumulative supply (sellers at or below it), crossing where the most
// shares can trade. The finish follows how exchanges draw depth: filled areas
// that fade from the line, a hairline grid on both axes, the share axis on the
// left, a tagged cross line, and a crosshair whose readout follows the price
// under the pointer with a marker on each curve.

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { demandAt, supplyAt, type BookOrder } from "@/lib/uncross/book";
import { fmtPrice, fmtShares } from "@/lib/uncross/format";

const MONO = "var(--font-geist-mono), ui-monospace, monospace";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

interface Row {
  price: number;
  demand: number;
  supply: number;
}

interface Props {
  book: BookOrder[];
  indicative: { price: number; volume: number } | null;
  height?: number;
  loading?: boolean;
}

function Readout({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number; dataKey: string }[];
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const demand = payload.find((p) => p.dataKey === "demand")?.value ?? 0;
  const supply = payload.find((p) => p.dataKey === "supply")?.value ?? 0;
  const row = (k: string, v: string, cls: string) => (
    <div className="flex justify-between gap-5">
      <span className="text-muted">{k}</span>
      <span className={`font-semibold ${cls}`}>{v}</span>
    </div>
  );
  return (
    <div className="num rounded-md border border-line bg-surface px-2.5 py-2 text-[11.5px] leading-[1.6] shadow-[0_8px_24px_-8px_rgba(11,14,20,0.35)]">
      <div className="mb-1 border-b border-line pb-1 font-semibold text-text">{fmtPrice(label ?? 0)}</div>
      {row("bid ≥", fmtShares(demand), "text-bid")}
      {row("ask ≤", fmtShares(supply), "text-ask")}
      {row("fills", fmtShares(Math.min(demand, supply)), "text-text")}
    </div>
  );
}

// The crosshair: a vertical hairline with the price under the pointer tagged
// on the axis. Recharts hands the cursor the hovered row's coordinates.
function Crosshair(props: {
  points?: { x: number; y: number }[];
  height?: number;
  payload?: { payload: Row }[];
}) {
  // Recharts hands a line cursor two points, the top and bottom of the plot.
  const x = props.points?.[0]?.x;
  const price = props.payload?.[0]?.payload.price;
  if (x == null || price == null) return null;
  const top = props.points?.[0]?.y ?? 0;
  const bottom = props.points?.[1]?.y ?? top + (props.height ?? 0);
  const text = fmtPrice(price);
  const w = text.length * 7 + 26;
  return (
    <g>
      <line x1={x} x2={x} y1={top} y2={bottom} stroke="var(--text)" strokeWidth={1} strokeDasharray="1 3" />
      <rect x={x - w / 2} y={bottom + 2} width={w} height={17} rx={3} fill="var(--text)" />
      <text x={x} y={bottom + 14} textAnchor="middle" fontSize={10.5} fontFamily={MONO} fill="var(--bg)">
        {text}
      </text>
    </g>
  );
}

// The cross price as a tag on its line, the way an exchange marks last.
function CrossTag(props: { viewBox?: { x: number; y: number }; text: string }) {
  const x = props.viewBox?.x ?? 0;
  const y = props.viewBox?.y ?? 0;
  const w = props.text.length * 7 + 14;
  return (
    <g>
      <rect x={x - w / 2} y={y - 20} width={w} height={18} rx={3} fill="var(--text)" />
      <text x={x} y={y - 7} textAnchor="middle" fontSize={11} fontWeight={600} fontFamily={MONO} fill="var(--bg)">
        {props.text}
      </text>
    </g>
  );
}

export function DepthChart({ book, indicative, height = 280, loading = false }: Props) {
  const reduced = usePrefersReducedMotion();

  const { rows, domain } = useMemo(() => {
    if (!book.length) return { rows: [] as Row[], domain: [0, 1] as [number, number] };

    const prices = Array.from(new Set(book.map((o) => o.price))).sort((a, b) => a - b);
    let lo = prices[0];
    let hi = prices[prices.length - 1];
    if (indicative && indicative.volume > 0) {
      lo = Math.min(lo, indicative.price);
      hi = Math.max(hi, indicative.price);
    }
    const span = hi - lo;
    const mid = (lo + hi) / 2;
    const pad = span > 0 ? Math.max(span * 0.18, mid * 0.004) : Math.max(mid * 0.02, 0.01);
    const x0 = Math.max(0, lo - pad);
    const x1 = hi + pad;

    // Sample the step functions at every price level plus the padded edges, so
    // stepAfter draws the true cumulative shape rather than a smoothed one.
    const xs = [x0, ...prices, x1];
    const rows = xs.map((price) => ({
      price,
      demand: demandAt(book, price),
      supply: supplyAt(book, price),
    }));

    return { rows, domain: [x0, x1] as [number, number] };
  }, [book, indicative]);

  if (!rows.length) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-5 text-center"
        style={{ height }}
      >
        <div className="text-sm font-semibold text-text-2">
          {loading ? "Reading the book from devnet…" : "No orders in this auction yet"}
        </div>
        <div className="max-w-[38ch] text-[13px] text-muted">
          {loading ? "" : "Demand and supply curves appear here as orders arrive, and cross at the auction price."}
        </div>
      </div>
    );
  }

  const tick = { fill: "var(--muted)", fontSize: 10.5, fontFamily: MONO };

  return (
    <div style={{ height }} aria-label="Cumulative demand and supply by price" className="relative">
      {/* Axis legends, set the way a terminal labels them: small, in the corners. */}
      <div className="num pointer-events-none absolute top-1 left-12 text-[10px] tracking-[0.08em] text-muted uppercase">
        shares
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 28, right: 40, bottom: 22, left: 4 }}>
          <defs>
            <linearGradient id="depth-bid" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--bid)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--bid)" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="depth-ask" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ask)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--ask)" stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--grid)" strokeWidth={1} strokeDasharray="0" />
          <XAxis
            dataKey="price"
            type="number"
            domain={domain}
            tickCount={6}
            tickFormatter={(v: number) => fmtPrice(v)}
            tick={tick}
            stroke="var(--line)"
            tickLine={{ stroke: "var(--line)" }}
            tickSize={4}
          />
          <YAxis
            tickFormatter={(v: number) => fmtShares(v)}
            tick={tick}
            stroke="var(--line)"
            tickLine={{ stroke: "var(--line)" }}
            tickSize={4}
            width={44}
          />
          <Tooltip
            content={<Readout />}
            cursor={<Crosshair />}
            isAnimationActive={false}
            wrapperStyle={{ outline: "none" }}
            allowEscapeViewBox={{ x: false, y: true }}
          />

          <Area
            type="stepAfter"
            dataKey="demand"
            stroke="var(--bid)"
            strokeWidth={2}
            fill="url(#depth-bid)"
            isAnimationActive={!reduced}
            animationDuration={700}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--bid)" }}
            name="Buyers at or above"
          />
          <Area
            type="stepBefore"
            dataKey="supply"
            stroke="var(--ask)"
            strokeWidth={2}
            fill="url(#depth-ask)"
            isAnimationActive={!reduced}
            animationDuration={700}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 2, stroke: "var(--surface)", fill: "var(--ask)" }}
            name="Sellers at or below"
          />

          {indicative && indicative.volume > 0 && (
            <>
              {/* The cross: a solid line at the price, a dashed level at the
                  volume it fills, the price tagged on the line. */}
              <ReferenceLine
                y={indicative.volume}
                stroke="var(--text-2)"
                strokeDasharray="3 3"
                strokeOpacity={0.6}
                label={{ value: fmtShares(indicative.volume), position: "insideLeft", dy: -7, fill: "var(--text-2)", fontSize: 10.5, fontFamily: MONO }}
              />
              <ReferenceLine
                x={indicative.price}
                stroke="var(--text)"
                strokeWidth={1.25}
                label={<CrossTag text={`cross ${fmtPrice(indicative.price)}`} />}
              />
              <ReferenceDot
                x={indicative.price}
                y={indicative.volume}
                r={5}
                fill="var(--text)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
