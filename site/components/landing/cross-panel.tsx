import { explorerTx } from "@/lib/uncross/config";
import { fmtEt, fmtEtDay, fmtPrice, fmtShares } from "@/lib/uncross/format";
import type { Cross } from "@/lib/snapshot";

/**
 * The largest element on the page: the price every order in one auction filled
 * at, with the timestamp that dates it.
 *
 * The disclosure below the number is not optional and does not move into a
 * footnote. Devnet orders come from our own test bot, which prices them around
 * Pyth. A cross that lands near Pyth therefore shows the bot following its
 * instructions, not the auction discovering a price. The number is real; what
 * it proves is narrow, and the page says so next to it.
 */
export function CrossPanel({ cross }: { cross: Cross | null }) {
  if (!cross) {
    return (
      <div className="flex flex-col gap-3 border-b border-line p-6 md:border-r md:border-b-0 md:p-9">
        <div className="eyebrow">Last cross</div>
        <p className="max-w-[46ch] text-sm text-text-2">
          No cross could be read from devnet when this page was built. The live section below reads the chain directly
          in your browser.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 border-b border-line p-6 md:border-r md:border-b-0 md:p-9">
      <div className="eyebrow flex items-center gap-2.5">
        <span className="size-2 bg-text" aria-hidden="true" />
        {cross.ticker} · every order filled at
      </div>

      <div className="display-tight num text-[68px] leading-[0.95] font-semibold md:text-[120px]">
        <span className="align-[0.9em] text-[0.42em] tracking-normal text-text-2">$</span>
        {cross.price.toFixed(2)}
      </div>

      <div className="num text-[13px] leading-relaxed text-text-2 md:text-sm">
        {fmtShares(cross.shares)} shares · {cross.orders} orders
        {cross.at && (
          <>
            {" · "}
            {fmtEt(cross.at * 1000)}, {fmtEtDay(cross.at * 1000)}
          </>
        )}
        {cross.signature && (
          <>
            {" · "}
            <a
              className="text-bid underline-offset-2 hover:underline"
              href={explorerTx(cross.signature)}
              target="_blank"
              rel="noreferrer"
            >
              view transaction ↗
            </a>
          </>
        )}
      </div>

      <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
        <strong className="font-semibold text-text-2">
          Devnet orders are placed by our test bot, which prices them around Pyth.
        </strong>{" "}
        So this price shows the auction mechanism settling a book, not independent price discovery — the proximity to
        any reference price is circular. Pyth never set this price: on devnet its feed is stale, so the program's gate rejects it.
      </p>
    </div>
  );
}

/** One row of the recent-crosses list. */
export function CrossRow({ cross }: { cross: Cross }) {
  return (
    <div className="num grid grid-cols-[auto_1fr_auto] items-baseline gap-3 border-t border-line px-4 py-3 text-[13px] md:px-5">
      <span className="text-muted">{cross.at ? fmtEt(cross.at * 1000) : "—"}</span>
      <span>
        {fmtPrice(cross.price)} × {fmtShares(cross.shares)}
      </span>
      {cross.signature ? (
        <a className="text-bid underline-offset-2 hover:underline" href={explorerTx(cross.signature)} target="_blank" rel="noreferrer">
          tx ↗
        </a>
      ) : (
        <span className="text-muted">—</span>
      )}
    </div>
  );
}
