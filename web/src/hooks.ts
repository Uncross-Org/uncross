import { Connection, PublicKey } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MAINNET_READ_RPCS, PROGRAM_ID, supportsWebsocket, type TickerConfig } from "./config";
import { decodeAuction, fetchAuctions, type Auction } from "./lib/auction";
import { fetchOrders, type OrderAccount } from "./lib/order";
import { fetchPythPrice, fetchSchedule, type PythPrice } from "./lib/pyth";
import { parseSchedule, type Schedule } from "./lib/schedule";
import { fetchMultiplier } from "./lib/units";
import { quoteAta, tickerAta } from "./lib/tx";

export const PROGRAM = new PublicKey(PROGRAM_ID);
const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  if (/429|rate limit/i.test(m)) return "the network's public RPC is rate-limiting requests";
  if (/403|forbidden/i.test(m)) return "the RPC endpoint refused access";
  if (/fetch|network/i.test(m)) return "network unreachable";
  return m.length > 120 ? m.slice(0, 120) + "…" : m;
};

/** Run fn now and every ms while the tab is visible. */
function usePoll(fn: () => void | Promise<void>, ms: number, deps: unknown[]) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    void ref.current();
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) void ref.current();
    }, ms);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Current slot (interpolated between polls) and average slot time. */
export function useSlotClock(conn: Connection, now: number) {
  const [base, setBase] = useState<{ slot: number; t: number } | null>(null);
  const [slotMs, setSlotMs] = useState(400);
  usePoll(
    async () => {
      try {
        const slot = await conn.getSlot("confirmed");
        setBase({ slot, t: Date.now() });
      } catch {
        /* keep last */
      }
    },
    12_000,
    [conn],
  );
  usePoll(
    async () => {
      try {
        const samples = await conn.getRecentPerformanceSamples(10);
        const slots = samples.reduce((s, x) => s + x.numSlots, 0);
        const secs = samples.reduce((s, x) => s + x.samplePeriodSecs, 0);
        if (slots > 0) setSlotMs((secs * 1000) / slots);
      } catch {
        /* keep default */
      }
    },
    120_000,
    [conn],
  );
  const slot = base ? base.slot + Math.floor((now - base.t) / slotMs) : null;
  return { slot, slotMs };
}

export function useMultiplier(conn: Connection, mint: PublicKey | null) {
  const [m, setM] = useState<number | null>(null);
  const key = mint?.toBase58();
  useEffect(() => setM(null), [key]);
  usePoll(
    async () => {
      if (!mint) return;
      try {
        setM(await fetchMultiplier(conn, mint));
      } catch {
        setM((x) => x ?? null);
      }
    },
    300_000,
    [conn, key],
  );
  return m;
}

// Pyth reads rotate through MAINNET_READ_RPCS, sticking with whichever last worked.
const mainnetConns = MAINNET_READ_RPCS.map((u) => new Connection(u, { commitment: "confirmed", disableRetryOnRateLimit: true }));
let mainnetIdx = 0;
async function readPyth(account: string): Promise<PythPrice> {
  let last: unknown = null;
  for (let k = 0; k < mainnetConns.length; k++) {
    const i = (mainnetIdx + k) % mainnetConns.length;
    try {
      const p = await fetchPythPrice(mainnetConns[i], account);
      mainnetIdx = i;
      return p;
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("no mainnet RPC reachable");
}

export interface PythState {
  hasFeed: boolean;
  price: PythPrice | null;
  schedule: Schedule | null;
  error: string | null;
  loading: boolean;
}

/** Pyth reference: always read from mainnet, whatever the app cluster. */
export function usePyth(tk: TickerConfig): PythState {
  const [price, setPrice] = useState<PythPrice | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    setPrice(null);
    setError(null);
    setLoading(!!tk.pythAccount);
  }, [tk.pythAccount]);
  usePoll(
    async () => {
      if (!tk.pythAccount) return;
      try {
        setPrice(await readPyth(tk.pythAccount));
        setError(null);
      } catch (e) {
        setError(errMsg(e));
      } finally {
        setLoading(false);
      }
    },
    12_000,
    [tk.pythAccount],
  );
  usePoll(
    async () => {
      try {
        const s = await fetchSchedule(tk.hermesQuery, tk.pythFeedId);
        setSchedule(s ? parseSchedule(s) : null);
      } catch {
        /* schedule is optional context */
      }
    },
    3_600_000,
    [tk.pythFeedId],
  );
  return { hasFeed: !!tk.pythAccount, price, schedule, error, loading };
}

