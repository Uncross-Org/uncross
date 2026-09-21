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
// Endpoints, best first. A dedicated endpoint goes in RPC_URLS (or RPC_URL);
// the public one stays last as a fallback, so losing the dedicated endpoint
// degrades the venue rather than stopping it. The public endpoint alone
// rate-limits getProgramAccounts into uselessness for this program once more
// than one consumer is polling it.
export const RPC_URLS = (process.env.RPC_URLS ?? process.env.RPC_URL ?? process.env.DEVNET_RPC ?? "")
  .split(",")
  .map((u) => u.trim())
  .filter(Boolean)
  .concat("https://api.devnet.solana.com")
  .filter((u, i, all) => all.indexOf(u) === i);

/** The preferred endpoint. Kept as a single value for existing callers. */
export const RPC_URL = RPC_URLS[0];

/** Hostnames only: a dedicated endpoint's URL carries its API key. */
export const rpcHosts = () => RPC_URLS.map((u) => new URL(u).host);

// Failover across RPC_URLS. web3.js sends every request to the one endpoint a
// Connection was built with, so without this the list above was only ever its
// first entry. This fetch tries endpoints in order, skipping any that failed
// in the last minute; a network error, 429 or 5xx parks that endpoint and the
// same request goes to the next one. It also counts requests and 429s per RPC
// method, which is what the soak test reports.
const COOLDOWN_MS = 60_000;
const parkedUntil = new Map();
export const rpcStats = { since: Date.now(), requests: {}, rateLimited: {}, failovers: 0 };

