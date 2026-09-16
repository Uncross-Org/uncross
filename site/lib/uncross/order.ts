import { Connection, PublicKey } from "@solana/web3.js";
import { orderPda, type Side } from "./auction";

// Order is a regular Borsh account:
// 8 disc | auction 32 @8 | owner 32 @40 | order_index u16 @72 | side u8 @74 |
// limit_price u64 @75 | quantity u64 @83 | escrow_amount u64 @91 |
// filled_quantity u64 @99 | cancelled @107 | settled @108 | refunded @109 | bump @110
export interface OrderAccount {
  address: PublicKey;
  auction: PublicKey;
  owner: PublicKey;
  orderIndex: number;
  side: Side;
  limitPrice: bigint;
  quantity: bigint;
  escrowAmount: bigint;
  filledQuantity: bigint;
  cancelled: boolean;
  settled: boolean;
  refunded: boolean;
}

export function decodeOrder(address: PublicKey, data: Uint8Array): OrderAccount {
  const b = data;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u64 = (o: number) => dv.getBigUint64(o, true);
  return {
    address,
    auction: new PublicKey(b.subarray(8, 40)),
    owner: new PublicKey(b.subarray(40, 72)),
    orderIndex: dv.getUint16(72, true),
    side: b[74] === 0 ? "buy" : "sell",
    limitPrice: u64(75),
    quantity: u64(83),
    escrowAmount: u64(91),
    filledQuantity: u64(99),
    cancelled: b[107] !== 0,
    settled: b[108] !== 0,
    refunded: b[109] !== 0,
  };
}

/** Fetches Order PDAs 0..count-1 of an auction (missing ones are skipped). */
export async function fetchOrders(conn: Connection, programId: PublicKey, auction: PublicKey, count: number): Promise<OrderAccount[]> {
  const keys = Array.from({ length: count }, (_, i) => orderPda(programId, auction, i));
  const out: OrderAccount[] = [];
  for (let k = 0; k < keys.length; k += 100) {
    const chunk = keys.slice(k, k + 100);
    const infos = await conn.getMultipleAccountsInfo(chunk, "confirmed");
    infos.forEach((info, j) => {
      if (info && info.data.length >= 111) out.push(decodeOrder(chunk[j], info.data));
    });
  }
  return out;
}
