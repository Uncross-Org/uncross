// Which books the community event uses, read from the same event.json the
// script that opens the auctions reads.
//
// This no longer drives any label. The event is promoted off-site, so the
// dashboard shows the auctions themselves rather than announcing them. What
// remains is the one thing the UI still has to agree with the faucet about:
// a single grant funds every ticker listed here, and the "get test tokens"
// card has to name them all, or someone comes back for the second book and is
// refused as already funded.

import event from "../event.json";

interface Leg {
  ticker: string;
  startsAt: string;
  windowMins: number;
}

const LEGS: Leg[] = (event.auctions ?? []) as Leg[];

/** The tickers one grant covers, in the order they run. */
export const EVENT_TICKERS: string[] = event.live ? LEGS.map((l) => l.ticker) : [];
