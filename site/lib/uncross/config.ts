// Single source of truth for the network, tickers and endpoints.
// Uncross runs on Solana devnet. The only mainnet access is a read-only fetch
// of the Pyth reference price, which in the browser goes through the
// same-origin proxy at /api/rpc.

export type ClusterName = "devnet";
export type TickerSymbol = "AAPLx" | "IBMx";

export const PROGRAM_ID = "Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP";

/** Pyth Solana Receiver program: owner of every PriceUpdateV2 account. */
export const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
export const HERMES = "https://hermes.pyth.network";
/** A Pyth print older than this is not a live reference (matches the program's ORACLE_MAX_AGE_SECS). */
export const ORACLE_MAX_AGE_SECS = 90;

/** settle_batch orders per transaction: the measured size limit with distinct owners. */
export const SETTLE_BATCH = 7;

export const DEVNET_RPC = process.env.NEXT_PUBLIC_DEVNET_RPC || "https://api.devnet.solana.com";

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

const AAPL_PYTH = {
  // Equity.US.AAPL/USD, shard 1 (live). Never shard 0.
  // This is the US equity feed, not the Equity.Index.AAPL/USD 24/7 variant.
  pythAccount: "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW",
  pythFeedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688",
  hermesQuery: "AAPL",
};
const IBM_PYTH = {
  pythAccount: null, // Equity.US.IBM/USD has no PriceUpdateV2 account on Solana.
  pythFeedId: "cfd44471407f4da89d469242546bb56f5c626d5bef9bd8b9327783065b43c3ef",
  hermesQuery: "IBM",
};

export const CLUSTER: ClusterConfig = {
  name: "devnet",
  label: "Devnet",
  rpc: DEVNET_RPC,
  quoteMint: "22BrsoDTwXigFmNnMRxfTQ66ksS4SgP5k5k9UcdrRP87", // USDC-shaped fixture, legacy SPL, 6 dp
  quoteSymbol: "USDC",
  explorerSuffix: "?cluster=devnet",
  tickers: {
    AAPLx: {
      symbol: "AAPLx",
      name: "Apple",
      underlying: "AAPL",
      mint: "BvgVkJawYWrWV2eu5ousJUvGWwbgDTUdyr9vBM27BYYG",
      ...AAPL_PYTH,
    },
    // Devnet fixture replicating real IBMx (scaled-UI multiplier ≈ 1.0153).
    IBMx: {
      symbol: "IBMx",
      name: "IBM",
      underlying: "IBM",
      mint: "9aGoR5JbatqRYbc4SpQuT3pWVLPhZQJvDq26FFb23Jzp",
      ...IBM_PYTH,
    },
  },
};

export const TICKERS: TickerSymbol[] = ["AAPLx", "IBMx"];

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}${CLUSTER.explorerSuffix}`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}${CLUSTER.explorerSuffix}`;
