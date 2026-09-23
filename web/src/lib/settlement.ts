// A wallet's orders, and what each one came to, keyed to the order.
//
// The dashboard used to learn a wallet's orders from the ticker's newest
// auction. The keeper opens the next auction seconds after a cross — before
// settlement has landed — so the result vanished at exactly the moment it
// mattered. Everything here starts from the wallet's own order accounts
// instead, which are never closed, via the site's /api/orders.
//
// Every figure in a receipt is on-chain settlement data, from one of two
// sources, and the receipt says which:
//   - live: the auction account still exists. Fill, clearing price and what
//     each order paid or received are the program's own per-order record,
//     written at the cross. What came back is this wallet's token movement in
//     the settlement transaction.
//   - rebuilt: the auction has been closed and its rent returned, so its
//     per-order record is gone. The fill is still on the order account; what
//     was paid, received and returned comes from the settlement transaction's
//     token movements, and the clearing price is worked back from those.
// The two are never mixed within one receipt.
//
// Nothing reads the order's `refunded` flag. The program sets it only on the
// failure path (cancel_and_refund): an unfilled order whose escrow came back
// in full at an ordinary settlement reads false.

import { PublicKey } from "@solana/web3.js";
import { useEffect, useRef, useState } from "react";
import { decodeAuction, type Auction, type Phase } from "./auction";
import { decodeOrder, type OrderAccount } from "./order";

export interface TxRef {
  sig: string;
  time: number | null;
}
export interface Settlement extends TxRef {
  kind: "settle" | "refund" | "cancel";
  quoteDelta: bigint;
  tickerDelta: bigint;
  ordersInTx: number;
}
export interface MyOrder {
  order: OrderAccount;
  /** Null once the auction has been closed. */
  auction: Auction | null;
  auctionAddress: string;
  tickerMint: string | null;
  placed: TxRef | null;
  settled: Settlement | null;
}

interface Wire {
  orders?: { address: string; data: string; auction: string; tickerMint: string | null; placed: TxRef | null; settled: (TxRef & { kind: Settlement["kind"]; quoteDelta: string; tickerDelta: string; ordersInTx: number }) | null }[];
  auctions?: Record<string, string | null>;
  error?: string;
}

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export async function fetchMyOrders(owner: string): Promise<MyOrder[]> {
  const r = await fetch(`/api/orders?owner=${owner}`, { cache: "no-store" });
  const w = (await r.json()) as Wire;
  if (!r.ok || w.error) throw new Error(w.error ?? `orders ${r.status}`);
  const auctions = new Map<string, Auction | null>();
  for (const [k, v] of Object.entries(w.auctions ?? {})) auctions.set(k, v ? decodeAuction(new PublicKey(k), bytes(v)) : null);
  return (w.orders ?? []).map((o) => ({
    order: decodeOrder(new PublicKey(o.address), bytes(o.data)),
    auction: auctions.get(o.auction) ?? null,
    auctionAddress: o.auction,
    tickerMint: o.tickerMint,
    placed: o.placed,
    settled: o.settled ? { ...o.settled, quoteDelta: BigInt(o.settled.quoteDelta), tickerDelta: BigInt(o.settled.tickerDelta) } : null,
  }));
}

