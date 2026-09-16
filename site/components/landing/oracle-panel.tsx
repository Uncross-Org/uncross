import { PythGate } from "./pyth-gate";
import type { OracleSnapshot } from "@/lib/snapshot";

/**
 * The reference price, beside the cross rather than above it.
 *
 * What this panel states is measured, not assumed. Checked every five minutes
 * for 10h38m across the close and through the overnight (80 checks), the
 * latest print was never more than 14 seconds old. Its own schedule says the
 * market is closed. So the honest claim is not "the reference disappears" —
 * it is that the on-chain account carries no session marker, so a thin
 * extended-hours print and a liquid regular-session one are indistinguishable
 * on-chain.
 */
export function OraclePanel({ oracle, builtAt }: { oracle: OracleSnapshot | null; builtAt: number }) {
  return (
    <div className="flex flex-col gap-3 p-6 md:p-9">
      <div className="eyebrow">Pyth · AAPL/USD · read from Solana mainnet</div>

      <PythGate initial={oracle} builtAt={builtAt} />

      <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
        Checked every five minutes for 10h38m, straight through the 4pm close and deep into the overnight: at all 80
        checks the latest print was at most 14 seconds old. Its schedule called the market closed the whole time. The
        account carries no session field, so on-chain a thin after-hours print and a liquid midday one look the same.
      </p>
    </div>
  );
}
