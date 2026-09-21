// Which books are held back for the community event, and the one sentence that
// says so.
//
// Read from the same event.json the script that opens the auctions reads, so
// the label cannot name a ticker the event does not actually use. Two books
// sit quiet this morning because the seeding bot has been taken off them — a
// visitor arriving from the announcement would otherwise see the two tickers
// they came for looking dead, and conclude the venue is broken rather than
// held.
//
// The time check is what stops "tonight's auction" outliving tonight: after
// the last book closes the label is gone whether or not anyone removes it.

import event from "@/lib/uncross/event.json";

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

/** The tickers held for the event, ignoring the clock. */
export const RESERVED: ReadonlySet<string> = new Set(event.live ? LEGS.map((l) => l.ticker) : []);

/**
 * Whether to show the label for `symbol`. Called with no argument it answers
 * for right now, which is what a server render and a JS-off page get; passing
 * a time lets a component that already ticks clear the label on its own.
 */
export function isReserved(symbol: string, now: number = Date.now()): boolean {
  return RESERVED.has(symbol) && now < LAST_END;
}
