// Is the venue working right now? Two things a visitor can be stopped by: no
// auctions being opened (the keeper is down) and no test tokens to trade with
// (the faucet has hit its cap). Both are shown in a line on every page, and
// only when one is wrong does a banner say so plainly, instead of leaving a
// visitor at a silent dead end.

import { useEffect, useState } from "react";
import { FAUCET_URL } from "../config";
import type { Auction } from "../lib/auction";

/** A new auction opens about every 19 minutes per ticker; past this, something is wrong. */
const KEEPER_QUIET_MS = 25 * 60_000;
/** SOL the faucet gives a wallet that has none. */
const SOL_PER_NEW_WALLET = 0.02;

interface Health {
  capacityLeft?: { grants: number; sol: number };
}

function useFaucetHealth(): Health | null {
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => {
    let dead = false;
    const load = () =>
      fetch(`${FAUCET_URL}/api/faucet/health`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => !dead && setH(j))
        .catch(() => !dead && setH(null));
    void load();
    const id = setInterval(() => !document.hidden && void load(), 60_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, []);
  return h;
}

const minutes = (ms: number) => (ms < 60_000 ? "under a minute" : `${Math.round(ms / 60_000)} min`);

export function useVenueStatus(all: Auction[], slot: number | null, slotMs: number) {
  const health = useFaucetHealth();
  const newestOpen = all.reduce((m, a) => Math.max(m, a.openSlot), 0);
  const keeperMs = newestOpen && slot != null ? Math.max(0, (slot - newestOpen) * slotMs) : null;
  const cap = health?.capacityLeft;
  const wallets = cap ? Math.max(0, Math.min(cap.grants, Math.floor(cap.sol / SOL_PER_NEW_WALLET + 1e-9))) : null;
  return { keeperMs, keeperQuiet: keeperMs != null && keeperMs > KEEPER_QUIET_MS, wallets, faucetOut: wallets === 0 };
}

export function VenueBanner({ keeperQuiet, keeperMs, faucetOut }: ReturnType<typeof useVenueStatus>) {
  if (!keeperQuiet && !faucetOut) return null;
  return (
    <div className="banner warn-banner" role="status">
      {keeperQuiet && <span>No new auction has opened for {minutes(keeperMs ?? 0)}; the next rounds may be late.</span>}
      {faucetOut && <span>The test-token faucet has reached its cap, so new wallets can't be funded right now. Wallets already funded can still trade.</span>}
    </div>
  );
}

export function VenueStatusLine({ keeperMs, wallets }: ReturnType<typeof useVenueStatus>) {
  return (
    <span className="venue-status num">
      <span className={`dot ${keeperMs != null && keeperMs <= KEEPER_QUIET_MS ? "dot-live" : "dot-warn"}`} aria-hidden /> Last auction opened{" "}
      {keeperMs == null ? "—" : `${minutes(keeperMs)} ago`}
      {" · "}
      Faucet: {wallets == null ? "—" : wallets === 0 ? "out of test tokens" : `${wallets} new wallets left`}
    </span>
  );
}
