// Every listed xStock, loaded on demand.
//
// Ten tickers run on a cadence and are compiled into the app; the other
// thousand-odd are listed and dormant — anyone can open an auction on one. The
// full list is a separate static file (universe.json, beside the app) fetched
// once, so it never weighs down the first load.

import { useEffect, useState } from "react";
import { UNIVERSE_ENABLED, type TickerConfig, type TickerSymbol } from "../config";

export interface ListedTicker {
  symbol: TickerSymbol;
  name: string;
  underlying: string;
  devnetMint: string;
  mainnetMint: string;
  /** On the keeper's cadence. Dormant tickers open only on request. */
  active: boolean;
  pythFeedId: string | null;
  pythAccount: string | null;
  halted: boolean;
  poolTvlUsd: number | null;
}

let pending: Promise<ListedTicker[]> | null = null;

export function loadUniverse(): Promise<ListedTicker[]> {
  pending ??= fetch(`${import.meta.env.BASE_URL}universe.json`, { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : { tickers: [] }))
    .then((d: { tickers?: ListedTicker[] }) => d.tickers ?? [])
    .catch(() => {
      pending = null; // let a later call retry
      return [];
    });
  return pending;
}

const NO_FEED = "0".repeat(64);

/** The same shape the ten compiled-in tickers use, so the rest of the app needs no special case. */
export function toConfig(t: ListedTicker): TickerConfig {
  return {
    symbol: t.symbol,
    name: t.name.replace(/ xStock$/, ""),
    underlying: t.underlying,
    mint: t.devnetMint,
    pythAccount: t.pythAccount,
    pythFeedId: t.pythFeedId ?? NO_FEED,
    hermesQuery: t.underlying,
  };
}

export function useUniverse(): { list: ListedTicker[] | null; bySymbol: Map<string, ListedTicker> } {
  const [list, setList] = useState<ListedTicker[] | null>(null);
  useEffect(() => {
    // Without the listing the app is the ten tickers on cadence, as before it.
    if (!UNIVERSE_ENABLED) return;
    let live = true;
    void loadUniverse().then((l) => live && setList(l));
    return () => {
      live = false;
    };
  }, []);
  return { list, bySymbol: new Map((list ?? []).map((t) => [t.symbol, t])) };
}
