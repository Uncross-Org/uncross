"use client";

// Client-side view of the devnet venue.
//
// This reads our own cached route, not the RPC directly: the public devnet
// endpoint rate-limits getProgramAccounts to the point where a browser call
// reliably returns 429. The route makes that call once per server and serves
// everyone from its cache, telling us how old the data is.

import { PublicKey } from "@solana/web3.js";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TickerSymbol } from "./uncross/config";
import { auctionPhase, type Auction, type OrderSummary, type Phase } from "./uncross/auction";
import { demandAt, supplyAt, type BookOrder } from "./uncross/book";
import { programToPerShare, rawToShares } from "./uncross/units";

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

interface VenuePayload {
  readAt: number;
  stale: boolean;
  error: string | null;
  slot: number | null;
  auctions: WireAuction[];
}

/** Just enough of an Auction for the landing page's read-only views. */
export interface LiveAuction {
  address: PublicKey;
  ticker: TickerSymbol;
  openSlot: number;
  closeSlot: number;
  freezeSlots: number;
  status: string;
  orderCount: number;
  clearingPrice: bigint;
  executableVolume: bigint;
  indicativePrice: bigint;
  indicativeVolume: bigint;
  orders: OrderSummary[];
}

const hydrate = (w: WireAuction): LiveAuction => ({
  address: new PublicKey(w.address),
  ticker: w.ticker,
  openSlot: w.openSlot,
  closeSlot: w.closeSlot,
  freezeSlots: w.freezeSlots,
  status: w.status,
  orderCount: w.orderCount,
  clearingPrice: BigInt(w.clearingPrice),
  executableVolume: BigInt(w.executableVolume),
  indicativePrice: BigInt(w.indicativePrice),
  indicativeVolume: BigInt(w.indicativeVolume),
  orders: w.orders.map((o) => ({
    index: o.index,
    side: o.side,
    limitPrice: BigInt(o.limitPrice),
    quantity: BigInt(o.quantity),
    filledQuantity: BigInt(o.filledQuantity),
    quoteAmount: 0n,
    active: o.active,
    cancelled: o.cancelled,
  })),
});

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

export interface LiveVenue {
  current: LiveAuction | null;
  book: BookOrder[];
  indicative: { price: number; volume: number } | null;
  phase: Phase | null;
  slot: number | null;
  traded: LiveAuction[];
  loading: boolean;
  /** How old the served data is, and why, when the upstream is refusing. */
  readAt: number | null;
  stale: boolean;
  error: string | null;
}

const EMPTY: LiveVenue = {
  current: null,
  book: [],
  indicative: null,
  phase: null,
  slot: null,
  traded: [],
  loading: true,
  readAt: null,
  stale: false,
  error: null,
};

export function useVenue(ticker: TickerSymbol, multiplier = 1): LiveVenue {
  const [payload, setPayload] = useState<VenuePayload | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const pull = async () => {
      try {
        const r = await fetch("/api/venue", { cache: "no-store" });
        if (!r.ok) throw new Error(`venue route ${r.status}`);
        const p = (await r.json()) as VenuePayload;
        if (alive.current) {
          setPayload(p);
          setFailed(null);
        }
      } catch (e) {
        if (alive.current) setFailed(e instanceof Error ? e.message : String(e));
      }
    };
    void pull();
    const id = setInterval(() => {
      if (!document.hidden) void pull();
    }, 10_000);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, []);

  return useMemo(() => {
    if (!payload) return { ...EMPTY, error: failed };
    const mine = payload.auctions.filter((a) => a.ticker === ticker).map(hydrate);

    // Prefer an auction that is genuinely running and has a book: that is what
    // panels labelled "running now" are claiming to show. Fall back to the
    // newest auction with a book (the keeper often opens one seconds ago with
    // nothing in it yet, and an empty chart is a worse answer than a real one
    // from a few minutes back), then to the newest of all. Callers are told
    // the phase so they can label what they actually got.
    const hasBook = (a: LiveAuction) => a.orders.some((o) => o.active && !o.cancelled);
    const isRunning = (a: LiveAuction) => a.status === "open";
    const current = mine.find((a) => isRunning(a) && hasBook(a)) ?? mine.find(hasBook) ?? mine[0] ?? null;
    const book: BookOrder[] = current
      ? current.orders
          .filter((o) => o.active && !o.cancelled)
          .map((o) => ({
            index: o.index,
            side: o.side,
            price: programToPerShare(o.limitPrice, multiplier),
            shares: rawToShares(o.quantity, multiplier),
          }))
      : [];

    return {
      current,
      book,
      indicative:
        current && current.indicativeVolume > 0n
          ? {
              price: programToPerShare(current.indicativePrice, multiplier),
              volume: rawToShares(current.indicativeVolume, multiplier),
            }
          : null,
      phase:
        current && payload.slot != null
          ? auctionPhase(current as unknown as Auction, payload.slot)
          : null,
      slot: payload.slot,
      traded: mine.filter((a) => a.executableVolume > 0n),
      loading: false,
      readAt: payload.readAt,
      stale: payload.stale,
      error: failed ?? payload.error,
    };
  }, [payload, failed, ticker, multiplier]);
}

/** Cumulative curves as step paths, in display units. */
export function curvePoints(book: BookOrder[]) {
  const prices = Array.from(new Set(book.map((o) => o.price))).sort((a, b) => a - b);
  return prices.map((p) => ({ price: p, demand: demandAt(book, p), supply: supplyAt(book, p) }));
}
