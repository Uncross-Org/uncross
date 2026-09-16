// Reading auctions without getProgramAccounts.
//
// The public devnet RPC rate-limits getProgramAccounts to the point of being
// unusable for this program: it returns 429 for the query whatever the
// filters, including a keys-only variant, and it stays 429 across repeated
// attempts. Our own keeper (every ~15s) and activity bot (every ~60s) already
// call it from the same address, so the site cannot have it too.
//
// What does work, measured on the same endpoint at the same time:
//   getMultipleAccounts   200, full 2880-byte account data
//   getSignaturesForAddress 200
//   getAccountInfo        200
//
// So auctions are read by address. The seed list below is committed; new
// auctions are discovered from the program's recent signatures, which is how
// the index keeps up with the keeper opening new ones.

import { Connection, PublicKey } from "@solana/web3.js";
import { AUCTION_SIZE, decodeAuction, type Auction } from "./auction";
import { CLUSTER, type TickerSymbol } from "./config";

/**
 * Auction addresses known at commit time, so a cold start renders a populated
 * page even if discovery is throttled. Discovery extends this at runtime; it
 * is a starting point, not the whole history.
 */
export const SEED_AUCTIONS: string[] = [
  // AAPLx
  "5b3m3zYQxB26pH7vyKkGpBTGy5DqBy83SG8vxmgEeMw",
  "ByWUqZHNxMkbMQfKv8k9QKJLG4J3AgmwW6GTnU9bGPF9",
  "D5owMRmzKTHvDrqxRayUqdedrbQiX4Go17P4s2xNV2sg",
  "8p5eHnXygbhXhovx1iJuqBSo3p1vbCshzjE52pW6fyJ9",
  "DShqxW7WJWRL1u6ZPoJPsDvbs3EjomHyp5LUcYj7wZJJ",
  "GCk3mmceFdb2TuHjdTjRXngP9uAypMSTrkRY9DgTuCUN",
  // IBMx
  "7uZS1fHpSknJEPY7irxgZGoherL6fkjvuHqjn1rvFwav",
  "DV8duwvPaNm71mGTqFFoBM5H7knAYn2X6nY7qBPkxewH",
  "61No3g7naKr8giSbaLvZoBpPpbmwRNeZ3xzVXWYsv7Ce",
  "H7jXaxDDnEyLD2MEEVyJqCjqY9UEJGYuecMSzCYrKTZq",
  "DTnGacBBK2Vwh6KsmwbcUL365PemQ1QVmSAUUtiSFSyx",
  "6A574jSncP8pJCDnh42Pa5UX81wo9DCJWwbPihzSBYjB",
  "CS8E5j7f8CpGDgEnYoXSuAJghqUfQbbp6VrLZ5o82exG",
];

const MINT_TO_TICKER: Record<string, TickerSymbol> = {
  [CLUSTER.tickers.AAPLx.mint]: "AAPLx",
  [CLUSTER.tickers.IBMx.mint]: "IBMx",
};

export const tickerOf = (a: Auction): TickerSymbol | null => MINT_TO_TICKER[a.tickerMint.toBase58()] ?? null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Read the given addresses and keep the ones that really are auctions. */
export async function readAuctions(conn: Connection, addresses: string[], programId: PublicKey): Promise<Auction[]> {
  const out: Auction[] = [];
  for (let i = 0; i < addresses.length; i += 100) {
    const batch = addresses.slice(i, i + 100).map((a) => new PublicKey(a));
    const infos = await conn.getMultipleAccountsInfo(batch, "confirmed");
    infos.forEach((info, j) => {
      if (info && info.data.length === AUCTION_SIZE && info.owner.equals(programId)) {
        out.push(decodeAuction(batch[j], info.data));
      }
    });
    if (i + 100 < addresses.length) await sleep(150);
  }
  return out.sort((a, b) => b.openSlot - a.openSlot);
}

/**
 * Auction addresses appearing in the program's recent transactions. Every
 * auction is touched by the keeper when it opens, crosses and settles, so
 * recent signatures are a reliable way to find new ones.
 */
export async function discoverAuctions(conn: Connection, programId: PublicKey, txToScan = 12): Promise<string[]> {
  const sigs = await conn.getSignaturesForAddress(programId, { limit: 40 }, "confirmed");
  const candidates = new Set<string>();

  for (const s of sigs.slice(0, txToScan)) {
    try {
      const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      for (const k of tx?.transaction?.message?.staticAccountKeys ?? []) candidates.add(k.toBase58());
    } catch {
      /* one unreadable transaction does not spoil the scan */
    }
    await sleep(120);
  }

  const found = await readAuctions(conn, [...candidates], programId);
  return found.map((a) => a.address.toBase58());
}
