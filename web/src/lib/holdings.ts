// What a wallet holds, and the per-ticker facts needed to show it in shares
// and dollars: every token account it owns, each mint's scaled-UI multiplier,
// and each ticker's Pyth reference price.

import { Connection, PublicKey, type ParsedAccountData } from "@solana/web3.js";
import { useEffect, useState } from "react";
import type { TickerConfig } from "../config";
import { readPyth } from "../hooks";
import type { PythPrice } from "./pyth";

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022 = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

export interface WalletTokens {
  sol: number | null;
  /** Raw amount per mint, summed over the wallet's accounts for it. */
  raw: Map<string, bigint>;
}

export function useWalletTokens(conn: Connection, owner: PublicKey | null, refreshKey: number): WalletTokens | null {
  const [w, setW] = useState<WalletTokens | null>(null);
  const key = owner?.toBase58() ?? null;
  useEffect(() => setW(null), [key]);
  useEffect(() => {
    if (!owner) return;
    let dead = false;
    const load = async () => {
      try {
        const [sol, a, b] = await Promise.all([
          conn.getBalance(owner, "confirmed"),
          conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM }, "confirmed"),
          conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022 }, "confirmed"),
        ]);
        const raw = new Map<string, bigint>();
        for (const acc of [...a.value, ...b.value]) {
          const info = (acc.account.data as ParsedAccountData).parsed?.info;
          if (!info?.mint) continue;
          raw.set(info.mint, (raw.get(info.mint) ?? 0n) + BigInt(info.tokenAmount?.amount ?? "0"));
        }
        if (!dead) setW({ sol: sol / 1e9, raw });
      } catch {
        /* keep the last read */
      }
    };
    void load();
    const id = setInterval(() => !document.hidden && void load(), 20_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, key, refreshKey]);
  return w;
}

/** Scaled-UI multiplier per mint (shares per token). Missing until read. */
export function useMultipliers(conn: Connection, mints: string[]): Map<string, number> {
  const [m, setM] = useState<Map<string, number>>(new Map());
  const key = [...new Set(mints)].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let dead = false;
    const list = key.split(",");
    void (async () => {
      const out = new Map<string, number>();
      for (let i = 0; i < list.length; i += 100) {
        const chunk = list.slice(i, i + 100);
        const infos = await conn.getMultipleParsedAccounts(chunk.map((k) => new PublicKey(k)), { commitment: "confirmed" }).catch(() => null);
        infos?.value.forEach((info, j) => {
          const exts = ((info?.data as ParsedAccountData | undefined)?.parsed?.info?.extensions ?? []) as { extension: string; state: Record<string, unknown> }[];
          const cfg = exts.find((e) => e.extension === "scaledUiAmountConfig")?.state;
          if (!info) return;
          if (!cfg) return void out.set(chunk[j], 1);
          const now = Date.now() / 1000;
          const eff = now >= Number(cfg.newMultiplierEffectiveTimestamp ?? 0) ? Number(cfg.newMultiplier ?? cfg.multiplier) : Number(cfg.multiplier);
          out.set(chunk[j], Number.isFinite(eff) && eff > 0 ? eff : 1);
        });
      }
      if (!dead) setM(out);
    })();
    return () => {
      dead = true;
    };
  }, [conn, key]);
  return m;
}

/** Pyth reference per ticker symbol, read from mainnet every 30s. Absent for a ticker with no feed. */
export function usePythPrices(tickers: TickerConfig[]): Map<string, PythPrice> {
  const [p, setP] = useState<Map<string, PythPrice>>(new Map());
  const key = tickers.map((t) => `${t.symbol}:${t.pythAccount ?? ""}`).join(",");
  useEffect(() => {
    let dead = false;
    const load = async () => {
      const out = new Map<string, PythPrice>();
      await Promise.all(
        tickers
          .filter((t) => t.pythAccount)
          .map((t) =>
            readPyth(t.pythAccount!)
              .then((x) => void out.set(t.symbol, x))
              .catch(() => {}),
          ),
      );
      if (!dead) setP(out);
    };
    void load();
    const id = setInterval(() => !document.hidden && void load(), 30_000);
    return () => {
      dead = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return p;
}
