---
title: "Test: split mid-auction"
description: The issuer doubles the multiplier between order entry and the cross, the way a stock split is applied. Every fill and refund came out exactly as predicted.
---

**The question:** if the issuer applies a stock split while orders are waiting in an auction, do those orders still mean what they meant?

xStocks express splits by changing the mint's scaled-UI multiplier ([Raw amounts and splits](/tokens/raw-amounts/)). Only the issuer can change it on mainnet, so this was tested on a fixture mint whose multiplier authority Uncross holds.

## What was done

A sell and a buy were placed and escrowed. With the auction still open, the multiplier was changed to **2**. Then the auction crossed and settled.

**The expected raw outcomes were written down before the multiplier changed.** The test passes only if every one comes back unchanged.

The test was run twice: on the original program (Phase 1, AAPLx fixture, multiplier 1 → 2) and on the upgraded program (Phase 2, IBMx fixture, multiplier 1.0153 → 2).

## Upgraded program (Phase 2, IBMx fixture)

Sell 6 @ 100 and buy 6 @ 120, placed at *m* = 1.0153. Multiplier then set to 2 before the cross.

- **Cleared at 110.00 × 6, exactly as predicted.** It was the midpoint of the tied 100 and 120 candidates.
- Raw changes: the seller +660,000,000 quote units ($660.00). The buyer +600,000,000 ticker units (6 tokens) and +60,000,000 quote units back ($60.00), which is an escrow of 720,000,000 minus a charge of 660,000,000.
- Both vaults at zero.
- The multiplier was reset to 1.015340763856885 afterwards.

## Original program (Phase 1, AAPLx fixture)

Auction `FAi9XwsdZtCbwFxmHQ65G4swWsjP8vHmevhXaoGUUfnk`: sell 6 @ 100, buy 6 @ 120, multiplier changed from 1 to 2 mid-auction.

| Balance | Before | After | Change |
|---|---|---|---|
| seller, ticker | 984 | 984 | 0 |
| seller, dollars | $2,475.00 | $3,135.00 | **+$660.00** |
| buyer, ticker | 10 | 16 | **+6** |
| buyer, dollars | $96,805.00 | $96,865.00 | **+$60.00** |
| ticker vault | 6 | 0 | emptied |
| dollar vault | $720.00 | 0 | emptied |

Ticker balances are in raw tokens (10⁸ raw units each). In raw units the changes were +660,000,000 quote to the seller, and +600,000,000 ticker and +60,000,000 quote to the buyer.

The seller's ticker balance does not change at settlement because all 6 of its escrowed shares were sold; they had already left its wallet when the order was placed.

Clearing price 110,000,000 and executable volume 600,000,000, identical to the prediction.

**Proof the multiplier was live during settlement, not inert:** the buyer's ticker account read raw 1,600,000,000 but displayed 32 at the same moment. The display layer doubled. The program's accounting did not move.

## What it shows

The program stores raw amounts only, so a split between order entry and the cross cannot change any order's quantity, escrow, fill or payout. No fix was needed.

## Signatures

**Upgraded program (Phase 2):**

| Step | Signature |
|---|---|
| set multiplier 1.0153 → 2 | [`uWkV19hz…nWEaZm4v`](https://explorer.solana.com/tx/uWkV19hzfH1kcjHxwBKTUNqvCHs7SnHo7B46BdZDEMALSDsLUZoN9qbgAdQhLjBUqsY7SZg4hvQJGjvnWEaZm4v?cluster=devnet) |
| `compute_clearing` | [`5H6bFXTH…Tg9n2hp9`](https://explorer.solana.com/tx/5H6bFXTHyaBveTcNoQdzVWRF6kTbpCy5ejjTzBgVxZDendpfR6GeZdmGNVrKJ67cJ4yZHkS8RGjUfdDKTg9n2hp9?cluster=devnet) |
| `settle_batch` [0,1] | [`5bmP3jkq…h85wbvMa`](https://explorer.solana.com/tx/5bmP3jkqpcujvMMPrU5aqCivJudXQwxy6Hffn8M7jgZVKqVfFSHpfPkcm7rvHRGyW7ETCPyYscSeidALh85wbvMa?cluster=devnet) |

**Original program (Phase 1):**

| Step | Signature |
|---|---|
| `initialize_auction` | [`GwmoiFpN…DAzqLNKd`](https://explorer.solana.com/tx/GwmoiFpNRgKtXAGt1vz85KVqJGyeisaeR4JPXDA1MnZZe3fsy7VLXezbUAT8SRLjpwtNC2rkxkgDJBCDAzqLNKd?cluster=devnet) |
| `place_order` #0 (sell 6 @ 100) | [`4SpoB576…c21VTJ1F`](https://explorer.solana.com/tx/4SpoB576zVxvD53N1H9iypSCAKzDuodXbEVKP9oBS7XW61nz6xcxiME3GDAQP9MEyghY73G62UuZfKeGc21VTJ1F?cluster=devnet) |
| `place_order` #1 (buy 6 @ 120) | [`4aUjFo2f…5qpW1711`](https://explorer.solana.com/tx/4aUjFo2fqigaS8A6DSNZ8GqNxQuBLoV6g943sd9pTfP1F3PzaxmvEqRVb1qMvavkKfST9dkRcxVKTvBU5qpW1711?cluster=devnet) |
| set multiplier 1 → 2 | [`4BZK8vxK…MuNT5PGd`](https://explorer.solana.com/tx/4BZK8vxKbPs7CF3T5bWzZk9pZ3zLaBFwuqKpUrghMrhNjsPnudggg6Qj2XCMSwDTf2h8EG54dy2N81ZhMuNT5PGd?cluster=devnet) |
| `compute_clearing` | [`2PvqBTsY…3f8jjmSQ`](https://explorer.solana.com/tx/2PvqBTsYe6rb5VpVDE23zyH5hc1U9emFQBdUCnR4jKZS7zWkXfaXYcqUd5gk8yhmxMn9fECMPJvZijSj3f8jjmSQ?cluster=devnet) |
| `settle_batch` [0,1] | [`3vYPfkaB…3sp5moxV`](https://explorer.solana.com/tx/3vYPfkaBEJog8u3m2MzDMMBcLgrXrdPZYNNEqcLV1zJdhitFSQH3dnuenS6UEbYMZF9NNcSGJqKgLZZo3sp5moxV?cluster=devnet) |
| reset multiplier 2 → 1 | [`4fSHNJ3D…HjKXrT1J`](https://explorer.solana.com/tx/4fSHNJ3DZg1CmTHwWzMyzGvHJpa4izZDkjwAqZx9UfKCTZXbUkYxpTWGaB5bWtLQH3oAvZMrmTZSziaoHjKXrT1J?cluster=devnet) |

<p class="sources">Sources: <code>docs/phase1.md</code> Step 3 (multiplier test), <code>docs/phase2.md</code> (re-run on the upgraded program), <code>README.md</code>.</p>
