"use client";

// Live devnet data, read in the browser: the current book, what it would clear
// at right now, and the crosses already settled. No wallet needed to watch.

import { Container } from "@/components/container";
import { explorerAddr } from "@/lib/uncross/config";
import { fmtEt, fmtPrice, fmtShares } from "@/lib/uncross/format";
import { programToPerShare, rawToShares } from "@/lib/uncross/units";
import { useVenue } from "@/lib/use-venue";
import { DepthCurves } from "./depth-curves";
import { SectionHead } from "./sections";

const PHASE_LABEL: Record<string, string> = {
  upcoming: "Opening",
  open: "Taking orders",
  freeze: "Frozen — no more cancelling",
  "awaiting-cross": "Awaiting the cross",
  cleared: "Cleared",
  settled: "Settled",
};

/** Hero-sized curves: the live book, drawn as it fills. */
export function LiveCurves() {
  const { book, indicative, loading, phase } = useVenue("AAPLx");

  return (
    <div className="flex flex-col gap-3">
      <div className="eyebrow flex flex-wrap items-center justify-between gap-2">
        <span>AAPLx · current book</span>
        {phase && <span className={phase === "freeze" ? "text-amber" : "text-muted"}>{PHASE_LABEL[phase] ?? phase}</span>}
      </div>
      <DepthCurves book={book} indicative={indicative} loading={loading} height={220} />
    </div>
  );
}

export function LiveSection() {
  const { book, indicative, traded, loading, error, phase, current, slot, readAt, stale } = useVenue("AAPLx");

  // Slots remaining until the cross, at devnet's ~400ms slot time.
  const slotsLeft = current && slot != null ? Math.max(0, current.closeSlot - slot) : null;
  const secsLeft = slotsLeft == null ? null : Math.round((slotsLeft * 400) / 1000);

  return (
    <Container as="section" id="live" className="py-14 md:py-22">
      <SectionHead
        eyebrow="Live · no wallet needed"
        title="The auction running right now."
        lede="Real devnet transactions, every one clickable. This is the same data the app uses."
      />

      {/* When the devnet RPC rate-limits us, the page says how old its numbers
          are rather than showing nothing or passing them off as current. */}
      {stale && (
        <p className="mt-6 max-w-[68ch] rounded-lg border border-line bg-amber-soft px-4 py-3 text-sm text-text-2">
          <strong className="font-semibold text-amber">Showing the last good read.</strong> The public devnet RPC is
          rate-limiting this query, so these figures are from{" "}
          {readAt ? <span className="num">{fmtEt(readAt)}</span> : "an earlier read"} rather than this moment.
        </p>
      )}
      {!stale && error && (
        <p className="mt-6 max-w-[68ch] rounded-lg border border-line bg-raise px-4 py-3 text-sm text-text-2">
          Could not read devnet just now ({error}).
        </p>
      )}

      <div className="mt-10 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="eyebrow mb-3 flex flex-wrap items-center justify-between gap-2">
            <span>Cumulative demand and supply</span>
            {indicative && (
              <span className="num text-text normal-case">
                would clear at {fmtPrice(indicative.price)} · {fmtShares(indicative.volume)} sh
              </span>
            )}
          </div>
          <DepthCurves book={book} indicative={indicative} loading={loading} height={280} />
          <p className="mt-3 max-w-[62ch] text-[12.5px] text-muted">
            Each step is one order placed by a devnet wallet. The curves cross where the most shares can change hands —
            that price is what everyone in this auction will pay or receive.
          </p>
        </div>

        <div className="flex flex-col rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between px-5 pt-4 pb-2.5">
            <span className="eyebrow">Recent crosses · AAPLx</span>
          </div>

          {traded.length === 0 ? (
            <p className="px-5 pb-4 text-sm text-text-2">
              {loading ? "Reading settled auctions…" : "No settled auctions read yet."}
            </p>
          ) : (
            traded.slice(0, 5).map((a) => (
              <div
                key={a.address.toBase58()}
                className="num grid grid-cols-[1fr_auto] items-baseline gap-3 border-t border-line px-5 py-3 text-[13px]"
              >
                <span>
                  {fmtPrice(programToPerShare(a.clearingPrice, 1))} × {fmtShares(rawToShares(a.executableVolume, 1))}
                </span>
                <a
                  className="text-bid underline-offset-2 hover:underline"
                  href={explorerAddr(a.address.toBase58())}
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.orderCount} orders ↗
                </a>
              </div>
            ))
          )}

          <div className="mt-auto flex flex-col gap-2 border-t border-line p-5">
            <div className="eyebrow flex items-center justify-between gap-2">
              <span>{phase === "freeze" ? "Freeze window" : "Next cross"}</span>
              {secsLeft != null && (
                <span className="num text-text normal-case">
                  {secsLeft > 60 ? `${Math.floor(secsLeft / 60)}m ${String(secsLeft % 60).padStart(2, "0")}s` : `${secsLeft}s`}
                </span>
              )}
            </div>
            <p className="text-[12.5px] text-muted">
              {phase === "freeze"
                ? "Orders can no longer be cancelled. The cross runs when the window closes."
                : "Orders placed before the freeze window can still be cancelled."}
            </p>
          </div>
        </div>
      </div>
    </Container>
  );
}
