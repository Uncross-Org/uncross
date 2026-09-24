// The program's clearing rule, replayed step by step so the page can show why
// an auction cleared where it did. A line-for-line mirror of
// find_clearing_price in programs/uncross/src/clearing.rs, in the program's own
// integer units, so it lands on exactly the price the program chose:
//   1. over every live order's limit, the price that trades the most;
//   2. on a tie, the one where demand and supply are closest;
//   3. still tied and a fresh oracle price passed the gate, the nearest to it;
//   4. otherwise the midpoint of the tied range.

import type { OrderSummary } from "./auction";

export interface Candidate {
  price: bigint;
  demand: bigint;
  supply: bigint;
  volume: bigint;
  imbalance: bigint;
}

export type DecidedBy = "most volume" | "closest balance" | "nearest the oracle" | "midpoint" | "nothing traded";

export interface ClearingTrace {
  candidates: Candidate[];
  tiedOnVolume: bigint[];
  tiedOnBalance: bigint[];
  decidedBy: DecidedBy;
  price: bigint;
  volume: bigint;
}

const live = (o: OrderSummary) => o.active && !o.cancelled;
const demandAt = (orders: OrderSummary[], p: bigint) => orders.filter((o) => live(o) && o.side === "buy" && o.limitPrice >= p).reduce((a, o) => a + o.quantity, 0n);
const supplyAt = (orders: OrderSummary[], p: bigint) => orders.filter((o) => live(o) && o.side === "sell" && o.limitPrice <= p).reduce((a, o) => a + o.quantity, 0n);
const min = (a: bigint, b: bigint) => (a < b ? a : b);
const absDiff = (a: bigint, b: bigint) => (a > b ? a - b : b - a);

export function traceClearing(orders: OrderSummary[], oracle: bigint | null): ClearingTrace {
  const prices = [...new Set(orders.filter(live).map((o) => o.limitPrice))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const candidates = prices.map((p) => {
    const demand = demandAt(orders, p), supply = supplyAt(orders, p);
    return { price: p, demand, supply, volume: min(demand, supply), imbalance: absDiff(demand, supply) };
  });
  if (!candidates.length) return { candidates, tiedOnVolume: [], tiedOnBalance: [], decidedBy: "nothing traded", price: 0n, volume: 0n };

  let bestV = 0n;
  let best: bigint[] = [];
  for (const c of candidates) {
    if (c.volume > bestV) {
      bestV = c.volume;
      best = [c.price];
    } else if (c.volume === bestV && c.volume > 0n) best.push(c.price);
  }
  if (!best.length) return { candidates, tiedOnVolume: [], tiedOnBalance: [], decidedBy: "nothing traded", price: candidates[0].price, volume: 0n };

  let price: bigint;
  let decidedBy: DecidedBy;
  let gapTies: bigint[] = [];
  if (best.length === 1) {
    price = best[0];
    decidedBy = "most volume";
  } else {
    let minGap: bigint | null = null;
    for (const p of best) {
      const gap = absDiff(demandAt(orders, p), supplyAt(orders, p));
      if (minGap === null || gap < minGap) {
        minGap = gap;
        gapTies = [p];
      } else if (gap === minGap) gapTies.push(p);
    }
    if (gapTies.length === 1) {
      price = gapTies[0];
      decidedBy = "closest balance";
    } else if (oracle != null) {
      price = gapTies.reduce((a, p) => (absDiff(p, oracle) < absDiff(a, oracle) ? p : a));
      decidedBy = "nearest the oracle";
    } else {
      const lo = gapTies.reduce((a, p) => (p < a ? p : a));
      const hi = gapTies.reduce((a, p) => (p > a ? p : a));
      price = lo + (hi - lo) / 2n;
      decidedBy = "midpoint";
    }
  }
  return { candidates, tiedOnVolume: best, tiedOnBalance: gapTies, decidedBy, price, volume: min(demandAt(orders, price), supplyAt(orders, price)) };
}
