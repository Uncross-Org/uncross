import { defineRailway, preserve, project, service } from "railway/iac";

// Both venue processes, in one project. Secrets (RPC_URLS, the keypairs) are
// declared with preserve() — set once with `railway variable set`, never
// written here — so applying this file cannot delete or overwrite them.
export const partial = "uncross-venue";

export default defineRailway(() => {
  const keeper = service("uncross-keeper", {
    start: "node scripts/keeper.mjs --cluster devnet --cadence 7000 --freeze 700 --interval 20 --close-per-tick 12 --keep-traded 3",
    replicas: 1,
    // Forced: the repo root also holds the Anchor program's Cargo.toml, and
    // Railpack's auto-detection built an image with no node binary when left
    // to guess between the Rust and Node providers.
    build: {
      builder: "NIXPACKS",
      nixpacksPlan: { providers: ["node"] },
    },
    deploy: {
      restartPolicyType: "ALWAYS",
      restartPolicyMaxRetries: 10,
      sleepApplication: false,
    },
    variables: {
      RPC_URLS: preserve(),
      KEYPAIR_DEPLOY: preserve(),
      // Auctions whose rent must never be reclaimed: the community event's
      // book stays on chain as a permanent, linkable record.
      NEVER_CLOSE: preserve(),
    },
  });

  const activity = service("uncross-activity", {
    start: "node scripts/devnet-activity.mjs --loop --tickers AAPLx,NVDAx,IBMx,TSLAx --orders 2-3",
    replicas: 1,
    build: {
      builder: "NIXPACKS",
      nixpacksPlan: { providers: ["node"] },
    },
    deploy: {
      restartPolicyType: "ALWAYS",
      restartPolicyMaxRetries: 10,
      sleepApplication: false,
    },
    variables: {
      RPC_URLS: preserve(),
      KEYPAIR_DEPLOY: preserve(),
      KEYPAIR_WALLET2: preserve(),
      KEYPAIR_MB_OWNERS: preserve(),
      // Auctions this bot must leave alone — the community event's books.
      SKIP_AUCTIONS: preserve(),
      // The same exclusion by ticker, which is what can be set before the
      // auctions exist. Declared here so an apply cannot quietly delete it
      // mid-event and put the bot back into a book it must stay out of.
      SKIP_TICKERS: preserve(),
    },
  });

  // The faucet holds the signing keys a browser must never see: it mints the
  // fixture tokens (deploy is their mint authority) and pays the SOL from
  // wallet2. It is a separate service so the keeper and the bot keep running
  // untouched when it is redeployed or rate-limited.
  const faucet = service("uncross-faucet", {
    start: "node scripts/faucet.mjs",
    replicas: 1,
    build: {
      builder: "NIXPACKS",
      nixpacksPlan: { providers: ["node"] },
    },
    deploy: {
      restartPolicyType: "ALWAYS",
      restartPolicyMaxRetries: 10,
      sleepApplication: false,
    },
    variables: {
      RPC_URLS: preserve(),
      KEYPAIR_DEPLOY: preserve(),
      KEYPAIR_WALLET2: preserve(),
      MAX_SOL: preserve(),
      MAX_GRANTS: preserve(),
      // Participants on mobile networks can share one address behind CGNAT,
      // so this is deliberately loose; the global caps are the real limit.
      IP_PER_HOUR: preserve(),
      // Which wallet's SOL goes out: wallet2 is the bot's funder and runs
      // down with it, so an event points this at one that will still hold a
      // balance hours later.
      FUNDER: preserve(),
      // Every grant funds all of these, not just the ticker asked for, so one
      // trip to the faucet covers a multi-book event. Undeclared, an apply
      // deletes it and the faucet silently falls back to its built-in default
      // — which would strand anyone granted during the window in whichever
      // book the default left out.
      EVENT_TICKERS: preserve(),
    },
  });

  return project("uncross-venue", {
    resources: [keeper, activity, faucet],
  });
});
