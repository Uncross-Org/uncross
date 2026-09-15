import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const {
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} = anchor.web3;

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");
export const RPC_URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";

export const TICKER_PROGRAM = TOKEN_2022_PROGRAM_ID;
export const QUOTE_PROGRAM = TOKEN_PROGRAM_ID;
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const STATUS = ["open", "cleared", "settled"];
export const SETTLE_PATH = ["none", "clear", "refund"];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Public RPCs rate-limit hard (HTTP 429). Retry anything that looks transient,
// with exponential backoff; rethrow real errors immediately.
const RETRYABLE = /429|Too Many|failed to get|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|502|503/i;
export async function withRetry(fn, tries = 7) {
  let delay = 500;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= tries || !RETRYABLE.test(String(e?.message ?? e))) throw e;
      await sleep(delay);
      delay = Math.min(delay * 2, 8000);
    }
  }
}

export function keypairPath(name) {
  return path.join(os.homedir(), ".config/solana/uncross", `${name}.json`);
}

export function loadKeypair(name) {
  const secret = JSON.parse(fs.readFileSync(keypairPath(name), "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function loadFixture() {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scripts/devnet-fixture.json"), "utf8"),
  );
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, new PublicKey(v)]),
  );
}

export function getProgram(payerKeypair) {
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(payerKeypair), {
    commitment: "confirmed",
  });
  const idl = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "target/idl/uncross.json"), "utf8"),
  );
  return { program: new Program(idl, provider), connection, provider };
}

export function auctionPda(programId, tickerMint, openSlot) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("auction"), tickerMint.toBuffer(), new BN(openSlot).toArrayLike(Buffer, "le", 8)],
    programId,
  )[0];
}

export function orderPda(programId, auction, orderIndex) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), auction.toBuffer(), new BN(orderIndex).toArrayLike(Buffer, "le", 2)],
    programId,
  )[0];
}

export const tickerAta = (owner, mint) =>
  getAssociatedTokenAddressSync(mint, owner, true, TICKER_PROGRAM);
export const quoteAta = (owner, mint) =>
  getAssociatedTokenAddressSync(mint, owner, true, QUOTE_PROGRAM);
export const vaultTickerAta = (auction, mint) => tickerAta(auction, mint);
export const vaultQuoteAta = (auction, mint) => quoteAta(auction, mint);

// Auction is a zero-copy (repr(C), no implicit padding) account; this mirrors
// programs/uncross/src/state.rs byte for byte, after the 8-byte discriminator.
export function decodeAuction(data) {
  const b = Buffer.from(data);
  const u64 = (o) => b.readBigUInt64LE(o);
  const key = (o) => new PublicKey(b.subarray(o, o + 32));
  const orderCount = b.readUInt16LE(306);
  const orders = [];
  for (let i = 0; i < orderCount; i++) {
    const o = 320 + i * 40;
    orders.push({
      index: i,
      limitPrice: u64(o),
      quantity: u64(o + 8),
      filledQuantity: u64(o + 16),
      quoteAmount: u64(o + 24),
      active: b[o + 32] !== 0,
      cancelled: b[o + 33] !== 0,
      side: b[o + 34] === 0 ? "buy" : "sell",
    });
  }
  return {
    openSlot: Number(u64(8)),
    closeSlot: Number(u64(16)),
    freezeSlots: Number(u64(24)),
    cadenceSlots: Number(u64(32)),
    clearingPrice: u64(40),
    executableVolume: u64(48),
    referencePrice: u64(56),
    indicativePrice: u64(64),
    indicativeVolume: u64(72),
    tickerMint: key(80),
    quoteMint: key(112),
    tickerTokenProgram: key(144),
    quoteTokenProgram: key(176),
    vaultTicker: key(208),
    vaultQuote: key(240),
    pythFeedId: b.subarray(272, 304).toString("hex"),
    protocolFeeBps: b.readUInt16LE(304),
    orderCount,
    settledCount: b.readUInt16LE(308),
    tickerDecimals: b[310],
    quoteDecimals: b[311],
    status: STATUS[b[312]],
    referencePriceSet: b[313] !== 0,
    bump: b[314],
    settlePath: SETTLE_PATH[b[315]],
    orders,
  };
}

export async function fetchAuction(connection, auction) {
  const info = await withRetry(() => connection.getAccountInfo(auction, "confirmed"));
  if (!info) throw new Error(`auction ${auction.toBase58()} not found`);
  return decodeAuction(info.data);
}

export async function getAccountsBatched(connection, keys) {
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    out.push(...(await withRetry(() => connection.getMultipleAccountsInfo(chunk, "confirmed"))));
  }
  return out;
}

// SPL Token and Token-2022 token accounts share the base layout: amount is the
// u64 at byte 64. Missing account => 0.
export const tokenAmountOf = (info) =>
  info && info.data.length >= 72 ? info.data.readBigUInt64LE(64) : 0n;

export async function tokenAmount(connection, ata) {
  const [info] = await getAccountsBatched(connection, [ata]);
  return tokenAmountOf(info);
}

// Sends instructions as a v0 transaction, simulating first so every call
// reports compute units and wire size alongside its signature.
export async function sendV0(connection, payer, signers, ixs, { cuLimit = 400_000 } = {}) {
  const all = [ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }), ...ixs];
  const build = async () => {
    const { blockhash, lastValidBlockHeight } = await withRetry(() =>
      connection.getLatestBlockhash("confirmed"),
    );
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: blockhash,
      instructions: all,
    }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign([payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey))]);
    return { tx, blockhash, lastValidBlockHeight };
  };
  const { tx } = await build();
  const size = tx.serialize().length;
  const sim = await withRetry(() => connection.simulateTransaction(tx, { sigVerify: false }));
  if (sim.value.err) {
    const err = new Error(`simulation failed: ${JSON.stringify(sim.value.err)}`);
    err.logs = sim.value.logs;
    err.cu = sim.value.unitsConsumed;
    throw err;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const { tx: fresh, lastValidBlockHeight } = await build();
    // Retrying the same signed transaction is safe: a duplicate signature
    // cannot execute twice.
    const sig = await withRetry(() => connection.sendTransaction(fresh, { skipPreflight: true, maxRetries: 5 }));
    const res = await confirmByPolling(connection, sig, lastValidBlockHeight);
    if (res.expired) continue;
    if (res.err) {
      const err = new Error(`transaction failed: ${JSON.stringify(res.err)} (${sig})`);
      err.sig = sig;
      throw err;
    }
    return { sig, cu: sim.value.unitsConsumed, size };
  }
  throw new Error("could not land transaction");
}

// Confirms over plain HTTP. web3.js's confirmTransaction races a websocket
// against internal polling; on a rate-limited public RPC either side can reject
// after the other has resolved, escaping as an unhandled rejection that kills
// the process. Polling getSignatureStatuses ourselves keeps every call awaited.
async function confirmByPolling(connection, sig, lastValidBlockHeight) {
  for (;;) {
    const { value } = await withRetry(() => connection.getSignatureStatuses([sig]));
    const st = value[0];
    if (st?.err) return { err: st.err };
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return { err: null };
    const height = await withRetry(() => connection.getBlockHeight("confirmed"));
    if (height > lastValidBlockHeight) return { expired: true };
    await sleep(1200);
  }
}

export async function waitForSlot(connection, target, label) {
  process.stdout.write(`  waiting for slot ${target} (${label})`);
  for (;;) {
    const s = await withRetry(() => connection.getSlot("confirmed"));
    if (s >= target) {
      console.log(` -- reached ${s}`);
      return s;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
}
