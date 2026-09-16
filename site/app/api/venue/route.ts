// Server-side, cached view of the devnet venue.
//
// One server reads the chain on a timer and every visitor reads its cache.
// Reads go by address (getMultipleAccounts), never getProgramAccounts, which
// the public devnet RPC rate-limits into uselessness — see
// lib/uncross/auction-index.ts for the measurements.
//
// When a read fails, the last good one is served with the time it was taken
// and a stale flag, so the page can say how old its numbers are instead of
// showing nothing or passing them off as current.

import { Connection, PublicKey } from "@solana/web3.js";
import { CLUSTER, PROGRAM_ID, type TickerSymbol } from "@/lib/uncross/config";
import type { Auction } from "@/lib/uncross/auction";
import { SEED_AUCTIONS, discoverAuctions, readAuctions, tickerOf } from "@/lib/uncross/auction-index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Serve from cache for this long before reading again. */
const FRESH_MS = 10_000;
/** After a failure, wait at least this long before trying again. */
const BACKOFF_MS = 20_000;
/** Look for newly opened auctions this often; reads of known ones are cheaper. */
const DISCOVER_MS = 120_000;

interface WireOrder {
  index: number;
  side: "buy" | "sell";
  limitPrice: string;
  quantity: string;
  filledQuantity: string;
  active: boolean;
  cancelled: boolean;
}

interface WireAuction {
  address: string;
  ticker: TickerSymbol;
  openSlot: number;
  closeSlot: number;
  freezeSlots: number;
  status: string;
  orderCount: number;
  clearingPrice: string;
  executableVolume: string;
  indicativePrice: string;
  indicativeVolume: string;
  orders: WireOrder[];
}

export interface VenuePayload {
  /** When the data being served was actually read from chain. */
  readAt: number;
  stale: boolean;
  error: string | null;
  slot: number | null;
  auctions: WireAuction[];
}

const wire = (a: Auction, ticker: TickerSymbol): WireAuction => ({
  address: a.address.toBase58(),
  ticker,
  openSlot: a.openSlot,
  closeSlot: a.closeSlot,
  freezeSlots: a.freezeSlots,
  status: a.status,
  orderCount: a.orderCount,
  clearingPrice: a.clearingPrice.toString(),
  executableVolume: a.executableVolume.toString(),
  indicativePrice: a.indicativePrice.toString(),
  indicativeVolume: a.indicativeVolume.toString(),
  orders: a.orders.map((o) => ({
    index: o.index,
    side: o.side,
    limitPrice: o.limitPrice.toString(),
    quantity: o.quantity.toString(),
    filledQuantity: o.filledQuantity.toString(),
    active: o.active,
    cancelled: o.cancelled,
  })),
});

// Module-scope state: one warm server serves every visitor.
let cache: VenuePayload | null = null;
let inFlight: Promise<VenuePayload> | null = null;
let nextAttemptAt = 0;
let known = new Set<string>(SEED_AUCTIONS);
let lastDiscovery = 0;

async function read(): Promise<VenuePayload> {
  const conn = new Connection(CLUSTER.rpc, "confirmed");
  const program = new PublicKey(PROGRAM_ID);

  // The first read has to be fast. Discovery is a signature scan that costs
  // ~20 seconds, and a visitor arriving at a cold server would stare at an
  // empty panel for all of it. The seeded addresses are enough to render a
  // real page immediately, so discovery waits for the second read onwards.
  const firstRead = cache === null;
  if (!firstRead && Date.now() - lastDiscovery > DISCOVER_MS) {
    lastDiscovery = Date.now();
    try {
      const found = await discoverAuctions(conn, program);
      known = new Set([...known, ...found]);
    } catch {
      /* discovery is opportunistic; the known set still works */
    }
  }

  const auctions = await readAuctions(conn, [...known], program);
  const slot = await conn.getSlot("confirmed").catch(() => null);

  return {
    readAt: Date.now(),
    stale: false,
    error: null,
    slot,
    auctions: auctions
      .map((a) => {
        const t = tickerOf(a);
        return t ? wire(a, t) : null;
      })
      .filter((x): x is WireAuction => x !== null),
  };
}

export async function GET(): Promise<Response> {
  const now = Date.now();
  const fresh = cache && now - cache.readAt < FRESH_MS;

  if (!fresh && now >= nextAttemptAt && !inFlight) {
    inFlight = read()
      .then((payload) => {
        cache = payload;
        nextAttemptAt = 0;
        return payload;
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : String(e);
        nextAttemptAt = Date.now() + BACKOFF_MS;
        return cache
          ? { ...cache, stale: true, error: message }
          : { readAt: Date.now(), stale: true, error: message, slot: null, auctions: [] };
      })
      .finally(() => {
        inFlight = null;
      });
  }

  const payload =
    fresh && cache
      ? cache
      : ((await inFlight) ??
        cache ?? {
          readAt: Date.now(),
          stale: true,
          error: "devnet read is backing off",
          slot: null,
          auctions: [],
        });

  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
