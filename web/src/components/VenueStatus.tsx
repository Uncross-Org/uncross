// Is the venue working right now? Two things a visitor can be stopped by: no
// auctions being opened (the keeper is down) and no test tokens to trade with
// (the faucet has hit its cap, or its wallet cannot pay). Both are shown in a
// line on every page, and only when one is wrong does a banner say so plainly,
// instead of leaving a visitor at a silent dead end.

import { venueWindow, type Auction } from "../lib/auction";
import { faucetBlocked, type FaucetHealth } from "../lib/faucet";
import { fmtApproxDuration } from "../lib/format";

/** SOL the faucet gives a wallet that has none; only for a faucet too old to say what a request costs. */
const SOL_PER_NEW_WALLET = 0.02;

/**
 * How long without a new auction before it counts as late: one window, read
 * from the auctions' own cadence and timed at the slot rate just measured,
 * plus a quarter of it (at least three minutes) for the keeper's polling and
 * the cross itself. A fixed number of minutes was wrong whenever devnet ran
 * slower or faster than when it was written: at 0.23 s a slot a 7,000-slot
 * window is 27 minutes, and a 25-minute threshold warned on a healthy venue.
 */
export function keeperQuietAfterMs(windowSlots: number, slotMs: number): number {
  const windowMs = windowSlots * slotMs;
  return windowMs + Math.max(3 * 60_000, windowMs * 0.25);
}

const minutes = (ms: number) => (ms < 60_000 ? "under a minute" : `${Math.round(ms / 60_000)} min`);

export function useVenueStatus(all: Auction[], slot: number | null, slotMs: number, slotMeasured: boolean, health: FaucetHealth | null) {
  const newestOpen = all.reduce((m, a) => Math.max(m, a.openSlot), 0);
  const keeperMs = newestOpen && slot != null ? Math.max(0, (slot - newestOpen) * slotMs) : null;
  const win = venueWindow(all, slot);
  // No verdict until the slot time has been measured and the window is known:
  // judging lateness against a guessed slot time is how the old warning lied.
  const quietAfterMs = win && slotMeasured ? keeperQuietAfterMs(win.slots, slotMs) : null;
  const keeperQuiet = keeperMs != null && quietAfterMs != null && keeperMs > quietAfterMs;
  const cap = health?.capacityLeft;
  const wallets = health?.funder
    ? Math.max(0, Math.min(cap?.grants ?? Infinity, health.funder.requestsLeft))
    : cap
      ? Math.max(0, Math.min(cap.grants, Math.floor(cap.sol / SOL_PER_NEW_WALLET + 1e-9)))
      : null;
  const faucetOut = wallets === 0;
  const faucetWhy = faucetOut ? faucetBlocked(health) : null;
  const unpaid = !!health?.funder && !health.funder.canPay;
  return { keeperMs, keeperQuiet, quietAfterMs, windowMs: win && slotMeasured ? win.slots * slotMs : null, wallets, faucetOut, faucetWhy, unpaid };
}

export function VenueBanner({ keeperQuiet, keeperMs, windowMs, faucetOut, faucetWhy }: ReturnType<typeof useVenueStatus>) {
  if (!keeperQuiet && !faucetOut) return null;
  return (
    <div className="banner warn-banner" role="status">
      {keeperQuiet && (
        <span>
          No new auction has opened for {minutes(keeperMs ?? 0)}, longer than one window ({fmtApproxDuration(windowMs ?? 0)} at the
          current slot rate); the next rounds may be late.
        </span>
      )}
      {faucetOut && <span>{faucetWhy ?? "The test-token faucet can't fund new wallets right now."} Wallets already funded can still trade.</span>}
    </div>
  );
}

export function VenueStatusLine({ keeperMs, keeperQuiet, wallets, unpaid }: ReturnType<typeof useVenueStatus>) {
  return (
    <span className="venue-status num">
      <span className={`dot ${keeperMs != null && !keeperQuiet ? "dot-live" : "dot-warn"}`} aria-hidden /> Last auction opened{" "}
      {keeperMs == null ? "—" : `${minutes(keeperMs)} ago`}
      {" · "}
      Faucet: {wallets == null ? "—" : unpaid ? "out of devnet SOL" : wallets === 0 ? "at its limit" : `${wallets} new wallets left`}
    </span>
  );
}
