---
title: Why devnet
description: Uncross runs on devnet against fixture mints built to match the real xStocks extension for extension, which made two issuer-only tests possible.
---

Uncross runs on Solana devnet. That is not a stand-in for mainnet. It is where the most important failure modes of these assets could be tested at all.

## The reason: issuer powers can only be tested on a mint you control

Two things only an issuer can do to an xStock would matter most to an auction mid-flight: **pausing the token**, and **changing its multiplier** (how a stock split is applied). On mainnet those authorities belong to Backed Finance. Nobody else can pause AAPLx or change its multiplier, so nobody else can test what happens when they do.

On devnet, Uncross built its own mints that are identical in every behaviourally relevant way, and held the authorities itself. Both tests were then run for real, in the middle of auctions:

- [Test: pause mid-auction](/devnet/pause-test/): every balance recoverable, both vaults at exactly zero.
- [Test: split mid-auction](/devnet/split-test/): open orders unchanged, every fill exactly as predicted.

## How the fixture was matched to the real mint

**1. The real mint, read live.** The AAPLx mint on mainnet (`XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`) was read directly with `getAccountInfo`, not from documentation.

**2. The fixture, built to match, then read back the same way.** The devnet AAPLx fixture is `BvgVkJawYWrWV2eu5ousJUvGWwbgDTUdyr9vBM27BYYG`, built with `uncross/scripts/create-devnet-fixture.sh`.

| Property | Mainnet AAPLx | Devnet fixture | Match |
|---|---|---|---|
| Token program | spl-token-2022 | spl-token-2022 | yes |
| decimals | 8 | 8 | yes |
| freezeAuthority | set | set | yes (different key) |
| `defaultAccountState` | `initialized` | `initialized` | yes |
| `permanentDelegate` | set | set | yes (different key) |
| `transferHook` | present, `programId: null` | present, `programId: null` | yes |
| `confidentialTransferMint` | present, `autoApproveNewAccounts: false` | present, `autoApproveNewAccounts: false` | yes |
| `scaledUiAmountConfig` | present | present | yes (value differs, below) |
| `pausableConfig` | present, `paused: false` | present, `paused: false` | yes |
| `metadataPointer` | present, self-pointing | present, self-pointing | yes |
| `tokenMetadata` | present | present | yes |
| `transferFee` | not present | not present | yes |
| `nonTransferable` | not present | not present | yes |

Every extension on the real mint is on the fixture, with the same configuration shape, and nothing extra is present.

**3. The four fields deliberately not reproduced:**

1. **Authority keys.** Every authority on the fixture belongs to the Uncross deploy wallet, not the issuer. That is the point. It also makes the fixture strictly more permissive than mainnet.
2. **The multiplier's starting value.** Mainnet AAPLx sat near 1.0027 with a scheduled change. The fixture starts at 1, so the multiplier test has a clean before and after.
3. **Supply.** Whatever was minted for testing. Irrelevant to the program.
4. **The metadata URI.** Nothing on chain reads it.

An **IBMx fixture** (`9aGoR5JbatqRYbc4SpQuT3pWVLPhZQJvDq26FFb23Jzp`) replicates the real IBMx mint the same way, including its live multiplier, 1.015340763856885. So conversions between raw and displayed amounts are exercised against a non-trivial multiplier. The other tickers' fixtures and their starting multipliers are listed in [Addresses](/reference/addresses/).

All 1,026 xStocks mints on Solana carry the identical eight-extension set under one authority. So one fixture template reproduces any of them.

## What devnet cannot tell us

- **Liquidity.** Devnet orders come mostly from a test bot. See [Honest limitations](/trust/limitations/).
- **An adversarial issuer on mainnet.** The fixture proves the program handles the extension set as currently configured. It cannot prove anything about what Backed Finance might do next, such as setting a transfer-hook program or using the permanent delegate.
- **The oracle's passing path.** Pyth publishes no fresh price on devnet ([What Pyth is used for](/pyth/role/#what-actually-happens-on-devnet)).
- **Mainnet itself.** Nothing here has run against a real xStocks mint. The program is not deployed on mainnet.

## The reference price comes from mainnet

The Pyth price the app shows is read from Solana **mainnet**, read-only, and labelled as such. Auctions clear on devnet.

<p class="sources">Sources: <code>README.md</code> (What it runs on), <code>docs/devnet-fixture.md</code>, <code>docs/phase0.md</code> Q1 and Q7, <code>docs/submission-draft.md</code> (Why devnet; identical extension set), <code>uncross/scripts/tickers.json</code>.</p>
