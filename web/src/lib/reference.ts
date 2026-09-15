import { ORACLE_MAX_AGE_SECS } from "../config";
import type { PythState } from "../hooks";
import { marketState, type MarketState } from "./schedule";

// Reference state is driven by publish age, not the clock: Pyth keeps
// publishing extended-hours prices after the 4pm close, so "closed" on the
// schedule does not mean "no price".
//   regular  — schedule open, fresh print (regular-session reference)
//   extended — schedule closed, fresh print (extended-hours prices)
//   live     — fresh print, schedule unknown
//   stale    — last print older than ORACLE_MAX_AGE_SECS: no reference price
//   none     — no Pyth account on Solana for this equity
export type RefKind = "loading" | "error" | "none" | "regular" | "extended" | "live" | "stale";

export interface RefState {
  kind: RefKind;
  price: number | null;
  publishMs: number | null;
  ageMs: number | null;
  market: MarketState | null;
  fresh: boolean;
}

export function referenceState(p: PythState, now: number): RefState {
  const market = p.schedule ? marketState(p.schedule, now) : null;
  const base = { market, price: null, publishMs: null, ageMs: null, fresh: false };
  if (!p.hasFeed) return { ...base, kind: "none" };
  if (!p.price) return { ...base, kind: p.loading ? "loading" : "error" };
  const publishMs = p.price.publishTime * 1000;
  const ageMs = Math.max(0, now - publishMs);
  const fresh = ageMs <= ORACLE_MAX_AGE_SECS * 1000;
  const kind: RefKind = !fresh ? "stale" : !market ? "live" : market.open ? "regular" : "extended";
  return { kind, market, price: p.price.price, publishMs, ageMs, fresh };
}