/** The connected wallet's orders, refreshed every 10s and whenever `refreshKey` changes. Null until the first read. */
export function useMyOrders(owner: string | null, refreshKey: number): { orders: MyOrder[] | null; error: string | null } {
  const [orders, setOrders] = useState<MyOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  useEffect(() => setOrders(null), [owner]);
  useEffect(() => {
    if (!owner) return;
    let dead = false;
    const load = () =>
      fetchMyOrders(owner)
        .then((o) => {
          if (dead || ownerRef.current !== owner) return;
          setOrders(o);
          setError(null);
        })
        .catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const id = setInterval(() => !document.hidden && void load(), 10_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [owner, refreshKey]);
  return { orders, error };
}

// ---------------------------------------------------------------- statuses

/** The words an order's state is given everywhere in the app. */
export type OrderStatus = "Open" | "Frozen" | "Filled" | "Partially filled" | "Unfilled" | "Cancelled" | "Refunded";

export const STATUS_HELP: Record<OrderStatus, string> = {
  Open: "Resting in the book. You can still cancel it.",
  Frozen: "The auction is about to cross. It can no longer be cancelled.",
  Filled: "Every share you asked for traded, at the clearing price.",
  "Partially filled": "Some of your shares traded at the clearing price; the rest came back to you.",
  Unfilled: "Your limit was outside the clearing price, so nothing traded. Everything you locked came back.",
  Cancelled: "You cancelled it before the auction froze. Everything you locked came back.",
  Refunded: "The auction could not settle normally, so every order got back all it locked.",
};

export function orderStatus(o: OrderAccount, auction: Auction | null, phase: Phase | null, settled: Settlement | null): OrderStatus {
  if (o.cancelled) return "Cancelled";
  if (settled?.kind === "refund" || auction?.settlePath === "refund") return "Refunded";
  if (auction && auction.status === "open") return phase === "open" || phase === "upcoming" ? "Open" : "Frozen";
  const filled = auction ? (auction.orders[o.orderIndex]?.filledQuantity ?? 0n) : o.filledQuantity;
  if (filled === 0n) return "Unfilled";
  return filled >= o.quantity ? "Filled" : "Partially filled";
}

// ---------------------------------------------------------------- receipts

export interface Receipt {
  source: "live" | "rebuilt";
  status: OrderStatus;
  side: "buy" | "sell";
  /** Raw ticker units and program price units; the component converts with the multiplier. */
  requested: bigint;
  filled: bigint;
  limitPrice: bigint;
  /** Program units (quote atomic per whole raw token). Null when it cannot be read or worked back. */
  clearingPrice: bigint | null;
  /** Quote atomic: what a buy paid, or what a sell received. Null if not known. */
  traded: bigint | null;
  /** What came back in the settlement transaction: quote for a buy, ticker for a sell. Null before settlement lands. */
  returned: bigint | null;
  /** What was delivered: ticker to a buy, quote to a sell. Null before settlement lands. */
  delivered: bigint | null;
  escrow: bigint;
  settlement: Settlement | null;
  /** The settlement moved several of this wallet's orders at once; its movements are their total. */
  shared: boolean;
}

/** Null while the order has not crossed. */
export function receiptOf(m: MyOrder): Receipt | null {
  const { order: o, auction: a, settled: s } = m;
  const crossed = a ? a.status !== "open" : !!s;
  if (!crossed && !o.cancelled) return null;
  const status = orderStatus(o, a, null, s);
  const shared = !!s && s.ordersInTx > 1;
  const buy = o.side === "buy";
  // What came back and what was delivered, as this wallet's token movements.
  const returned = s && !shared ? (buy ? s.quoteDelta : s.tickerDelta) : null;
  const delivered = s && !shared ? (buy ? s.tickerDelta : s.quoteDelta) : null;
  if (a) {
    const sum = a.orders[o.orderIndex];
    return {
      source: "live",
      status,
      side: o.side,
      requested: o.quantity,
      filled: sum?.filledQuantity ?? 0n,
      limitPrice: o.limitPrice,
      clearingPrice: a.executableVolume > 0n ? a.clearingPrice : null,
      traded: sum ? sum.quoteAmount : null,
      returned,
      delivered,
      escrow: o.escrowAmount,
      settlement: s,
      shared,
    };
  }
  // Rebuilt: the order account's fill, and the settlement's movements.
  const filled = o.filledQuantity;
  let traded: bigint | null = null;
  if (s && !shared && s.kind === "settle") traded = buy ? o.escrowAmount - s.quoteDelta : s.quoteDelta;
  // price per whole raw token = quote atomic × 10^8 / raw quantity
  const clearingPrice = traded != null && filled > 0n ? (traded * 100_000_000n) / filled : null;
  return {
    source: "rebuilt",
    status,
    side: o.side,
    requested: o.quantity,
    filled,
    limitPrice: o.limitPrice,
    clearingPrice,
    traded,
    returned,
    delivered,
    escrow: o.escrowAmount,
    settlement: s,
    shared,
  };
}
