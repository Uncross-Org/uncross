import type { Auction, Phase } from "../lib/auction";
import { fmtDuration, fmtInt, fmtLocal } from "../lib/format";

interface Props {
  auction: Auction;
  phase: Phase;
  slot: number | null;
  slotMs: number;
  now: number;
}

const PHASE_LABEL: Record<Phase, string> = {
  upcoming: "Opens soon",
  open: "Open · place and cancel orders",
  freeze: "Freeze · cancellations closed",
  "awaiting-cross": "Window closed · ready to cross",
  cleared: "Crossed · settling",
  settled: "Crossed and settled",
};

export function Countdown({ auction, phase, slot, slotMs, now }: Props) {
  const { openSlot, closeSlot, freezeSlots } = auction;
  const freezeStart = closeSlot - freezeSlots;
  const total = Math.max(1, closeSlot - openSlot);
  const s = slot ?? openSlot;
  const pos = Math.min(1, Math.max(0, (s - openSlot) / total));
  const freezePct = (freezeSlots / total) * 100;
  const toMs = (target: number) => (target - s) * slotMs;

  let big: string;
  let sub: string;
  if (phase === "open") {
    big = `Cross in ${fmtDuration(toMs(closeSlot))}`;
    sub = `Cancellations close in ${fmtDuration(toMs(freezeStart))}`;
  } else if (phase === "freeze") {
    big = `Cross in ${fmtDuration(toMs(closeSlot))}`;
    sub = "Orders still accepted. Orders can't be cancelled now.";
  } else if (phase === "upcoming") {
    big = `Opens in ${fmtDuration(toMs(openSlot))}`;
    sub = "";
  } else if (phase === "awaiting-cross") {
    big = "Ready to cross";
    sub = "Anyone can run the cross. It takes one transaction.";
  } else {
    const at = now - (s - closeSlot) * slotMs;
    big = phase === "settled" ? "Settled" : "Crossed";
    sub = `Window closed ≈ ${fmtLocal(at)}`;
  }

  return (
    <section className={`countdown card phase-${phase}`} aria-label="Auction timing">
      <div className="cd-head">
        <div>
          <div className="cd-phase">{PHASE_LABEL[phase]}</div>
          <div className="cd-big num">{big}</div>
          {sub && <div className="cd-sub">{sub}</div>}
        </div>
        <div className="cd-meta num">
          <div>
            Slot {slot != null ? fmtInt(slot) : "—"} <span className="muted">· ~{(slotMs / 1000).toFixed(2)}s/slot</span>
          </div>
          <div className="muted">
            Window {fmtInt(openSlot)} → {fmtInt(closeSlot)}
          </div>
        </div>
      </div>
      <div
        className="track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos * 100)}
        aria-label="Auction window progress"
      >
        <div className="track-open" style={{ width: `${100 - freezePct}%` }} />
        <div className="track-freeze" style={{ width: `${freezePct}%` }} title="Freeze — cancellations closed" />
        <div className="track-fill" style={{ width: `${pos * 100}%` }} />
        <div className="track-now" style={{ left: `${pos * 100}%` }} />
      </div>
      <div className="track-labels">
        <span>Open — orders &amp; cancels</span>
        <span className="freeze-label" style={{ width: `${Math.max(freezePct, 28)}%` }}>
          Freeze — cancellations closed
        </span>
      </div>
    </section>
  );
}