export async function failoverFetch(_input, init) {
  let method = "?";
  try {
    const body = JSON.parse(init?.body ?? "{}");
    method = Array.isArray(body) ? `batch:${body[0]?.method}` : body.method;
  } catch {}
  rpcStats.requests[method] = (rpcStats.requests[method] ?? 0) + 1;

  const now = Date.now();
  const ready = RPC_URLS.filter((u) => (parkedUntil.get(u) ?? 0) <= now);
  const order = ready.length ? ready : RPC_URLS;
  let last;
  for (let i = 0; i < order.length; i++) {
    const url = order[i];
    const isLast = i === order.length - 1;
    try {
      const res = await fetch(url, init);
      if (res.status === 429) rpcStats.rateLimited[method] = (rpcStats.rateLimited[method] ?? 0) + 1;
      if ((res.status === 429 || res.status >= 500) && !isLast) {
        parkedUntil.set(url, Date.now() + COOLDOWN_MS);
        rpcStats.failovers++;
        last = res;
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      parkedUntil.set(url, Date.now() + COOLDOWN_MS);
      if (!isLast) rpcStats.failovers++;
    }
  }
  if (last instanceof Response) return last;
  throw last;
}

/** A devnet Connection that fails over across RPC_URLS. */
export function makeConnection(commitment = "confirmed") {
  return new Connection(RPC_URL, { commitment, fetch: failoverFetch });
}

/**
 * One line summarising rpcStats since process start: total requests, the
 * rate in requests/min, and any 429s by method. `label` names the process
 * (keeper, activity) so lines from each service can be told apart once both
 * are collected into one soak log.
 */
export function rpcStatsLine(label) {
  const mins = Math.max(1 / 60, (Date.now() - rpcStats.since) / 60_000);
  const total = Object.values(rpcStats.requests).reduce((a, b) => a + b, 0);
  const by = Object.entries(rpcStats.requests)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${m}=${n}`)
    .join(" ");
  const rl = Object.entries(rpcStats.rateLimited)
    .map(([m, n]) => `${m}=${n}`)
    .join(" ");
  return (
    `rpc stats [${label}] ${mins.toFixed(1)}min: ${total} req (${(total / mins).toFixed(2)}/min), ` +
    `429s: ${rl || "none"}, failovers: ${rpcStats.failovers} — by method: ${by || "none"}`
  );
}

export const TICKER_PROGRAM = TOKEN_2022_PROGRAM_ID;
export const QUOTE_PROGRAM = TOKEN_PROGRAM_ID;
export const ASSOCIATED_TOKEN_PROGRAM = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const STATUS = ["open", "cleared", "settled"];
export const SETTLE_PATH = ["none", "clear", "refund"];
/** GATE_* codes from programs/uncross/src/oracle.rs, by value. */
export const GATE = ["not recorded", "passed", "no feed configured", "wrong owner", "not a price update", "not fully verified", "wrong feed", "bad price", "stale", "confidence too wide", "multiplier unreadable"];

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Public RPCs rate-limit hard (HTTP 429). Retry anything that looks transient,
// with exponential backoff; rethrow real errors immediately.
const RETRYABLE = /429|Too Many|failed to get|fetch failed|ECONNRESET|ETIMEDOUT|socket hang up|502|503|aborted/i;
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

/**
 * Secret material by name, from the environment first and the local keyring
 * second.
 *
 * A hosted runner has no ~/.config/solana, so keys arrive as environment
 * variables holding the same JSON array a keypair file contains:
 *   deploy      -> KEYPAIR_DEPLOY
 *   wallet2     -> KEYPAIR_WALLET2
 *   mb-owners   -> KEYPAIR_MB_OWNERS
 * Hyphens become underscores and the name is upper-cased. The file path stays
 * the fallback so nothing changes for a local run.
 */
export function readKeyMaterial(name) {
  const envName = `KEYPAIR_${name.replace(/-/g, "_").toUpperCase()}`;
  const fromEnv = process.env[envName];
  if (fromEnv && fromEnv.trim()) return JSON.parse(fromEnv);
  return JSON.parse(fs.readFileSync(keypairPath(name), "utf8"));
}

export function loadKeypair(name) {
  return Keypair.fromSecretKey(Uint8Array.from(readKeyMaterial(name)));
}

/** A file holding an array of secret keys, such as the test order owners. */
export function loadKeypairArray(name) {
  return readKeyMaterial(name).map((secret) => Keypair.fromSecretKey(Uint8Array.from(secret)));
}

/** The venue's ticker registry (scripts/tickers.json). */
export function loadTickers() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "scripts/tickers.json"), "utf8"));
}

export function loadFixture() {
  const raw = JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, "scripts/devnet-fixture.json"), "utf8"),
  );
  return Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, new PublicKey(v)]),
  );
}

/**
 * The program's IDL. Read from idl/, which is committed, because target/ is
 * gitignored and a hosted runner builds from a clean checkout: loading from
 * target/idl would crash the keeper and bot on start. Regenerate with
 * `anchor build && cp target/idl/uncross.json idl/`.
 */
export function loadIdl() {
  return JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, "idl/uncross.json"), "utf8"));
}

export function getProgram(payerKeypair) {
  const connection = makeConnection();
  const provider = new AnchorProvider(connection, new Wallet(payerKeypair), {
    commitment: "confirmed",
  });
  return { program: new Program(loadIdl(), provider), connection, provider };
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
  // 63 summary slots; the 64th slot's bytes now hold the rent payer.
  for (let i = 0; i < Math.min(orderCount, 63); i++) {
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
    // Pyth gate outcome at the cross (GATE_* in oracle.rs; 0 = not recorded)
    // and the publish time of the price it examined.
    oracleGate: b[316],
    oraclePublishTime: Number(b.readBigInt64LE(2872)),
    // Who paid the rent, returned by close_auction. All-zero on auctions
    // created before the field existed, which can never be closed.
    payer: key(2840),
    hasPayer: b.subarray(2840, 2872).some((x) => x !== 0),
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
    // Sign only with keys this message actually requires: an optional signer
    // (e.g. a mint authority whose mint instruction was skipped) makes
    // web3.js throw "Cannot sign with non signer key".
    const required = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures);
    tx.sign([payer, ...signers].filter((s, i, all) =>
      required.some((k) => k.equals(s.publicKey)) && all.findIndex((x) => x.publicKey.equals(s.publicKey)) === i));
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
