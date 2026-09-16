// Build-time snapshot of the devnet venue and the Pyth reference.
//
// The landing page is statically prerendered so that "/" reads with no wallet
// and with JavaScript off. The cross and oracle state in the HTML are the
// values as of the build, each stamped with its own timestamp. The live
// section hydrates on top and replaces them when JavaScript runs.
//
// Every figure here is read from chain. Nothing is hand-written, and a failed
// read says so rather than showing a stale number as if it were current.

import { Connection, PublicKey } from "@solana/web3.js";
import { CLUSTER, MAINNET_UPSTREAM, ORACLE_MAX_AGE_SECS, PROGRAM_ID, type TickerSymbol } from "./uncross/config";
import { SEED_AUCTIONS, discoverAuctions, listRecentAuctions, readAuctions, tickerOf } from "./uncross/auction-index";
import { decodePriceUpdate } from "./uncross/pyth";

export interface Cross {
  auction: string;
  ticker: TickerSymbol;
  /** $ per share. */
  price: number;
  shares: number;
  orders: number;
  /** Unix seconds of the last transaction on the auction account. */
  at: number | null;
  signature: string | null;
}

export interface OracleSnapshot {
  price: number;
  conf: number;
  publishTime: number;
  feedId: string;
  ageSecs: number;
  fresh: boolean;
}

export interface Snapshot {
  builtAt: number;
  crosses: Cross[];
  oracle: OracleSnapshot | null;
  error: string | null;
}

const PROGRAM = new PublicKey(PROGRAM_ID);

/** Auctions that actually traded, newest first, dated by their last transaction. */
async function readCrosses(conn: Connection, perTicker: number): Promise<Cross[]> {
  let all = await listRecentAuctions(conn, PROGRAM, 24);
  if (!all) {
    let known = [...SEED_AUCTIONS];
    try {
      known = [...new Set([...known, ...(await discoverAuctions(conn, PROGRAM))])];
    } catch {
      /* discovery is opportunistic; the seed list still renders a real page */
    }
    all = await readAuctions(conn, known, PROGRAM);
  }
  const auctions = all.filter((a) => a.executableVolume > 0n);

  const picked: Cross[] = [];
  for (const ticker of ["AAPLx", "IBMx"] as TickerSymbol[]) {
    const mine = auctions.filter((a) => tickerOf(a) === ticker).slice(0, perTicker);
    for (const a of mine) {
      // The auction's own signature history; its last transaction is the
      // cross or settle, which is what dates the print.
      const sigs = await conn.getSignaturesForAddress(a.address, { limit: 30 }, "confirmed").catch(() => []);
      const timed = sigs.filter((s) => s.blockTime).sort((x, y) => (x.blockTime ?? 0) - (y.blockTime ?? 0));
      const last = timed[timed.length - 1];
      picked.push({
        auction: a.address.toBase58(),
        ticker,
        price: Number(a.clearingPrice) / 1e6,
        shares: Number(a.executableVolume) / 1e8,
        orders: a.orderCount,
        at: last?.blockTime ?? null,
        signature: last?.signature ?? null,
      });
    }
  }
  return picked.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
}

async function readOracle(): Promise<OracleSnapshot | null> {
  const account = CLUSTER.tickers.AAPLx.pythAccount;
  if (!account) return null;
  const conn = new Connection(MAINNET_UPSTREAM, "confirmed");
  const info = await conn.getAccountInfo(new PublicKey(account), "confirmed");
  if (!info) return null;
  const p = decodePriceUpdate(info.data);
  const ageSecs = Math.max(0, Math.floor(Date.now() / 1000) - p.publishTime);
  return { price: p.price, conf: p.conf, publishTime: p.publishTime, feedId: p.feedId, ageSecs, fresh: ageSecs <= ORACLE_MAX_AGE_SECS };
}

export async function getSnapshot(): Promise<Snapshot> {
  const conn = new Connection(CLUSTER.rpc, "confirmed");

  // Each read stands on its own. A devnet rate-limit must not blank the
  // mainnet oracle panel, and a mainnet hiccup must not blank the cross —
  // different networks, different failures.
  const [crosses, oracle] = await Promise.all([
    readCrosses(conn, 4).catch(() => null),
    readOracle().catch(() => null),
  ]);

  const failed = [crosses === null && "devnet auctions", oracle === null && "Pyth"].filter(Boolean);

  return {
    builtAt: Date.now(),
    crosses: crosses ?? [],
    oracle,
    error: failed.length ? `could not read: ${failed.join(", ")}` : null,
  };
}

export const latestFor = (s: Snapshot, ticker: TickerSymbol): Cross | null =>
  s.crosses.find((c) => c.ticker === ticker) ?? null;
