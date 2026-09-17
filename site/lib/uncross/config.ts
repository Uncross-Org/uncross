// Single source of truth for the network, tickers and endpoints.
// Uncross runs on Solana devnet. The only mainnet access is a read-only fetch
// of the Pyth reference price, which in the browser goes through the
// same-origin proxy at /api/rpc.

export type ClusterName = "devnet";
import registry from "./tickers.json";

/** A ticker's symbol, e.g. "AAPLx". The set is scripts/tickers.json. */
export type TickerSymbol = string;


export const PROGRAM_ID = "Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP";

/** Pyth Solana Receiver program: owner of every PriceUpdateV2 account. */
export const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
export const HERMES = "https://hermes.pyth.network";
/** A Pyth print older than this is not a live reference (matches the program's ORACLE_MAX_AGE_SECS). */
export const ORACLE_MAX_AGE_SECS = 90;

/** settle_batch orders per transaction: the measured size limit with distinct owners. */
export const SETTLE_BATCH = 7;

/**
 * The devnet endpoint, read server-side only.
 *
 * DEVNET_RPC is deliberately NOT prefixed NEXT_PUBLIC_: that prefix inlines a
 * value into the client bundle at build time, so a dedicated endpoint's API
 * key would be readable by every visitor. Nothing in the browser needs this —
 * auctions are read by the cached /api/venue route, and the only client that
 * wants venue data fetches that route. NEXT_PUBLIC_DEVNET_RPC is still honoured
 * so an existing deployment keeps working, but it exposes the key: prefer
 * DEVNET_RPC.
 */
export const DEVNET_RPC =
  process.env.DEVNET_RPC || process.env.NEXT_PUBLIC_DEVNET_RPC || "https://api.devnet.solana.com";

/**
 * The public mainnet RPC returns 403 to browser-origin requests, so in the
 * browser mainnet goes through the same-origin proxy at /api/rpc. On the
 * server (prerender, route handlers) we call the upstream directly.
 */
export const MAINNET_UPSTREAM = process.env.MAINNET_RPC_UPSTREAM || "https://api.mainnet-beta.solana.com";
export const MAINNET_RPC = typeof window === "undefined" ? MAINNET_UPSTREAM : "/api/rpc";

/** An HTTP proxy cannot carry websocket subscriptions; poll instead. */
export const supportsWebsocket = (rpcEndpoint: string) => !rpcEndpoint.endsWith("/api/rpc");

export interface TickerConfig {
  symbol: TickerSymbol;
  name: string;
  underlying: string;
  /** Token-2022 ticker mint on this cluster. */
  mint: string;
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

export const CLUSTER: ClusterConfig = {
  name: "devnet",
  label: "Devnet",
  rpc: DEVNET_RPC,
  quoteMint: registry.quoteMint, // USDC-shaped fixture, legacy SPL, 6 dp
  quoteSymbol: "USDC",
  explorerSuffix: "?cluster=devnet",
  tickers: Object.fromEntries(
    registry.tickers.map((t) => [
      t.symbol,
      {
        symbol: t.symbol,
        name: t.name,
        underlying: t.underlying,
        mint: t.devnetMint,
        pythAccount: t.pythAccount,
        pythFeedId: t.pythFeedId,
        hermesQuery: t.underlying,
      },
    ]),
  ),
};

export const TICKERS: TickerSymbol[] = registry.tickers.map((t) => t.symbol);

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}${CLUSTER.explorerSuffix}`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}${CLUSTER.explorerSuffix}`;
