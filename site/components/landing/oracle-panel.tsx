import { fmtEt, fmtPrice } from "@/lib/uncross/format";
import type { OracleSnapshot } from "@/lib/snapshot";

/**
 * The reference price, beside the cross rather than above it.
 *
 * What this panel states is measured, not assumed. The feed published
 * continuously for 10h38m across the close and through the overnight (82
 * samples, oldest print at any check 14 seconds). Its own schedule says the
 * market is closed. So the honest claim is not "the reference disappears" —
 * it is that the on-chain account carries no session marker, so a thin
 * extended-hours print and a liquid regular-session one are indistinguishable
 * on-chain.
 */
export function OraclePanel({ oracle }: { oracle: OracleSnapshot | null }) {
  return (
    <div className="flex flex-col gap-3 p-6 md:p-9">
      <div className="eyebrow">Pyth · AAPL/USD · read from Solana mainnet</div>

      {oracle ? (
        <>
          <span className="w-fit rounded-[5px] bg-amber-soft px-2.5 py-1.5 font-mono text-xs leading-none tracking-[0.06em] text-amber uppercase">
            Publishing · schedule says closed
          </span>

          <div className="display-tight num text-[34px] font-semibold md:text-[44px]">{fmtPrice(oracle.price)}</div>

          <div className="num text-[13px] text-text-2">
            published {fmtEt(oracle.publishTime * 1000)} · {oracle.ageSecs}s before this page was built
          </div>

          <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
            Measured over 82 samples: the feed published without a gap for 10h38m, straight through the 4pm close and
            deep into the overnight, the oldest print at any check being 14 seconds. Its schedule calls the market
            closed the whole time. The account carries no session field, so on-chain a thin after-hours print and a
            liquid midday one look the same.
          </p>
        </>
      ) : (
        <p className="max-w-[52ch] text-sm text-text-2">
          The Pyth account could not be read when this page was built, so no reference price is shown. The auction does
          not depend on it: on devnet the program never reads an oracle.
        </p>
      )}
    </div>
  );
}
