// The problem, as a full-bleed dark band: the one section on the page that
// inverts, so the IBMx number lands as the loudest thing between the hero and
// the mechanism. Content is unchanged from the previous page — the live
// mainnet capture, worded as "no route", never "impossible to trade".

import capture from "@/lib/liquidity-capture.json";
import { Container } from "@/components/container";
import { Reveal } from "@/components/landing/motion";

interface Quote {
  sizeUsd: number;
  priceImpactPct: string | null;
  ok: boolean;
}
interface Row {
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

function Impact({ q }: { q?: Quote }) {
  if (!q) return <td className="num px-4 py-3 text-ink-muted">—</td>;
  if (!q.ok)
    return (
      <td className="num px-4 py-3">
        <span className="rounded-md bg-ask/15 px-2 py-0.5 font-semibold text-[#ff8a5b]">no route</span>
      </td>
    );
  const p = Number(q.priceImpactPct) * 100;
  return <td className={`num px-4 py-3 ${p >= 1 ? "font-semibold text-[#ff8a5b]" : "text-ink-text"}`}>{p.toFixed(2)}%</td>;
}

export function ProblemV2() {
  const rows = capture.tickers as Row[];
  const captured = new Date(capture.capturedAt as string).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <section id="problem" className="border-y border-ink-line bg-ink text-ink-text">
      <Container className="py-20 md:py-28">
        <Reveal className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="eyebrow text-ink-muted">Measured on mainnet · {captured} ET</div>
            <div className="display-tight num mt-4 text-[96px] leading-[0.9] font-semibold md:text-[168px]">
              <span className="align-[0.7em] text-[0.4em] tracking-normal text-ink-muted">$</span>
              {/* Static on purpose: a counting animation shows wrong values on
                  the way up, and this is the one figure that must never read
                  wrong, even in a screenshot. */}
              247.14
            </div>
            <p className="mt-4 max-w-[30ch] text-[22px] leading-snug font-medium md:text-[28px]">
              Jupiter publishes this price for IBMx. Ask it to buy, and it finds no route.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ["$10,000", "no route"],
              ["$100", "no route"],
              ["$1", "no route"],
            ].map(([size, r]) => (
              <div key={size} className="flex items-baseline justify-between rounded-xl border border-ink-line px-5 py-4">
                <span className="num text-[15px] text-ink-muted">Buy {size}</span>
                <span className="num text-[17px] font-semibold text-[#ff8a5b]">{r}</span>
              </div>
            ))}
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">
              A pool holding $1,666 sits behind that price. "No route" is Jupiter's router declining to route the
              trade at 50 bps slippage — a direct pool swap might fill, at a worse price.
            </p>
          </div>
        </Reveal>

        <Reveal className="mt-16">
          <h2 className="display max-w-[24ch] text-[30px] leading-[1.05] font-semibold md:text-[40px]">
            A price you can see is not a price you can trade.
          </h2>
          <p className="mt-3 max-w-[64ch] text-[16px] text-ink-muted md:text-[17px]">
            A live buy quote against the real mainnet pools for five xStocks, at three sizes. The venue runs on devnet;
            these reads are mainnet, and they are of other people&apos;s liquidity, not ours.
          </p>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-ink-line bg-white/[0.03]">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead>
                <tr className="text-left">
                  {["Ticker", "Pool TVL", "24h volume", "Reference", ...SIZES.map((s) => `Buy ${usd0(s)}`)].map((h) => (
                    <th key={h} className="num border-b border-ink-line px-4 py-3 text-[11px] font-medium tracking-[0.08em] text-ink-muted uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} className={`border-b border-ink-line last:border-b-0 ${r.symbol === "IBMx" ? "bg-white/[0.04]" : ""}`}>
                    <th scope="row" className="px-4 py-3 text-left font-semibold">
                      {r.symbol}
                    </th>
                    <td className="num px-4 py-3 text-ink-muted">{usd0(r.tvlUsd)}</td>
                    <td className="num px-4 py-3 text-ink-muted">{usd0(r.volume24hUsd)}</td>
                    <td className="num px-4 py-3">{usd2(r.jupiterRefPriceUsd)}</td>
                    {SIZES.map((s) => (
                      <Impact key={s} q={r.quotes.find((q) => q.sizeUsd === s)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[70ch] text-[13px] text-ink-muted">
            Quotes from Jupiter&apos;s aggregator at 50 bps slippage, buying with USDC; pool figures from DexScreener.
            A single capture, not a running feed. There is no Pyth price account for IBM on Solana at all.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
