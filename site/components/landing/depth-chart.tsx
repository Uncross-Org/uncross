"use client";

// The depth curves, drawn with Recharts.
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
// shares can trade. Recharts supplies the instrument finish — axis labels,
// gridlines and a hover readout.

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
  return (
    <div className="num rounded-lg border border-line bg-surface px-3 py-2 text-[12px] shadow-lg">
      <div className="mb-1 font-semibold text-text">{fmtPrice(label ?? 0)} / share</div>
      <div className="flex justify-between gap-4 text-text-2">
        <span>Buyers ≥ price</span>
        <span className="font-semibold text-bid">{fmtShares(demand)}</span>
      </div>
      <div className="flex justify-between gap-4 text-text-2">
        <span>Sellers ≤ price</span>
        <span className="font-semibold text-ask">{fmtShares(supply)}</span>
      </div>
      <div className="mt-1 flex justify-between gap-4 border-t border-line pt-1 text-text-2">
        <span>Would trade</span>
        <span className="font-semibold text-text">{fmtShares(Math.min(demand, supply))}</span>
      </div>
    </div>
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

  return (
    <div style={{ height }} aria-label="Cumulative demand and supply by price">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 16, right: 28, bottom: 4, left: 4 }}>
          <CartesianGrid stroke="var(--grid)" strokeDasharray="3 4" vertical={false} />
          <XAxis
            dataKey="price"
            type="number"
            domain={domain}
            tickFormatter={(v: number) => fmtPrice(v)}
            tick={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace" }}
            stroke="var(--line)"
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => fmtShares(v)}
            tick={{ fill: "var(--muted)", fontSize: 11, fontFamily: "var(--font-geist-mono), monospace" }}
            stroke="var(--line)"
            tickLine={false}
            width={48}
          />
          <Tooltip content={<Readout />} cursor={{ stroke: "var(--muted)", strokeWidth: 1 }} />

          <Area
            type="stepAfter"
            dataKey="demand"
            stroke="var(--bid)"
            strokeWidth={2.5}
            fill="var(--bid)"
            fillOpacity={0.1}
            isAnimationActive={!reduced}
            animationDuration={700}
            dot={false}
            name="Buyers at or above"
          />
          <Area
            type="stepBefore"
            dataKey="supply"
            stroke="var(--ask)"
            strokeWidth={2.5}
            fill="var(--ask)"
            fillOpacity={0.1}
            isAnimationActive={!reduced}
            animationDuration={700}
            dot={false}
            name="Sellers at or below"
          />

          {indicative && indicative.volume > 0 && (
            <>
              <ReferenceLine
                x={indicative.price}
                stroke="var(--text)"
                strokeDasharray="2 3"
                label={{
                  value: `cross ${fmtPrice(indicative.price)}`,
                  position: "top",
                  fill: "var(--text)",
                  fontSize: 12,
                  fontFamily: "var(--font-geist-mono), monospace",
                }}
              />
              <ReferenceDot x={indicative.price} y={indicative.volume} r={5} fill="var(--text)" stroke="none" />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
