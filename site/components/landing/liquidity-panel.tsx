// What a reference price costs to actually trade.
//
// This is the strongest evidence on the page, and unlike the cross price it is
// not circular: these are live mainnet reads of somebody else's pools, with no
// bot of ours involved. Captured once and committed, stamped with its capture
// time, because a landing page should not hammer a quote API on every view.
//
// Wording discipline: Jupiter returning NO_ROUTES_FOUND means the dominant
// aggregator declined to route at 50bps slippage. It does not prove no pool
// exists — DexScreener shows pools for IBMx and JPMx — so the page says "no
// route", never "impossible to trade".

import capture from "@/lib/liquidity-capture.json";
import { Container } from "@/components/container";
import { SectionHead } from "./sections";

interface Quote {
  sizeUsd: number;
  priceImpactPct: string | null;
  effectivePrice: number | null;
  ok: boolean;
  error: string | null;
}

interface TickerLiquidity {
  symbol: string;
  tvlUsd: number | null;
  volume24hUsd: number | null;
  jupiterRefPriceUsd: number | null;
  quotes: Quote[];
}

const SIZES = [100, 1000, 10000];

const usd0 = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const usd2 = (n: number | null) =>
  n == null ? "—" : n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (raw: string | null) => (raw == null ? null : Number(raw) * 100);

/** Impact shades from quiet to loud; no route is the loudest state of all. */
function ImpactCell({ q }: { q: Quote | undefined }) {
  if (!q) return <td className="num border-t border-line px-4 py-3 text-muted">—</td>;
  if (!q.ok) {
    return (
      <td className="num border-t border-line bg-amber-soft px-4 py-3 font-semibold text-amber">no route</td>
    );
  }
  const p = pct(q.priceImpactPct);
  const loud = p != null && p >= 1;
  return (
    <td className={`num border-t border-line px-4 py-3 ${loud ? "font-semibold text-ask" : "text-text-2"}`}>
      {p == null ? "—" : `${p.toFixed(2)}%`}
    </td>
  );
}

export function LiquidityPanel() {
  const tickers = capture.tickers as TickerLiquidity[];
  const capturedAt = new Date(capture.capturedAt as string);

  return (
    <Container as="section" id="liquidity" className="py-14 md:py-22">
      <SectionHead
        eyebrow="Measured on mainnet"
        title="The reference price is free. Trading at it is not."
        lede="A live buy quote against the real mainnet pools for five xStocks, at three sizes. The venue runs on devnet; these reads are mainnet, and they are of other people's liquidity, not ours."
      />

      <div className="mt-10 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr>
              {["Ticker", "Pool TVL", "24h volume", "Reference price", ...SIZES.map((s) => `Buy ${usd0(s)}`)].map((h) => (
                <th
                  key={h}
                  className="num border-b border-line px-4 py-3 text-left text-[11.5px] tracking-[0.06em] text-muted uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tickers.map((t) => (
              <tr key={t.symbol}>
                <th scope="row" className="border-t border-line px-4 py-3 text-left font-semibold">
                  {t.symbol}
                </th>
                <td className="num border-t border-line px-4 py-3 text-text-2">{usd0(t.tvlUsd)}</td>
                <td className="num border-t border-line px-4 py-3 text-text-2">{usd0(t.volume24hUsd)}</td>
                <td className="num border-t border-line px-4 py-3">{usd2(t.jupiterRefPriceUsd)}</td>
                {SIZES.map((s) => (
                  <ImpactCell key={s} q={t.quotes.find((q) => q.sizeUsd === s)} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <p className="max-w-[62ch] text-[14.5px] text-text-2">
          <strong className="font-semibold text-text">IBMx has a price and no route.</strong> Jupiter publishes
          $247.14 for it and a pool holds $1,666, but the router declines every size tried, down to $1. JPMx fills
          $100 and refuses $1,000. XOMx fills $1,000 and refuses $10,000. The names that do absorb $10,000 cheaply —
          NVDAx at 0.24% — are exactly the ones that never needed an auction.
        </p>
        <p className="max-w-[62ch] text-[12.5px] text-muted">
          Quotes from Jupiter&apos;s aggregator at 50bps slippage, buying with USDC; pool figures from DexScreener.
          &quot;No route&quot; means the aggregator would not route that size, not that the token cannot be traded by
          any means — a direct pool swap might still fill, at a worse price. Captured{" "}
          <span className="num">
            {capturedAt.toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}{" "}
            ET
          </span>
          , while the US equity market was closed. This is a single capture, not a running feed.
        </p>
      </div>
    </Container>
  );
}
