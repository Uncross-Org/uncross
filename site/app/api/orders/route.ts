// One wallet's orders, across every auction and ticker, with what settled.
//
// The dashboard used to show a wallet's orders only for the ticker's newest
// auction, so the moment the keeper opened the next one — seconds after a
// cross, before settlement had even landed — the result disappeared. This
// starts from the wallet instead. Order accounts are never closed (see the
// Order struct in the program), so they are the durable record of every order
// a wallet has placed, found here by owner.
//
// For each order it returns:
//   - the order account and its auction's account, raw, decoded in the browser
//     with the same decoders as everything else; the auction is null once it
//     has been closed and its rent returned;
//   - the transaction that placed it, and the one that settled, refunded or
//     cancelled it, with this wallet's token movements in that transaction.
//     What a participant got back is read from those movements, never from
//     the order's `refunded` flag, which the program sets only on the failure
//     path: an unfilled order whose escrow came back in full reads false.
//
// getProgramAccounts by owner needs the dedicated endpoint; the public devnet
// RPC refuses it for this program. So this runs server-side, where the key
// stays. Settled orders cannot change, so their transactions are cached.

import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { CLUSTER, PROGRAM_ID } from "@/lib/uncross/config";
import { AUCTION_SIZE } from "@/lib/uncross/auction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORDER_SIZE = 111;
/** Orders looked up per request; the rest are read by the next poll. */
const MAX_LOOKUPS = 24;

interface TxRef {
  sig: string;
  /** Unix seconds. */
  time: number | null;
}
interface Settlement extends TxRef {
  kind: "settle" | "refund" | "cancel";
  /** This wallet's net movement in that transaction, raw units, as strings. */
  quoteDelta: string;
  tickerDelta: string;
  /** How many of this wallet's orders the same transaction settled; above 1, the movements are their total. */
  ordersInTx: number;
}
interface WireOrder {
  address: string;
  data: string;
  auction: string;
  /** The ticker mint, from the auction, or from the order's own transfers once the auction is closed. */
  tickerMint: string | null;
  placed: TxRef | null;
  settled: Settlement | null;
}

const done = new Map<string, { placed: TxRef | null; settled: Settlement }>();
const mintOf = new Map<string, string>();
const placedOf = new Map<string, TxRef>();

/** Run tasks with at most `n` in flight. */
async function pool(tasks: (() => Promise<void>)[], n: number) {
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const t = tasks[next++];
      await t().catch(() => {});
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, worker));
}
/** Confirmed transactions never change; kept so a poll does not refetch them. */
const txCache = new Map<string, VersionedTransactionResponse>();
async function getTx(conn: Connection, sig: string): Promise<VersionedTransactionResponse | null> {
  const hit = txCache.get(sig);
  if (hit) return hit;
  const tx = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  if (tx) {
    if (txCache.size > 5000) txCache.clear();
    txCache.set(sig, tx);
  }
  return tx;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const INSTR: Record<string, Settlement["kind"]> = { SettleBatch: "settle", CancelAndRefund: "refund", CancelOrder: "cancel" };

function kindOf(tx: VersionedTransactionResponse): Settlement["kind"] | "place" | null {
  for (const l of tx.meta?.logMessages ?? []) {
    const m = l.match(/^Program log: Instruction: (\w+)$/);
    if (!m) continue;
    if (m[1] === "PlaceOrder") return "place";
    if (INSTR[m[1]]) return INSTR[m[1]];
  }
  return null;
}

function movement(tx: VersionedTransactionResponse, owner: string, mint: string): bigint {
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];
  const sum = (xs: typeof pre) => xs.filter((b) => b.owner === owner && b.mint === mint).reduce((s, b) => s + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(post) - sum(pre);
}

async function events(conn: Connection, owner: string, order: string, tickerMint: string, siblings: Set<string>) {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(order), { limit: 20 }, "confirmed");
  let placed: TxRef | null = null;
  let settled: Settlement | null = null;
  for (const s of sigs) {
    if (s.err) continue;
    const tx = await getTx(conn, s.signature);
    if (!tx) continue;
    const kind = kindOf(tx);
    if (kind === "place") placed = { sig: s.signature, time: tx.blockTime ?? null };
    else if (kind && !settled) {
      const keys = tx.transaction.message.staticAccountKeys.map((k) => k.toBase58());
      settled = {
        sig: s.signature,
        time: tx.blockTime ?? null,
        kind,
        quoteDelta: String(movement(tx, owner, CLUSTER.quoteMint)),
        tickerDelta: String(movement(tx, owner, tickerMint)),
        ordersInTx: keys.filter((k) => siblings.has(k)).length || 1,
      };
    }
  }
  return { placed, settled };
}

