"use client";

// The Pyth gate as a bento: the live gate applied to the current mainnet
// print (the same component and the same five checks as before), the verdicts
// the program actually recorded at recent crosses, the measured finding, and
// the rule. Tiles use the template's bento grid for layout and its glowing
// border on hover, on our surfaces. Every figure here is either read live,
// read from chain, or quoted from the log it came from.

import { useEffect, useMemo, useState } from "react";
import { Container } from "@/components/container";
import { SectionHead } from "@/components/landing/sections";
import { PythGate } from "@/components/landing/pyth-gate";
import { BentoGrid } from "@/components/ui/bento-grid";
import { GlowingEffect } from "@/components/ui/glowing-effect";
import { useVenueAll } from "@/lib/use-venue";
import { GATE_REASONS } from "@/lib/uncross/auction";
import { explorerAddr } from "@/lib/uncross/config";
import { fmtEt } from "@/lib/uncross/format";
import type { OracleSnapshot } from "@/lib/snapshot";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function Tile({ children, className = "", reduced }: { children: React.ReactNode; className?: string; reduced: boolean }) {
  return (
    <div className={`relative rounded-2xl border border-line bg-surface p-6 md:p-7 ${className}`}>
      <GlowingEffect spread={36} glow proximity={56} inactiveZone={0.02} borderWidth={2} disabled={reduced} />
      <div className="relative flex h-full flex-col">{children}</div>
    </div>
  );
}

/** What the program wrote at recent crosses: the gate byte and the print it examined. */
function RecordedVerdicts() {
  const { auctions, loading } = useVenueAll();
  const recent = useMemo(
    () =>
      auctions
        .filter((a) => a.executableVolume > 0n && a.oracleGate > 0)
        .sort((x, y) => y.closeSlot - x.closeSlot)
        .slice(0, 12),
    [auctions],
  );
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const a of recent) m.set(a.oracleGate, (m.get(a.oracleGate) ?? 0) + 1);
    return [...m.entries()].sort((x, y) => y[1] - x[1]);
  }, [recent]);
  const latest = recent[0];

  return (
    <>
      <div className="eyebrow">Recorded on chain at the cross</div>
      {loading ? (
        <div className="num mt-3 text-[13px] text-muted">reading…</div>
      ) : recent.length === 0 ? (
        <div className="mt-3 text-[13.5px] text-text-2">No cross has recorded a verdict yet.</div>
      ) : (
        <>
          <div className="mt-3 flex flex-col">
            {counts.map(([code, n]) => (
              <div key={code} className="flex items-baseline justify-between gap-3 border-t border-line py-2 text-[13px] first:border-t-0">
                <span className={code === 1 ? "font-semibold text-bid" : "text-text-2"}>
                  {code === 1 ? "passed" : `refused · ${GATE_REASONS[code] ?? "unknown reason"}`}
                </span>
                <span className="num text-muted">
                  {n} of {recent.length}
                </span>
              </div>
            ))}
          </div>
          {latest && (
            <a
              href={explorerAddr(latest.address.toBase58())}
              target="_blank"
              rel="noreferrer"
              className="num mt-auto pt-4 text-[12px] text-muted underline decoration-line underline-offset-4 hover:text-text"
            >
              latest: {latest.ticker}, print of {latest.oraclePublishTime ? fmtEt(latest.oraclePublishTime * 1000) : "no print"} →
            </a>
          )}
        </>
      )}
    </>
  );
}

export function PythSectionV2({ oracle, builtAt }: { oracle: OracleSnapshot | null; builtAt: number }) {
  const reduced = usePrefersReducedMotion();
  return (
    <Container as="section" id="pyth" className="py-16 md:py-24">
      <SectionHead
        eyebrow="Pyth"
        title="A reference price is welcome. It never sets the price."
        lede="The program reads Pyth's AAPL/USD account at every cross and writes down what it decided. Here is the gate applied to the print on mainnet right now, and what it has recorded so far."
      />

      <BentoGrid className="mt-10 max-w-none md:auto-rows-auto md:grid-cols-3">
        <Tile reduced={reduced} className="md:col-span-2 md:row-span-2">
          <div className="eyebrow mb-3">Pyth · AAPL/USD · read from Solana mainnet</div>
          <PythGate initial={oracle} builtAt={builtAt} />
        </Tile>

        <Tile reduced={reduced}>
          <RecordedVerdicts />
        </Tile>

        <Tile reduced={reduced}>
          <div className="eyebrow">The rule</div>
          <p className="mt-3 text-[14.5px] leading-relaxed text-text">
            The price is the one that trades the most shares. Pyth only breaks an exact tie, and only when its price is
            fresh.
          </p>
          <p className="num mt-auto pt-4 text-[12px] text-muted">tie → most volume → smallest imbalance → nearest passing print → midpoint</p>
        </Tile>

        <Tile reduced={reduced} className="md:col-span-3">
          <div className="eyebrow">Measured, not assumed</div>
          <p className="mt-3 max-w-[78ch] text-[14.5px] leading-relaxed text-text-2">
            Checked every five minutes for 10h38m, straight through the 4pm close and deep into the overnight: at all 80
            checks the latest print was at most 14 seconds old. Its schedule called the market closed the whole time.
            The account carries no session field, so on-chain a thin after-hours print and a liquid midday one look the
            same.
          </p>
          <p className="num mt-3 text-[12px] text-muted">docs/data/pyth-aapl-watch-2026-09-15.log · docs/pyth.md</p>
        </Tile>
      </BentoGrid>
    </Container>
  );
}
