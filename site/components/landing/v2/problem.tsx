// The problem: the IBMx number at display size, the loudest thing between the
// hero and the mechanism. The section sits on a tinted surface rather than an
// inverted one — with a light hero above it, a dark slab from here through the
// liquidity table read as a second theme starting, not as emphasis. What sets
// it apart now is layout: the figure at full width, a ledger of buy sizes
// beside it.
//
// Every figure carries its date. The section first said, in the present tense,
// that Jupiter would not route IBMx at any size. That was true on 16 Sept and
// false a week later, when it routed every size at up to 84% price impact. Both
// readings stand, dated, because the swing between them is the stronger
// evidence: a quote on a pool this thin says little about the next trade.

import capture from "@/lib/liquidity-capture.json";
import today from "@/lib/liquidity-today.json";
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
  if (!q) return <td className="num px-4 py-3 text-muted">—</td>;
  if (!q.ok)
    return (
      <td className="num px-4 py-3">
        <span className="rounded-md bg-ask/10 px-2 py-0.5 font-semibold text-ask">no route</span>
      </td>
    );
  const p = Number(q.priceImpactPct) * 100;
  return <td className={`num px-4 py-3 ${p >= 1 ? "font-semibold text-ask" : "text-text"}`}>{p.toFixed(2)}%</td>;
}

const fmtUtc = (iso: string) => {
  const d = new Date(iso);
  // "Sept", to match how every other date on this page is written.
  const month = d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }).replace(/^Sep$/, "Sept");
  return `${d.getUTCDate()} ${month}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`;
};
const pct = (q?: { ok: boolean; priceImpactPct: string | null }) =>
  q?.ok && q.priceImpactPct != null ? `${(Number(q.priceImpactPct) * 100).toFixed(2)}%` : "no route";

export function ProblemV2() {
  // The table shows the latest dated reading; the 16 Sept capture stays as
  // history, in the IBMx ledger and the footnote.
  const rows = today.tickers.map((t) => ({
    symbol: t.symbol,
    tvlUsd: t.tvlUsd,
    volume24hUsd: t.volume24hUsd,
    jupiterRefPriceUsd: t.jupiterPriceUsd,
    quotes: t.quotes,
  })) as Row[];
  const readAt = fmtUtc(today.measuredAt);
  const ibmThen = capture.tickers.find((t) => t.symbol === "IBMx")!;
  const ibmNow = today.tickers.find((t) => t.symbol === "IBMx")!;
  const captured = new Date(capture.capturedAt as string).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <section id="problem" className="relative border-y border-line bg-raise">
      {/* A faint accent field behind the figure, so the tint reads as chosen. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_55%_at_18%_30%,var(--accent-soft),transparent_70%)]"
      />
      <Container className="relative py-20 md:py-28">
        <Reveal className="grid items-end gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className="eyebrow">Measured on mainnet · {captured} ET</div>
            <div className="display-tight num mt-4 text-[96px] leading-[0.9] font-semibold text-text md:text-[168px]">
              <span className="align-[0.7em] text-[0.4em] tracking-normal text-muted">$</span>
              {/* Static on purpose: a counting animation shows wrong values on
                  the way up, and this is the one figure that must never read
                  wrong, even in a screenshot. */}
              247.14
            </div>
            <p className="mt-4 max-w-[30ch] text-[22px] leading-snug font-medium text-text md:text-[28px]">
              On 16 Sept Jupiter published this price for IBMx, and would not route a buy at any size.
            </p>
          </div>
          <div>
            {/* Two dated readings, same sizes: the swing is the point. */}
            <div className="grid grid-cols-[1fr_6.5rem_8.5rem] items-baseline gap-x-4 border-b border-line pb-3">
              <span className="eyebrow">Buy IBMx</span>
              <span className="eyebrow text-right">16 Sept</span>
              <span className="eyebrow text-right">{readAt}</span>
            </div>
            {[10000, 1000, 100, 1].map((size) => (
              <div key={size} className="grid grid-cols-[1fr_6.5rem_8.5rem] items-baseline gap-x-4 border-b border-line py-3.5">
                <span className="num text-[16px] text-text-2">Buy {usd0(size)}</span>
                <span className="num text-right text-[16px] font-semibold text-ask">{pct(ibmThen.quotes.find((q) => q.sizeUsd === size))}</span>
                <span className="num text-right text-[16px] font-semibold text-ask">{pct(ibmNow.quotes.find((q) => q.sizeUsd === size))}</span>
              </div>
            ))}
            <p className="mt-4 text-[13.5px] leading-relaxed text-muted">
              A week later Jupiter routes every size — and reports {pct(ibmNow.quotes.find((q) => q.sizeUsd === 10000))} price impact on a
              $10,000 buy, against pools holding {usd0(ibmNow.tvlUsd)}. On 23 Sept the IBMx price itself moved from $201.54 at 06:57 UTC
              to {usd2(ibmNow.jupiterPriceUsd)} at {readAt.split(", ")[1]}. The quote you can see is not the price you can trade at.
            </p>
          </div>
        </Reveal>

        <Reveal className="mt-16">
          <h2 className="display max-w-[24ch] text-[30px] leading-[1.05] font-semibold text-text md:text-[40px]">
            A price you can see is not a price you can trade.
          </h2>
          <p className="mt-3 max-w-[64ch] text-[16px] text-text-2 md:text-[17px]">
            Buy quotes against the real mainnet pools for five xStocks, at three sizes, read {readAt}. The venue runs on
            devnet; these reads are mainnet, and they are of other people&apos;s liquidity, not ours.
          </p>
          <div className="mt-8 overflow-x-auto rounded-2xl border border-line bg-surface shadow-[0_12px_40px_-24px_rgba(11,14,20,0.25)]">
            <table className="w-full min-w-[640px] text-[14px]">
              <thead>
                <tr className="text-left">
                  {["Ticker", "Pool TVL", "24h volume", "Reference", ...SIZES.map((s) => `Buy ${usd0(s)}`)].map((h) => (
                    <th key={h} className="num border-b border-line px-4 py-3 text-[11px] font-medium tracking-[0.08em] text-muted uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol} className={`border-b border-line last:border-b-0 ${r.symbol === "IBMx" ? "bg-accent-soft/60" : ""}`}>
                    <th scope="row" className="px-4 py-3 text-left font-semibold text-text">
                      {r.symbol}
                    </th>
                    <td className="num px-4 py-3 text-muted">{usd0(r.tvlUsd)}</td>
                    <td className="num px-4 py-3 text-muted">{usd0(r.volume24hUsd)}</td>
                    <td className="num px-4 py-3 text-text">{usd2(r.jupiterRefPriceUsd)}</td>
                    {SIZES.map((s) => (
                      <Impact key={s} q={r.quotes.find((q) => q.sizeUsd === s)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 max-w-[70ch] text-[13px] text-muted">
            On 16 Sept the same read found IBMx unroutable at every size, JPMx at $1,000 and $10,000, and XOMx at
            $10,000. Quotes from Jupiter&apos;s aggregator at 50 bps slippage, buying with USDC; pool figures from
            DexScreener. Dated readings, not a running feed. There is no Pyth price account for IBM on Solana at all.
          </p>
        </Reveal>
      </Container>
    </section>
  );
}
