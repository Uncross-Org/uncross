// A shared index of auction addresses, so nothing has to call
// getProgramAccounts.
//
// Why: the public devnet RPC rate-limits getProgramAccounts into uselessness
// for this program. Measured on 16 September, from one address, every variant
// returned HTTP 429 — with filters, without filters, and keys-only
// (dataSlice 0) — and stayed 429 across repeated attempts. Meanwhile
// getMultipleAccounts, getAccountInfo and getSignaturesForAddress all
// returned 200 at the same moment. With the keeper (~15s), the activity bot
// (~60s) and the site all polling it, that method is simply not available to
// us.
//
// So the expensive call is removed rather than shared. What the processes
// share on disk is only the list of auction ADDRESSES; each process still
// reads the accounts itself with getMultipleAccounts, which is cheap and not
// throttled. That matters: a keeper acting on another process's cached
// auction status could crank on stale state. Addresses never go stale — an
// auction's address is fixed for its life.

import fs from "node:fs";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { decodeAuction, getAccountsBatched, sleep, withRetry } from "./lib.mjs";

const { PublicKey } = anchor.web3;

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
// Overridable so a run against another cluster (a local validator, say) cannot
// prune the devnet index as dead addresses.
const INDEX_PATH = process.env.AUCTION_INDEX_PATH || path.join(PROJECT_ROOT, "scripts/.auction-index.json");

/** Auction accounts are exactly this many bytes, discriminator included. */
const AUCTION_SIZE = 2880;

/**
 * Addresses known at commit time. Without these the index is empty on a cold
 * start and depends entirely on discovery — and discovery is exactly what
 * fails when the endpoint is throttling us, which is when we need the index
 * most. The keeper also calls rememberAuction() for every auction it opens,
 * so the index bootstraps itself from then on.
 */
const SEED_ADDRESSES = [
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
/** Look for newly opened auctions no more often than this. */
const DISCOVER_INTERVAL_MS = 90_000;
/** Keep the index bounded; the keeper only ever acts on recent auctions. */
const MAX_INDEXED = 400;

function loadIndex() {
  let stored = { addresses: [], discoveredAt: 0 };
  try {
    const raw = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
    stored = {
      addresses: Array.isArray(raw.addresses) ? raw.addresses : [],
      discoveredAt: Number(raw.discoveredAt) || 0,
    };
  } catch {
    // No index yet, or an unreadable one: fall back to the seeds alone.
  }
  // Seeds are always merged in, not just used when the file is missing. A
  // previous run that saved an empty list (discovery failed while throttled)
  // must not leave us with nothing to read.
  return {
    addresses: [...new Set([...stored.addresses, ...SEED_ADDRESSES])].slice(0, MAX_INDEXED),
    discoveredAt: stored.discoveredAt,
  };
}

function saveIndex(index) {
  try {
    fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 1));
  } catch {
    // A read-only or racing filesystem must not stop the keeper; the index is
    // an optimisation, and discovery will simply run again next tick.
  }
}

/**
 * Auction addresses appearing in the program's recent transactions. Every
 * auction is touched when it opens, crosses and settles, so recent signatures
 * are a reliable way to find new ones.
 */
export async function discoverAuctions(connection, programId, txToScan = 14) {
  const sigs = await withRetry(() => connection.getSignaturesForAddress(programId, { limit: 40 }, "confirmed"));
  const candidates = new Set();

  for (const s of sigs.slice(0, txToScan)) {
    try {
      const tx = await withRetry(() =>
        connection.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" }),
      );
      for (const k of tx?.transaction?.message?.staticAccountKeys ?? []) candidates.add(k.toBase58());
    } catch {
      // One unreadable transaction does not spoil the scan.
    }
    await sleep(100);
  }

  const found = await readAuctions(connection, programId, [...candidates]);
  return found.map((a) => a.pubkey.toBase58());
}

/** Read the given addresses and keep the ones that really are auctions. */
export async function readAuctions(connection, programId, addresses) {
  if (addresses.length === 0) return [];
  const keys = addresses.map((a) => new PublicKey(a));
  const infos = await getAccountsBatched(connection, keys);

  const out = [];
  infos.forEach((info, i) => {
    if (info && info.data.length === AUCTION_SIZE && info.owner.equals(programId)) {
      out.push({ pubkey: keys[i], ...decodeAuction(info.data) });
    }
  });
  return out.sort((a, b) => b.openSlot - a.openSlot);
}

/**
 * Drop-in replacement for a getProgramAccounts-based listAuctions(mint).
 * Returns every known auction for the ticker, newest first, in the same shape
 * the keeper and the activity bot already expect: { pubkey, ...decoded }.
 */
export async function listAuctions(connection, programId, mint, { forceDiscover = false } = {}) {
  const index = loadIndex();
  const now = Date.now();

  if (forceDiscover || now - index.discoveredAt > DISCOVER_INTERVAL_MS || index.addresses.length === 0) {
    try {
      const found = await discoverAuctions(connection, programId);
      index.addresses = [...new Set([...found, ...index.addresses])].slice(0, MAX_INDEXED);
      index.discoveredAt = now;
      saveIndex(index);
    } catch {
      // Discovery is opportunistic. A failed scan still leaves the known
      // addresses readable, which is the whole point of keeping them.
    }
  }

  const all = await readAuctions(connection, programId, index.addresses);

  // Drop addresses that no longer resolve, so the index cannot grow forever
  // with dead entries.
  const live = new Set(all.map((a) => a.pubkey.toBase58()));
  if (live.size !== index.addresses.length) {
    saveIndex({ addresses: index.addresses.filter((a) => live.has(a)), discoveredAt: index.discoveredAt });
  }

  const want = mint.toBase58();
  return all.filter((a) => a.tickerMint.toBase58() === want);
}

/** Record an address the caller already knows about, e.g. one it just opened. */
export function rememberAuction(address) {
  const index = loadIndex();
  const key = typeof address === "string" ? address : address.toBase58();
  if (index.addresses.includes(key)) return;
  index.addresses = [key, ...index.addresses].slice(0, MAX_INDEXED);
  saveIndex(index);
}
