# Devnet fixture mints

Built so Phase 1 can be tested end-to-end without touching mainnet. The ticker
fixture is a deliberate replica of the real AAPLx mint's extension set as read
live off mainnet in [docs/phase0.md](phase0.md) Q1 — the point is that any
behaviour that depends on those extensions (pause, permanent delegate, scaled
UI multiplier) can be exercised here, under our own authority keys, which is
impossible against the real mint.

Created 2026-09-16 with [`scripts/create-devnet-fixture.sh`](../uncross/scripts/create-devnet-fixture.sh).

| | Address |
|---|---|
| Ticker fixture mint (Token-2022) | `BvgVkJawYWrWV2eu5ousJUvGWwbgDTUdyr9vBM27BYYG` |
| Quote fixture mint (legacy SPL Token, USDC-shaped) | `22BrsoDTwXigFmNnMRxfTQ66ksS4SgP5k5k9UcdrRP87` |
| Deploy wallet | `68N5a3Nj5u7Kc5RPiyu4iH3qVLN1A7wu1fEWErNtqLJf` |
| Wallet 2 | `DxC9wmwQHc5uSKNTGnfrZebzMHtsTkBTpes5KxyTUiUW` |
| Deploy ticker ATA | `Bw1NodyUBQeEfVHp5AjynsjtpBhkhsjtmAfeWdnmR23X` |
| Deploy quote ATA | `DeD9Csu6xKDrFqWUedW5SPVRc97BaL9F1y3noTkJSME7` |
| Wallet 2 ticker ATA | `4F8pqwHqc8qSmoJGFoLpANEd6wHhe2Y7Jn8TmJiiJzxG` |
| Wallet 2 quote ATA | `2imy4F96g16TQJ7QzziSNuWgRr56m27YpBdJ5U28gt4F` |

Balances minted for testing: 1,000 ticker-fixture tokens to the deploy wallet
(it places SELL orders), 100,000 quote-fixture tokens to wallet 2 (it places
BUY orders). The opposite-side ATA on each wallet exists with a zero balance,
to receive settlement proceeds — `place_order` requires both to exist already.

## Extension diff vs. the real AAPLx mint

Read back from devnet with `getAccountInfo` (`jsonParsed`), same method used
against mainnet in Q1. Mainnet column is AAPLx
(`XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`).

| Property | Mainnet AAPLx | Devnet fixture | Match |
|---|---|---|---|
| Token program | spl-token-2022 | spl-token-2022 | yes |
| decimals | 8 | 8 | yes |
| freezeAuthority | set (`JDq14BWv…`) | set (`68N5a3Nj…`) | yes (different key, see below) |
| `defaultAccountState` | `initialized` | `initialized` | yes |
| `permanentDelegate` | set (`5aMNNLQJ…`) | set (`68N5a3Nj…`) | yes (different key) |
| `transferHook` | present, `programId: null` | present, `programId: null` | yes |
| `confidentialTransferMint` | present, `autoApproveNewAccounts: false` | present, `autoApproveNewAccounts: false` | yes |
| `scaledUiAmountConfig` | present, multiplier `1.0026642075893797` | present, multiplier `1` | present in both; value differs (see below) |
| `pausableConfig` | present, `paused: false` | present, `paused: false` | yes |
| `metadataPointer` | present, self-pointing | present, self-pointing | yes |
| `tokenMetadata` | present ("Apple xStock"/AAPLx) | present ("Apple xStock (devnet fixture)"/AAPLx-fx) | yes |
| `transferFee` | not present | not present | yes |
| `nonTransferable` | not present | not present | yes |

**Extension set is identical.** Every extension on the real mint is on the
fixture, with the same configuration shape, and nothing extra is present.

### Fields deliberately not reproduced, named explicitly

1. **Authority keys.** Every authority on the fixture (mint, freeze, permanent
   delegate, pause, multiplier, metadata, transfer-hook, confidential-transfer)
   is the deploy wallet, not Backed Finance's keys. This is the entire point of
   the fixture — holding these authorities is what lets us run the pause and
   multiplier tests. It also means the fixture is *strictly more permissive*
   than mainnet: anything that works here must still be re-verified on mainnet
   for behaviour that depends on *not* holding the authority.
2. **`scaledUiAmountConfig.multiplier` starting value.** Mainnet AAPLx sits at
   `1.0026642075893797` with a scheduled `newMultiplier`; the fixture starts at
   a neutral `1`. The multiplier test changes this value mid-auction on purpose,
   so a matching start value would only obscure the before/after comparison.
3. **`supply` and holder distribution.** Fixture supply is whatever we mint.
   Not behaviourally relevant to the auction program.
4. **Metadata `uri`.** Points at a non-existent example.com URL; the real one
   points at Backed Finance's metadata service. Nothing on-chain reads it.

### What this fixture cannot tell us

The fixture cannot prove anything about behaviour that depends on the *issuer*
acting adversarially or unexpectedly on mainnet — notably that Backed Finance
could set a transfer-hook program at any time (the hook authority is live and
the `programId` is merely unset today), or seize balances via the permanent
delegate. Those remain live mainnet risks documented in Q1; the fixture only
proves our program handles the extension set correctly as currently configured.
