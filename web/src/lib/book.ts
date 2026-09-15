import { liveOrders, type Auction } from "./auction";
import { programToPerShare, rawToShares } from "./units";

/** A live order in display units ($/share, shares). */
export interface BookOrder {
  index: number;
  side: "buy" | "sell";
  price: number;
  shares: number;
}

export function bookOrders(a: Auction, m: number): BookOrder[] {
  return liveOrders(a).map((o) => ({
    index: o.index,
    side: o.side,
    price: programToPerShare(o.limitPrice, m),
    shares: rawToShares(o.quantity, m),
  }));
}

/** Σ buy shares with limit ≥ p. */
export const demandAt = (orders: BookOrder[], p: number) =>
  orders.reduce((s, o) => (o.side === "buy" && o.price >= p - 1e-9 ? s + o.shares : s), 0);
/** Σ sell shares with limit ≤ p. */
export const supplyAt = (orders: BookOrder[], p: number) =>
  orders.reduce((s, o) => (o.side === "sell" && o.price <= p + 1e-9 ? s + o.shares : s), 0);

export interface Level {
  price: number;
  buyShares: number;
  sellShares: number;
  demand: number;
  supply: number;
}

export function levels(orders: BookOrder[]): Level[] {
  const prices = Array.from(new Set(orders.map((o) => o.price))).sort((a, b) => a - b);
  return prices.map((p) => ({
    price: p,
    buyShares: orders.filter((o) => o.side === "buy" && o.price === p).reduce((s, o) => s + o.shares, 0),
    sellShares: orders.filter((o) => o.side === "sell" && o.price === p).reduce((s, o) => s + o.shares, 0),
    demand: demandAt(orders, p),
    supply: supplyAt(orders, p),
  }));
}

export function bestBidAsk(orders: BookOrder[]) {
  const bids = orders.filter((o) => o.side === "buy").map((o) => o.price);
  const asks = orders.filter((o) => o.side === "sell").map((o) => o.price);
  return { bid: bids.length ? Math.max(...bids) : null, ask: asks.length ? Math.min(...asks) : null };
}

/** Round "nice" axis ticks. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(+v.toFixed(10));
  return out;
}

export function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * mag >= v) ?? 10) * mag;
}