export async function GET(req: Request): Promise<Response> {
  const ownerParam = new URL(req.url).searchParams.get("owner") ?? "";
  let owner: PublicKey;
  try {
    owner = new PublicKey(ownerParam);
  } catch {
    return Response.json({ error: "owner must be a wallet address" }, { status: 400 });
  }
  const conn = new Connection(CLUSTER.rpc, "confirmed");
  const program = new PublicKey(PROGRAM_ID);
  try {
    const accs = await conn.getProgramAccounts(program, {
      commitment: "confirmed",
      filters: [{ dataSize: ORDER_SIZE }, { memcmp: { offset: 40, bytes: owner.toBase58() } }],
    });
    const orders = accs.map((a) => ({ address: a.pubkey.toBase58(), raw: a.account.data, auction: new PublicKey(a.account.data.subarray(8, 40)).toBase58() }));

    const auctionKeys = [...new Set(orders.map((o) => o.auction))];
    const auctions: Record<string, string | null> = {};
    const openSlot: Record<string, number> = {};
    const tickerMint: Record<string, string> = {};
    for (let i = 0; i < auctionKeys.length; i += 100) {
      const chunk = auctionKeys.slice(i, i + 100);
      const infos = await conn.getMultipleAccountsInfo(chunk.map((k) => new PublicKey(k)), "confirmed");
      infos.forEach((info, j) => {
        const k = chunk[j];
        const live = info && info.data.length === AUCTION_SIZE && info.owner.equals(program);
        auctions[k] = live ? b64(info.data) : null;
        if (live) {
          openSlot[k] = Number(info.data.readBigUInt64LE(8));
          tickerMint[k] = new PublicKey(info.data.subarray(80, 112)).toBase58();
        }
      });
    }
    // A closed auction's ticker is still named by the order's own settlement
    // transfers; the vault's mint is not needed to read this wallet's side.
    const siblingsOf = new Map<string, Set<string>>();
    for (const o of orders) siblingsOf.set(o.auction, new Set([...(siblingsOf.get(o.auction) ?? []), o.address]));

    // Newest auctions first; closed ones (no slot left to sort by) after.
    orders.sort((a, b) => (openSlot[b.auction] ?? -1) - (openSlot[a.auction] ?? -1));

    // What each order still needs looked up. A settled order's transactions
    // never change, so once read they are cached for good. An order in an
    // auction still taking orders cannot have settled: only its placement is
    // read, once. Everything else — crossed, settling, or closed — is read in
    // full. Lookups run eight at a time and stop at MAX_LOOKUPS per request; a
    // later poll carries on from where this one stopped.
    const auctionOpen = (k: string) => auctions[k] != null && Buffer.from(auctions[k]!, "base64")[312] === 0;
    const results = new Map<string, { placed: TxRef | null; settled: Settlement | null }>();
    const todo: (() => Promise<void>)[] = [];
    let pending = 0;
    for (const o of orders) {
      const cached = done.get(o.address);
      if (cached) {
        results.set(o.address, cached);
        continue;
      }
      const openOnly = auctionOpen(o.auction) && o.raw[107] === 0;
      if (openOnly && placedOf.has(o.address)) {
        results.set(o.address, { placed: placedOf.get(o.address)!, settled: null });
        continue;
      }
      if (todo.length >= MAX_LOOKUPS) {
        pending++;
        continue;
      }
      todo.push(async () => {
        let mint: string | null = tickerMint[o.auction] ?? mintOf.get(o.address) ?? null;
        if (mint === null) mint = (await mintFromHistory(conn, o.address)) || null;
        if (mint) mintOf.set(o.address, mint);
        const ev = await events(conn, owner.toBase58(), o.address, mint ?? "", siblingsOf.get(o.auction)!);
        results.set(o.address, ev);
        if (ev.placed) placedOf.set(o.address, ev.placed);
        if (o.raw[108] !== 0 && ev.settled) done.set(o.address, { placed: ev.placed, settled: ev.settled });
      });
    }
    await pool(todo, 8);
    const out: WireOrder[] = orders.map((o) => {
      const ev = results.get(o.address);
      return {
        address: o.address,
        data: b64(o.raw),
        auction: o.auction,
        tickerMint: tickerMint[o.auction] ?? mintOf.get(o.address) ?? null,
        placed: ev?.placed ?? null,
        settled: ev?.settled ?? null,
      };
    });
    const slot = await conn.getSlot("confirmed").catch(() => null);
    return Response.json(
      { readAt: Date.now(), slot, owner: owner.toBase58(), orders: out, auctions, truncated: pending > 0 },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}

/** A closed auction's ticker mint, from the order's placement: the non-quote mint this wallet moved. */
async function mintFromHistory(conn: Connection, order: string): Promise<string> {
  const sigs = await conn.getSignaturesForAddress(new PublicKey(order), { limit: 20 }, "confirmed");
  for (const s of sigs.reverse()) {
    const tx = await getTx(conn, s.signature);
    const mints = new Set([...(tx?.meta?.preTokenBalances ?? []), ...(tx?.meta?.postTokenBalances ?? [])].map((b) => b.mint));
    for (const m of mints) if (m !== CLUSTER.quoteMint) return m;
  }
  return "";
}
