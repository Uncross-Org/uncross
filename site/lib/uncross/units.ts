import { Connection, PublicKey, type ParsedAccountData } from "@solana/web3.js";

// The program works in raw units only:
//   limit/clearing price = quote atomic units (6 dp) per WHOLE raw ticker token (10^8 raw)
//   quantity             = raw ticker units
// xStocks carry Token-2022 scaledUiAmountConfig: UI amount = raw × m, and one UI
// share is one real share. Users think in shares and $/share, so everything
// shown converts through m.

export const RAW_PER_TOKEN = 100_000_000n; // 10^8, xStocks decimals
export const QUOTE_SCALE = 1_000_000; // 10^6, USDC decimals

export async function fetchMultiplier(conn: Connection, mint: PublicKey, nowSec = Date.now() / 1000): Promise<number> {
  const info = await conn.getParsedAccountInfo(mint, "confirmed");
  const data = info.value?.data as ParsedAccountData | undefined;
  const exts = (data?.parsed?.info?.extensions ?? []) as { extension: string; state: Record<string, unknown> }[];
  const cfg = exts.find((e) => e.extension === "scaledUiAmountConfig")?.state;
  if (!cfg) return 1;
  const m = Number(cfg.multiplier ?? 1);
  const nm = Number(cfg.newMultiplier ?? m);
  const ts = Number(cfg.newMultiplierEffectiveTimestamp ?? 0);
  const eff = nowSec >= ts ? nm : m;
  return Number.isFinite(eff) && eff > 0 ? eff : 1;
}

/** shares (UI) → raw ticker units. */
export const sharesToRaw = (shares: number, m: number): bigint => BigInt(Math.round((shares / m) * 1e8));
/** raw ticker units → shares (UI). */
export const rawToShares = (raw: bigint, m: number): number => (Number(raw) / 1e8) * m;
/** $ per share → program price (quote atomic per whole raw token). */
export const perShareToProgram = (usdPerShare: number, m: number): bigint => BigInt(Math.round(usdPerShare * m * QUOTE_SCALE));
/** program price → $ per share. */
export const programToPerShare = (p: bigint, m: number): number => Number(p) / m / QUOTE_SCALE;
/** quote atomic → dollars. */
export const quoteToUsd = (q: bigint): number => Number(q) / QUOTE_SCALE;

/** Mirrors clearing::escrow_for_buy: ceil(quantity × limit / 10^tickerDecimals). */
export function escrowForBuy(quantity: bigint, limitPrice: bigint, tickerDecimals = 8): bigint {
  const d = 10n ** BigInt(tickerDecimals);
  return (quantity * limitPrice + d - 1n) / d;
}
