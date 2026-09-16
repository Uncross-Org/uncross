import { Connection, PublicKey } from "@solana/web3.js";

// Auction is a zero-copy (repr(C), no implicit padding) account. This mirrors
// uncross/programs/uncross/src/state.rs and scripts/lib.mjs decodeAuction()
// byte for byte (offsets include the 8-byte discriminator). Never use Anchor's
// account fetch for it.
export const AUCTION_SIZE = 2880;
export const MAX_ORDERS = 64;

export type Side = "buy" | "sell";
export type AuctionStatus = "open" | "cleared" | "settled";
export type SettlePath = "none" | "clear" | "refund";
const STATUS: AuctionStatus[] = ["open", "cleared", "settled"];
const SETTLE_PATH: SettlePath[] = ["none", "clear", "refund"];

export interface OrderSummary {
  index: number;
  limitPrice: bigint;
  quantity: bigint;
  filledQuantity: bigint;
  quoteAmount: bigint;
  active: boolean;
  cancelled: boolean;
  side: Side;
}

export interface Auction {
  address: PublicKey;
  openSlot: number;
  closeSlot: number;
  freezeSlots: number;
  cadenceSlots: number;
  clearingPrice: bigint;
  executableVolume: bigint;
  referencePrice: bigint;
  indicativePrice: bigint;
  indicativeVolume: bigint;
  tickerMint: PublicKey;
  quoteMint: PublicKey;
  tickerTokenProgram: PublicKey;
  quoteTokenProgram: PublicKey;
  vaultTicker: PublicKey;
  vaultQuote: PublicKey;
  pythFeedId: string;
  protocolFeeBps: number;
  orderCount: number;
  settledCount: number;
  tickerDecimals: number;
  quoteDecimals: number;
  status: AuctionStatus;
  referencePriceSet: boolean;
  bump: number;
  settlePath: SettlePath;
  orders: OrderSummary[];
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function decodeAuction(address: PublicKey, data: Uint8Array): Auction {
  const b = data instanceof Uint8Array ? data : new Uint8Array(data);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u64 = (o: number) => dv.getBigUint64(o, true);
  const u16 = (o: number) => dv.getUint16(o, true);
  const key = (o: number) => new PublicKey(b.subarray(o, o + 32));
  const orderCount = u16(306);
  const orders: OrderSummary[] = [];
  for (let i = 0; i < Math.min(orderCount, MAX_ORDERS); i++) {
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
    address,
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
    pythFeedId: hex(b.subarray(272, 304)),
    protocolFeeBps: u16(304),
    orderCount,
    settledCount: u16(308),
    tickerDecimals: b[310],
    quoteDecimals: b[311],
    status: STATUS[b[312]] ?? "open",
    referencePriceSet: b[313] !== 0,
    bump: b[314],
    settlePath: SETTLE_PATH[b[315]] ?? "none",
    orders,
  };
}

const leBytes = (n: bigint | number, len: number) => {
  const out = new Uint8Array(len);
  let v = BigInt(n);
  for (let i = 0; i < len; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
};
const enc = new TextEncoder();

export function auctionPda(programId: PublicKey, tickerMint: PublicKey, openSlot: number | bigint): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("auction"), tickerMint.toBytes(), leBytes(openSlot, 8)], programId)[0];
}

export function orderPda(programId: PublicKey, auction: PublicKey, orderIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync([enc.encode("order"), auction.toBytes(), leBytes(orderIndex, 2)], programId)[0];
}

/** All current-layout auctions for a ticker, newest (highest openSlot) first. */
export async function fetchAuctions(conn: Connection, programId: PublicKey, tickerMint: PublicKey): Promise<Auction[]> {
  const accs = await conn.getProgramAccounts(programId, {
    commitment: "confirmed",
    filters: [{ dataSize: AUCTION_SIZE }, { memcmp: { offset: 80, bytes: tickerMint.toBase58() } }],
  });
  return accs
    .map((a) => decodeAuction(a.pubkey, a.account.data))
    .sort((a, b) => b.openSlot - a.openSlot);
}

export async function fetchAuction(conn: Connection, address: PublicKey): Promise<Auction | null> {
  const info = await conn.getAccountInfo(address, "confirmed");
  if (!info || info.data.length !== AUCTION_SIZE) return null;
  return decodeAuction(address, info.data);
}

export type Phase = "upcoming" | "open" | "freeze" | "awaiting-cross" | "cleared" | "settled";

export function auctionPhase(a: Auction, slot: number): Phase {
  if (a.status === "settled") return "settled";
  if (a.status === "cleared") return "cleared";
  if (slot < a.openSlot) return "upcoming";
  if (slot >= a.closeSlot) return "awaiting-cross";
  if (slot >= a.closeSlot - a.freezeSlots) return "freeze";
  return "open";
}

export const liveOrders = (a: Auction) => a.orders.filter((o) => o.active && !o.cancelled);
