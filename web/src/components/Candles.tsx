// Price history as candles, exactly one per auction that traded.
//
// Each candle is built from clearing prices and nothing else:
//   open  — the previous traded auction's clearing price (its own, for the first)
//   close — this auction's clearing price
//   high, low — the higher and lower of those two
//   volume — the shares that crossed
// A limit price is only what one order would accept; it never traded, so it
// has no place on a price chart. A single sell placed at $1 used to become a
// candle's low and drag the whole axis below zero. Auctions that did not trade
// draw nothing; nothing is interpolated or backfilled. Times are estimated from
// the slot clock (slots have no timestamps on the account), and the caption
// says so.

import { createChart, CandlestickSeries, CrosshairMode, HistogramSeries, type AutoscaleInfo, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Auction } from "../lib/auction";
import { fmtInt } from "../lib/format";
import { programToPerShare, rawToShares } from "../lib/units";

interface Props {
  auctions: Auction[];
  m: number;
  slot: number | null;
  slotMs: number;
  now: number;
  /** Only used to rebuild the chart when the theme flips. */
  theme: string;
}

interface Candle {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  orders: number;
  slot: number;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/** A token's hex colour at an alpha, for the canvas, which may not parse color-mix(). */
const alpha = (hex: string, a: number) => {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};

export function candlesFrom(auctions: Auction[], m: number, slot: number | null, slotMs: number, now: number): Candle[] {
  if (slot == null) return [];
  let prev: number | null = null;
  return auctions
    .filter((a) => a.status !== "open" && a.executableVolume > 0n && a.clearingPrice > 0n)
    .sort((x, y) => x.closeSlot - y.closeSlot)
    .map((a) => {
      const close = programToPerShare(a.clearingPrice, m);
      const open = prev ?? close;
      prev = close;
      const closedMs = now - (slot - a.closeSlot) * slotMs;
      return {
        time: Math.floor(closedMs / 1000) as UTCTimestamp,
        open,
        high: Math.max(open, close),
        low: Math.min(open, close),
        close,
        volume: rawToShares(a.executableVolume, m),
        orders: a.orderCount,
        slot: a.closeSlot,
      };
    })
    // Two auctions cannot close in the same second; if the estimate collides, nudge.
    .map((c, i, arr) => (i > 0 && c.time <= arr[i - 1].time ? { ...c, time: (arr[i - 1].time + 1) as UTCTimestamp } : c));
}

/**
 * The price axis: the visible candles' range with some air, never below zero.
 * The padding is done here rather than with scale margins, because a margin
 * is drawn below the lowest price whatever that price is.
 */
const priceAxis = (original: () => AutoscaleInfo | null): AutoscaleInfo | null => {
  const r = original();
  if (!r?.priceRange) return r;
  const { minValue, maxValue } = r.priceRange;
  const pad = Math.max(maxValue - minValue, maxValue * 0.004, 0.01) * 0.15;
  return { priceRange: { minValue: Math.max(0, minValue - pad), maxValue: maxValue + pad }, margins: { above: 0, below: 0 } };
};

const RANGES = [
  ["6", 6],
  ["12", 12],
  ["24", 24],
  ["all", Infinity],
] as const;

export function Candles({ auctions, m, slot, slotMs, now, theme }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [range, setRange] = useState<number>(24);
  const [hover, setHover] = useState<Candle | null>(null);
  // The slot clock ticks every second; rebuilding candles on every tick would
  // shift every estimated time. Anchor on the auctions themselves.
  const key = auctions.map((a) => `${a.address.toBase58()}:${a.status}`).join("|");
  const candles = useMemo(() => candlesFrom(auctions, m, slot, slotMs, now), [key, m, slot != null]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = box.current;
    if (!el || candles.length === 0) return;
    const text = css("--muted");
    const line = css("--border");
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { color: "transparent" },
        textColor: text,
        fontFamily: "Geist Mono, ui-monospace, monospace",
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: line, enableResize: false },
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0, bottom: 0 } },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false, rightOffset: 2 },
      crosshair: { mode: CrosshairMode.Normal },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: css("--up"),
      downColor: css("--down"),
      borderUpColor: css("--up"),
      borderDownColor: css("--down"),
      wickUpColor: css("--up"),
      wickDownColor: css("--down"),
      // Dollars on this series' axis only: a chart-wide formatter put "$" on the share volumes too.
      priceFormat: { type: "custom", minMove: 0.01, formatter: (p: number) => `$${p.toFixed(2)}` },
      autoscaleInfoProvider: priceAxis,
    });
    series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    // Volume in its own pane below, so it never shares (or squeezes) the price axis.
    const vol = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: "custom", minMove: 0.01, formatter: (v: number) => (v >= 100 ? v.toFixed(0) : v.toFixed(2)) },
        color: text,
        lastValueVisible: false,
        priceLineVisible: false,
      },
      1,
    );
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0 }, borderColor: line });
    chart.panes()[0]?.setStretchFactor(3);
    chart.panes()[1]?.setStretchFactor(1);
    vol.setData(
      candles.map((c) => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? alpha(css("--up"), 0.45) : alpha(css("--down"), 0.45),
      })),
    );
    chart.subscribeCrosshairMove((p) => {
      if (!p.time) return setHover(null);
      setHover(candles.find((c) => c.time === p.time) ?? null);
    });
    chartRef.current = chart;
    seriesRef.current = series;
    volRef.current = vol;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
    };
  }, [candles]);

  // A theme switch recolours the chart in place rather than rebuilding it: a
  // rebuild lost the zoom and squashed every candle to the right edge. The read
  // waits a frame because this component's effects run before App's, which is
  // where data-theme is set — read immediately, it picked up the previous
  // theme's colours and drew a light grid on a dark background.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const chart = chartRef.current, series = seriesRef.current, vol = volRef.current;
      if (!chart || !series || !vol) return;
      const text = css("--muted"), line = css("--border"), up = css("--up"), down = css("--down");
      chart.applyOptions({
        layout: { textColor: text, panes: { separatorColor: line } },
        grid: { vertLines: { color: line }, horzLines: { color: line } },
        rightPriceScale: { borderColor: line },
        timeScale: { borderColor: line },
      });
      series.applyOptions({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
      vol.applyOptions({ color: text });
      vol.priceScale().applyOptions({ borderColor: line });
      vol.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? alpha(up, 0.45) : alpha(down, 0.45) })));
    });
    return () => cancelAnimationFrame(id);
  }, [theme]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || candles.length === 0) return;
    if (range === Infinity) chart.timeScale().fitContent();
    else chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, candles.length - range) - 0.5, to: candles.length + 0.5 });
  }, [range, candles]);

  const shown = hover ?? candles[candles.length - 1] ?? null;

  return (
    <div className="candles">
      <div className="candles-head">
        <div className="num candles-ohlc">
          {shown ? (
            <>
              <span>
                O <b>${shown.open.toFixed(2)}</b>
              </span>
              <span>
                H <b>${shown.high.toFixed(2)}</b>
              </span>
              <span>
                L <b>${shown.low.toFixed(2)}</b>
              </span>
              <span>
                C <b>${shown.close.toFixed(2)}</b>
              </span>
              <span>
                traded <b>{shown.volume.toFixed(2)} shares</b>
              </span>
              <span className="muted">
                {shown.orders} orders · slot {fmtInt(shown.slot)}
              </span>
            </>
          ) : (
            <span className="muted">no traded auction yet</span>
          )}
        </div>
        <div className="seg seg-sm" role="group" aria-label="Range">
          {RANGES.map(([label, n]) => (
            <button key={label} className={range === n ? "on" : ""} onClick={() => setRange(n)} aria-pressed={range === n}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {candles.length === 0 ? (
        <div className="empty candles-empty">
          {slot == null ? "Reading the slot clock…" : "No auction for this ticker has traded yet, so there is nothing to draw."}
        </div>
      ) : (
        <div ref={box} className="candles-box" aria-label="One candle per auction" />
      )}
      <p className="candles-cap muted">
        One candle per auction that traded, from clearing prices only. Close: that auction&apos;s clearing price. Open: the
        previous auction&apos;s. Volume: shares crossed. Times are estimated from the slot clock.
      </p>
    </div>
  );
}
