import { Connection, PublicKey } from "@solana/web3.js";
import { HERMES, PYTH_RECEIVER } from "./config";

// Pyth push-oracle PriceUpdateV2 (Full verification) layout, as read by
// uncross/programs/uncross/src/oracle.rs:
// disc 8 | write_authority 32 | verification u8 @40 | feed_id 32 @41 |
// price i64 @73 | conf u64 @81 | expo i32 @89 | publish_time i64 @93
export interface PythPrice {
  /** USD per share. */
  price: number;
  conf: number;
  expo: number;
  publishTime: number; // unix seconds
  feedId: string;
}

export function decodePriceUpdate(data: Uint8Array): PythPrice {
  if (data.length < 101) throw new Error("not a PriceUpdateV2 account");
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const raw = dv.getBigInt64(73, true);
  const conf = dv.getBigUint64(81, true);
  const expo = dv.getInt32(89, true);
  const scale = Math.pow(10, expo);
  return {
    price: Number(raw) * scale,
    conf: Number(conf) * scale,
    expo,
    publishTime: Number(dv.getBigInt64(93, true)),
    feedId: Array.from(data.subarray(41, 73), (x) => x.toString(16).padStart(2, "0")).join(""),
  };
}

export async function fetchPythPrice(conn: Connection, account: string): Promise<PythPrice> {
  const info = await conn.getAccountInfo(new PublicKey(account), "confirmed");
  if (!info) throw new Error("Pyth account not found");
  if (info.owner.toBase58() !== PYTH_RECEIVER) throw new Error("unexpected Pyth account owner");
  return decodePriceUpdate(info.data);
}

/** Market schedule string from Hermes metadata (works without an API key). */
export async function fetchSchedule(query: string, feedId: string): Promise<string | null> {
  const r = await fetch(`${HERMES}/v2/price_feeds?query=${encodeURIComponent(query)}&asset_type=equity`);
  if (!r.ok) throw new Error(`Hermes ${r.status}`);
  const feeds = (await r.json()) as { id: string; attributes: Record<string, string> }[];
  const f = feeds.find((x) => x.id.replace(/^0x/, "") === feedId);
  return f?.attributes?.schedule ?? null;
}
