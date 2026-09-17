import { defineRailway, preserve, project, service } from "railway/iac";

// Both venue processes, in one project. Secrets (RPC_URLS, the keypairs) are
// declared with preserve() — set once with `railway variable set`, never
// written here — so applying this file cannot delete or overwrite them.
export const partial = "uncross-venue";

export default defineRailway(() => {
  const keeper = service("uncross-keeper", {
    start: "node scripts/keeper.mjs --cluster devnet --cadence 7000 --freeze 700 --interval 20 --close-per-tick 12",
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
    },
  });

  return project("uncross-venue", {
    resources: [keeper, activity],
  });
});
