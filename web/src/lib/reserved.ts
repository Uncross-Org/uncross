// Which books are held back for the community event, and the one sentence that
// says so. The dashboard's copy of site/lib/uncross/reserved.ts — both read
// the event.json that scripts/build-app.sh copies out of the venue, so the
// page and the chain cannot disagree about which books are held.
//
// Two books sit quiet before the event because the seeding bot has been taken
// off them. Without this a trader opening the dashboard sees the two tickers
// the announcement named showing no orders, and reads it as a broken venue
// rather than a held one.
//
// The time check is what stops "tonight's auction" outliving tonight.

import event from "../event.json";

interface Leg {
  ticker: string;
  startsAt: string;
  windowMins: number;
}

const LEGS: Leg[] = (event.auctions ?? []) as Leg[];

const endOf = (l: Leg) => new Date(l.startsAt).getTime() + l.windowMins * 60_000;
const LAST_END = LEGS.length ? Math.max(...LEGS.map(endOf)) : 0;

export const RESERVED_LABEL = "Reserved for tonight's community auction, 8pm IST / 14:30 UTC";
export const RESERVED_SHORT = "Reserved";

export const RESERVED: ReadonlySet<string> = new Set(event.live ? LEGS.map((l) => l.ticker) : []);

export function isReserved(symbol: string, now: number = Date.now()): boolean {
  return RESERVED.has(symbol) && now < LAST_END;
}
