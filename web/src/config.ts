// Single source of truth for the network, tickers and endpoints.
// Uncross runs on Solana devnet. The only mainnet access is a read-only fetch
// of the Pyth reference price (MAINNET_READ_RPCS, via the /api/rpc proxy).
// RPC endpoints can be overridden at build time with VITE_DEVNET_RPC /
// VITE_MAINNET_RPC.

export type ClusterName = "devnet";
import registry from "./tickers.json";

/** A ticker's symbol, e.g. "AAPLx". The set is uncross/scripts/tickers.json. */
export type TickerSymbol = string;

export const PROGRAM_ID = "Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP";

/** Pyth Solana Receiver program: owner of every PriceUpdateV2 account. */
export const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
export const HERMES = "https://hermes.pyth.network";
/** A Pyth print older than this is not a live reference (matches the program's ORACLE_MAX_AGE_SECS). */
export const ORACLE_MAX_AGE_SECS = 90;

/** settle_batch orders per transaction: the measured size limit with distinct owners. */
export const SETTLE_BATCH = 7;

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

/**
 * The public mainnet RPC returns 403 to browser-origin requests, so in the
 * browser mainnet goes through the same-origin proxy at /api/rpc (a Vercel
 * Edge function in production, the Vite server's proxy locally).
 * VITE_MAINNET_RPC overrides it with a direct endpoint.
 */
const MAINNET_PROXY = typeof window !== "undefined" ? `${window.location.origin}/api/rpc` : null;

export const MAINNET_RPC = env.VITE_MAINNET_RPC || MAINNET_PROXY || "https://api.mainnet-beta.solana.com";
export const DEVNET_RPC = env.VITE_DEVNET_RPC || "https://api.devnet.solana.com";

/** An HTTP proxy cannot carry websocket subscriptions; poll instead. */
export const supportsWebsocket = (rpcEndpoint: string) => !rpcEndpoint.endsWith("/api/rpc");

/** Mainnet endpoints for the Pyth reference read, tried in order until one answers. */
export const MAINNET_READ_RPCS: string[] = Array.from(
  new Set(
    [env.VITE_MAINNET_RPC, MAINNET_PROXY, "https://solana-rpc.publicnode.com", "https://api.mainnet-beta.solana.com"].filter(
      (u): u is string => !!u,
    ),
  ),
);

export interface TickerConfig {
  symbol: TickerSymbol;
  name: string;
  underlying: string;
  /** Token-2022 ticker mint on this cluster; null = not deployed here yet. */
  mint: string | null;
  /** Mainnet PriceUpdateV2 account; null = no on-chain Pyth price on Solana. */
  pythAccount: string | null;
  pythFeedId: string;
  hermesQuery: string;
}

export interface ClusterConfig {
  name: ClusterName;
  label: string;
  rpc: string;
  quoteMint: string;
  quoteSymbol: string;
  explorerSuffix: string;
  tickers: Record<TickerSymbol, TickerConfig>;
}

export const CLUSTERS: Record<ClusterName, ClusterConfig> = {
  devnet: {
    name: "devnet",
    label: "Devnet",
    rpc: DEVNET_RPC,
    quoteMint: registry.quoteMint, // USDC-shaped fixture, legacy SPL, 6 dp
    quoteSymbol: "USDC",
    explorerSuffix: "?cluster=devnet",
    tickers: Object.fromEntries(
      registry.tickers.map((t) => [
        t.symbol,
        { symbol: t.symbol, name: t.name, underlying: t.underlying, mint: t.devnetMint, pythAccount: t.pythAccount, pythFeedId: t.pythFeedId, hermesQuery: t.underlying },
      ]),
    ),
  },
};

/** The network auctions run and settle on. */
export const CLUSTER: ClusterConfig = CLUSTERS.devnet;

export const TICKERS: TickerSymbol[] = registry.tickers.map((t) => t.symbol);

export function tickerFromUrl(): TickerSymbol {
  if (typeof window === "undefined") return "AAPLx";
  const t = new URLSearchParams(window.location.search).get("ticker");
  // Any listed ticker, not only the ten compiled in; the listing is checked once it loads.
  if (!UNIVERSE_ENABLED) return t && TICKERS.includes(t) ? t : "AAPLx";
  return t && /^[A-Za-z0-9.]{1,16}$/.test(t) ? t : "AAPLx";
}

export const explorerTx = (c: ClusterConfig, sig: string) => `https://explorer.solana.com/tx/${sig}${c.explorerSuffix}`;
export const explorerAddr = (c: ClusterConfig, a: string) => `https://explorer.solana.com/address/${a}${c.explorerSuffix}`;

/**
 * The test-token faucet (uncross/scripts/faucet.mjs).
 *
 * The fixture mints are ours, so a visitor cannot obtain shares or quote
 * dollars anywhere else: without this a new wallet can watch an auction and
 * nothing more. The service runs on Railway, because its signing keys must
 * stay in a server environment — but the browser reaches it at this origin
 * through the site's /api/faucet rewrite, because some networks block
 * *.up.railway.app (ours does) and a participant on one of those would find
 * the single action they need silently broken.
 */
/** The whole xStocks listing — search across every ticker, and opening an
 *  auction on a dormant one. Off unless the build sets VITE_UNIVERSE=1: opening
 *  an auction needs the faucet's /auction/open, which ships separately. */
export const UNIVERSE_ENABLED = env.VITE_UNIVERSE === "1";

export const FAUCET_URL = (import.meta.env.VITE_FAUCET_URL as string | undefined)?.replace(/\/$/, "") ?? "";
