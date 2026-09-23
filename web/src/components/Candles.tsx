// Price history as candles, exactly one per auction that traded.
//
// Each candle is built from that auction's own orders and nothing else:
//   open  — the limit price of the first order placed in it
//   high  — the highest limit among its orders
//   low   — the lowest limit among its orders
//   close — the clearing price
//   volume — the shares that crossed
// Auctions that did not trade draw nothing; nothing is interpolated or
// backfilled. Times are estimated from the slot clock (slots have no
// timestamps on the account), and the caption says so.

import { createChart, CandlestickSeries, CrosshairMode, HistogramSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
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
  return auctions
    .filter((a) => a.status !== "open" && a.executableVolume > 0n)
    .map((a) => {
      const placed = a.orders.filter((o) => !o.cancelled);
      const limits = placed.map((o) => programToPerShare(o.limitPrice, m));
      const close = programToPerShare(a.clearingPrice, m);
      const open = limits.length ? limits[0] : close;
      const closedMs = now - (slot - a.closeSlot) * slotMs;
      return {
        time: Math.floor(closedMs / 1000) as UTCTimestamp,
        open,
        high: Math.max(close, ...limits),
        low: Math.min(close, ...limits),
        close,
        volume: rawToShares(a.executableVolume, m),
        orders: a.orderCount,
        slot: a.closeSlot,
      };
    })
    .sort((x, y) => x.time - y.time)
    // Two auctions cannot close in the same second; if the estimate collides, nudge.
    .map((c, i, arr) => (i > 0 && c.time <= arr[i - 1].time ? { ...c, time: (arr[i - 1].time + 1) as UTCTimestamp } : c));
}

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
      },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line, scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: line, timeVisible: true, secondsVisible: false, rightOffset: 2 },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: (p: number) => `$${p.toFixed(2)}` },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: css("--up"),
      downColor: css("--down"),
      borderUpColor: css("--up"),
      borderDownColor: css("--down"),
      wickUpColor: css("--up"),
      wickDownColor: css("--down"),
      priceFormat: { type: "price", precision: 2, minMove: 0.01 },
    });
    series.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
    const vol = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: text,
    });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
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
        layout: { textColor: text },
        grid: { vertLines: { color: line }, horzLines: { color: line } },
        rightPriceScale: { borderColor: line },
        timeScale: { borderColor: line },
      });
      series.applyOptions({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
      vol.applyOptions({ color: text });
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
                vol <b>{shown.volume.toFixed(2)} sh</b>
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
        One candle per auction that traded. Open: the first order&apos;s limit. High and low: the highest and lowest limits
        placed. Close: the clearing price. Volume: shares crossed. Times are estimated from the slot clock.
      </p>
    </div>
  );
}
