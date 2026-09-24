---
title: "Test: pause mid-auction"
description: The issuer pauses the token after the cross. Settlement fails cleanly, dollars are refunded during the pause, shares after it, and both vaults end at zero.
---

**The question:** what happens to escrow if the token's issuer pauses the mint in the middle of an auction?

On mainnet only Backed Finance can pause an xStock, so this can only be tested on a mint you control ([Why devnet](/devnet/why-devnet/)).

## What was done

A small book was placed and crossed. Then the fixture mint was paused through its `pausableConfig` authority **after the cross, before settlement**.

The test was run twice: first on the original program (Phase 1, AAPLx fixture), then again on the upgraded program (Phase 2, IBMx fixture) after the settlement-path lock was added.

## What happened

1. **Settlement failed, cleanly.** `settle_batch` was rejected by Token-2022 with error `0x43`, "Transferring, minting, and burning is paused on this mint". The transaction aborted atomically. The auction stayed Cleared with 0 of 2 orders settled. Every balance and both vaults were unchanged. No partial transfer, no half-settled order.
2. **The failed attempt did not lock the path.** On the upgraded program, the settle path stayed `none`. The failed transaction rolled back its own path write, so a failed settlement does not commit the auction to ordinary settlement.
3. **Dollars were refunded while still paused.** `cancel_and_refund` on the buy order returned the buyer's full test-dollar escrow. The test dollar is a different mint and was never paused.
4. **Ordinary settlement was then refused.** After refunds had begun, a `settle_batch` attempt was rejected with `SettlementPathLocked` (6019). That is the guard working: the auction was now committed to the refund path.
5. **Shares were refunded after the pause lifted.** Once the mint was resumed, `cancel_and_refund` on the sell order returned the escrowed shares.
6. **Final state:** the auction Settled, 2 of 2, on the refund path. **Both vaults at exactly zero.** Both wallets back to their exact pre-auction balances (Phase 1 run).

A repeat `cancel_and_refund` on an already-refunded order was also checked. It is a no-op, so there is no double refund.

## What it shows, and what it doesn't

**Shows:** the program fails safely under a pause. Nothing is half-settled, dollar refunds work during the pause, and every balance is recoverable the moment it lifts.

**Doesn't:** get shares out *during* a pause. A paused mint blocks refunds of that token as well as settlement. `cancel_and_refund` is an escape hatch from a failed clearing, not from a pause. While the issuer holds the pause authority, which it does on every xStock, escrowed shares are unreachable until it unpauses. That is inherent to Token-2022's pausable extension.

## Signatures

**Upgraded program (Phase 2, IBMx fixture).** Auction cleared at 205.00 × 4.

| Step | Result |
|---|---|
| `settle_batch` while paused | rejected: `0x43`, nothing landed |
| `cancel_and_refund` [1] while paused | [`4DNRgi4M…ZBBPGxbZ`](https://explorer.solana.com/tx/4DNRgi4M1aXGQd7GajCDk3XrVEoznDRu5kqUojdhL5Ek1A2mTpG3DZaXoDCHBjYMTdtE8oQ4YFfAar2CZBBPGxbZ?cluster=devnet) |
| `settle_batch` after refunds began | rejected: `SettlementPathLocked` (6019) |
| `cancel_and_refund` [0] after resume | [`2r9ANErS…NpP1eNB7`](https://explorer.solana.com/tx/2r9ANErSqUQUzQLSQwwbrJvwDwZXkGr6uwCeFUkh4QdWWh6ew9JJc4gVEBixbD1RfGkHmZ4ztQ5LDY9GNpP1eNB7?cluster=devnet) |

**Original program (Phase 1, AAPLx fixture).** Auction `243zHq9yVZWornL3GLCUV9xNDrsjC2w1nDCpfRpsEt5R`: sell 4 @ 200, buy 4 @ 210, cleared at 205.00 × 4.

| Step | Result |
|---|---|
| `initialize_auction` | [`5zSWWcEC…HqCYeJh3`](https://explorer.solana.com/tx/5zSWWcECSgLRrcj6wmPkdnuh5GJUYdvES8Xt8CyzFZUGUW248bQNbkyQRNPXMS66THReggMztvxM3F2pHqCYeJh3?cluster=devnet) |
| `place_order` #0 (sell 4 @ 200) | [`4SCjHheg…cfKjA567`](https://explorer.solana.com/tx/4SCjHhegb1fSfrUhDYxikDEoHa4T4DjTLma4Q5smo4yRDDeidYtBmz3qZ3Cqg9yQT4N58uffgr46qaumcfKjA567?cluster=devnet) |
| `place_order` #1 (buy 4 @ 210) | [`27e2ZnfC…KpnUin4J`](https://explorer.solana.com/tx/27e2ZnfCrfFkpn6hkAcTXfzWPXnawyRUZXtiCBWJRFDxPwqsd6mQWpXteEwDY5fx1hz73cLxYRGvrpthKpnUin4J?cluster=devnet) |
| `compute_clearing` | [`P9Jf2Sc9…s98EBtvY`](https://explorer.solana.com/tx/P9Jf2Sc9PaK3GSNQNuhEiBkJNGnjdBZTCxkLkZDmAEmEeWjDhiuuP28G8dBLe4LSYYPm5wTbn4WMv6ms98EBtvY?cluster=devnet) |
| pause mint | [`4FHHJEmu…9gYZYotC`](https://explorer.solana.com/tx/4FHHJEmuJWpYEy3oksW2hKENbzT7Z9THwYmch4CpVEnsiJmTPszWReMRi4r5hoBW448TicTqPoDLhwiy9gYZYotC?cluster=devnet) |
| `settle_batch` while paused | rejected: `0x43`, nothing landed |
| `cancel_and_refund` [1] (paused, dollar side) | [`5SEFyptp…vy7DjrCT`](https://explorer.solana.com/tx/5SEFyptpcyg2xKzmyjRLFJHsEXf97Rj4rxhgTpTuZCX2iaJB34hRPAJaFZRNNJsqNGD51Ajf3MXbiZUMvy7DjrCT?cluster=devnet) |
| resume mint | [`DQ37fmkW…xcc7WjTw`](https://explorer.solana.com/tx/DQ37fmkWpnwGeKJpSsdZp8zY3Wmr3LfXQG6bUaV1fkr9UotkKUrbiyc3msUxZCctCpUsm1V8DwJQyykxcc7WjTw?cluster=devnet) |
| `cancel_and_refund` [0] (after resume) | [`54YkbSwC…fHrSdhoi`](https://explorer.solana.com/tx/54YkbSwCBhYGnpAnqbDy13T3x5d9RnqEmFQnX3z5L7HxeqUfmZDFKY6UyeMuB8LUPHaw4fKzpprJzCUhfHrSdhoi?cluster=devnet) |

<p class="sources">Sources: <code>docs/phase1.md</code> Step 3 (pause test), <code>docs/phase2.md</code> (pause and multiplier traps, re-run on the upgraded program), <code>README.md</code>.</p>