/** All auctions for a ticker; the newest is live-subscribed with a polling fallback. */
export function useVenue(conn: Connection, mint: PublicKey | null) {
  const [auctions, setAuctions] = useState<Auction[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = mint?.toBase58() ?? null;

  // Auctions known by address — one this visitor just opened — kept in view
  // until the cached venue read (refreshed every 10s) includes them.
  const adopted = useRef<Set<string>>(new Set());

  useEffect(() => {
    setAuctions(null);
    setError(null);
    adopted.current = new Set();
  }, [key, conn]);

  const reload = useCallback(async () => {
    if (!key) return;
    let list: Auction[] = [];
    let failed: unknown = null;
    try {
      list = await fetchAuctions(conn, PROGRAM, new PublicKey(key));
    } catch (e) {
      failed = e;
    }
    for (const k of adopted.current) {
      if (list.some((a) => a.address.toBase58() === k)) continue;
      const info = await conn.getAccountInfo(new PublicKey(k), "confirmed").catch(() => null);
      if (info) list = [decodeAuction(new PublicKey(k), info.data), ...list];
      else adopted.current.delete(k);
    }
    if (failed && list.length === 0) return setError(errMsg(failed));
    setAuctions(list.sort((a, b) => b.openSlot - a.openSlot));
    setError(null);
  }, [conn, key]);

  const adopt = useCallback(
    async (address: string) => {
      adopted.current.add(address);
      await reload();
    },
    [reload],
  );

  usePoll(reload, 30_000, [reload]);

  const current = auctions?.[0] ?? null;
  const currentKey = current?.address.toBase58() ?? null;
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  const refreshCurrent = useCallback(async () => {
    if (!currentKey) return;
    const pk = new PublicKey(currentKey);
    const info = await conn.getAccountInfo(pk, "confirmed");
    if (info) apply(pk, info.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, currentKey]);

  function apply(pk: PublicKey, data: Uint8Array) {
    const a = decodeAuction(pk, data);
    setLastUpdate(Date.now());
    setAuctions((prev) => (prev ? prev.map((x) => (x.address.equals(pk) ? a : x)) : prev));
  }

  useEffect(() => {
    if (!currentKey) return;
    const pk = new PublicKey(currentKey);
    const ws = supportsWebsocket(conn.rpcEndpoint);
    let sub: number | null = null;
    if (ws) {
      try {
        sub = conn.onAccountChange(pk, (info) => apply(pk, info.data), "confirmed");
      } catch {
        sub = null;
      }
    }
    const id = setInterval(() => {
      if (!document.hidden) void refreshCurrent().catch(() => {});
    }, ws ? 8_000 : 4_000);
    return () => {
      clearInterval(id);
      if (sub !== null) void conn.removeAccountChangeListener(sub).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, currentKey, refreshCurrent]);

  return { auctions, current, error, reload, refreshCurrent, lastUpdate, adopt };
}

/** Every ticker's auctions from the site's cached venue read, for the parts of
 *  the shell that show the whole venue (the sidebar). One request, decoded with
 *  the same decoder; empty under the Vite dev server, which has no route. */
export function useVenueAll(): { auctions: Auction[]; loading: boolean } {
  const [auctions, setAuctions] = useState<Auction[] | null>(null);
  usePoll(
    async () => {
      try {
        const r = await fetch("/api/venue", { cache: "no-store" });
        if (!r.ok) return;
        const payload = (await r.json()) as { auctions?: { address: string; data?: string }[] };
        setAuctions(
          (payload.auctions ?? [])
            .filter((w) => typeof w.data === "string")
            .map((w) => decodeAuction(new PublicKey(w.address), Uint8Array.from(atob(w.data as string), (c) => c.charCodeAt(0)))),
        );
      } catch {
        /* keep the last read */
      }
    },
    15_000,
    [],
  );
  return useMemo(() => ({ auctions: auctions ?? [], loading: auctions === null }), [auctions]);
}

/** Order accounts of an auction, refetched whenever the book changes. */
export function useOrders(conn: Connection, auction: Auction | null, refreshKey: number) {
  const [orders, setOrders] = useState<OrderAccount[]>([]);
  const sig = auction ? `${auction.address.toBase58()}:${auction.orderCount}:${auction.settledCount}:${auction.status}:${refreshKey}` : null;
  const addr = auction?.address.toBase58();
  useEffect(() => setOrders([]), [addr]);
  useEffect(() => {
    if (!auction) return;
    let dead = false;
    fetchOrders(conn, PROGRAM, auction.address, auction.orderCount)
      .then((o) => !dead && setOrders(o))
      .catch(() => {});
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, sig]);
  return orders;
}

export interface Balances {
  sol: number | null;
  tickerRaw: bigint | null; // null = no token account yet
  quoteRaw: bigint | null;
}

export function useBalances(conn: Connection, owner: PublicKey | null, tickerMint: PublicKey | null, quoteMint: PublicKey, refreshKey: number) {
  const [b, setB] = useState<Balances>({ sol: null, tickerRaw: null, quoteRaw: null });
  const ownerKey = owner?.toBase58();
  const tKey = tickerMint?.toBase58();
  useEffect(() => setB({ sol: null, tickerRaw: null, quoteRaw: null }), [ownerKey, tKey]);
  const amount = async (ata: PublicKey) => {
    try {
      return BigInt((await conn.getTokenAccountBalance(ata, "confirmed")).value.amount);
    } catch {
      return null;
    }
  };
  usePoll(
    async () => {
      if (!owner) return;
      const [sol, t, q] = await Promise.all([
        conn.getBalance(owner, "confirmed").catch(() => null),
        tickerMint ? amount(tickerAta(owner, tickerMint)) : Promise.resolve(null),
        amount(quoteAta(owner, quoteMint)),
      ]);
      setB({ sol: sol == null ? null : sol / 1e9, tickerRaw: t, quoteRaw: q });
    },
    20_000,
    [conn, ownerKey, tKey, refreshKey],
  );
  return b;
}

export function useTheme() {
  const [theme, setTheme] = useState<"dark" | "light">(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("uncross-theme", theme);
    } catch {
      /* private mode */
    }
  }, [theme]);
  const toggle = useCallback(() => setTheme((t) => (t === "dark" ? "light" : "dark")), []);
  return useMemo(() => ({ theme, toggle }), [theme, toggle]);
}
