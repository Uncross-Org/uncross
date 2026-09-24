---
title: "Test: 42-wallet settlement"
description: 42 orders from 42 different wallets, settled in batches deliberately out of order, with a duplicate and an overlap. Both vaults ended at zero and every wallet matched to the unit.
---

**The question:** does batched settlement stay exact when a book needs many transactions? That means batches sent in any order, sent twice, overlapping, and with a pro-rata tier split across batch boundaries.

## The book

Auction `C8pGy4va4btnEQTMbbptnwiFNxnoH2d9md5tSuMff3Mb`: **42 orders from 42 distinct wallets.**

- 22 buys of 10 @ 100.37;
- 18 sells of 10 @ 90.00;
- 2 sells of 10 @ 100.37;
- interleaved, so the buys sit at even order indices across the whole book.

**Cleared at 100.37 × 200 shares.** The 22 buys form one tier of 220 shares competing for 200, so **every buy is pro-rated**. Because the buys are spread across the book, the pro-rata tier spans every batch boundary.

## The fills and money legs, as the cross fixed them

- **Buy fills:** 909,090,910 raw units for orders #0 and #2, and 909,090,909 for the other 20. The two leftover units from floor division go to the lowest indices. Buy total 20,000,000,000 = sell total 20,000,000,000.
- **Buy charges:** 912,454,547, 912,454,546 or 912,454,545 micro-dollars, by the same rule. Buyers charged 20,074,000,000 = sellers paid 20,074,000,000, exactly.

## Settlement, deliberately abused

Settlement ran in 7-order batches, the most that fit in one transaction with distinct owners:

| Step | Result |
|---|---|
| Batch #3 [21–27] first | 7/42 settled, status stays Cleared, settle path locks to *clear* |
| Batch #3 again | A no-op: settled count and both vaults byte-identical |
| `compute_clearing` mid-settlement | A no-op: clearing price, every fill and every money leg unchanged |
| `cancel_and_refund` [0–6] | Refused: `SettlementPathLocked` |
| Overlap [25–31]: 3 settled, 4 not | Settles exactly the 4 new orders (11/42) |
| Batches #5, #4, #2, #1, #0 | 18 → 21 → 28 → 35 → 42/42, status Settled |

**Final: both vaults exactly zero, and all 42 wallets' balance changes match their fill and money leg to the unit.** Buyers show +fill shares and −charge; sellers −fill shares and +proceeds. Each was measured against a snapshot taken before the auction opened.

Every settle transaction was 1,162 bytes (limit 1,232) and used 70k–129k compute units.

The indicative price moved as the book filled: 100.37 with no cross, 95.185 once the first sell arrived, then back to 100.37 once the buy side outgrew the sells at 90. The final indicative price matched `compute_clearing`.

## The bugs this work found and fixed

The first multi-batch run was meant to confirm the crank loop. Instead it found three accounting bugs, because earlier tests had only used books whose numbers divided evenly.

1. **The two sides could fill to different totals.** Pro-rating with floor division gave 22 buyers 9 each: 198 against the sell side's 200. Sellers would have been paid for shares buyers never paid for. *Fix:* the flooring remainder is handed back one unit per order, lowest index first, so each side fills to exactly the executable volume.
2. **Per-order rounding could leave the quote vault short.** Two buyers each owing half a unit floor to 0, against a seller owed 1. *Fix:* buy escrow rounds **up**. Every order's money leg is decided once, at the cross. Sellers get floor(fill × price), and buyers are charged exactly that total between them.
3. **A refund after partial settlement could double-spend the vault.** A seller whose shares went to a buyer in one batch could be refunded their full escrow in the next. *Fix:* an auction commits to one wind-down path on its first batch, and the other is refused thereafter.

And one measurement correction: **the batch limit is 7, not 18.** Phase 0 measured 18–19 transfers per transaction, each adding one account. `settle_batch` adds three accounts per order: the order and the owner's two token accounts. Measured on the real instruction, 7 orders fit with distinct owners, and 8 do not (1,275 bytes against a limit of 1,232).

A separate earlier run, a real 38-order, 38-owner book, was cranked to completion by the production keeper in six batches (7, 7, 7, 7, 7, 3). It settled in order and never exercised a pro-rata tier, so it is not the stress test. Its signatures are in [Transaction index](/trust/transactions/).

## Signatures

| Step | Signature |
|---|---|
| `initialize_auction` | [`3ckf99Ax…QGFJp5ci`](https://explorer.solana.com/tx/3ckf99Ax8WpxHCpiuxSKKHHvcL2ewsDdtnzTf9h5qQXL8yjSnwj1hEwZktWGU7efobn2iXhSSHsu2zaPQGFJp5ci?cluster=devnet) |
| `compute_clearing` | [`2gzwsuTp…wHFnXwrN`](https://explorer.solana.com/tx/2gzwsuTp7HT6Tf46RJYf7qCzdetEkRu8iDqxWDiTnUexZbvtKiniUjGwyxcewfQw5CGDqUij9yFMTtxSwHFnXwrN?cluster=devnet) |
| settle #3 [21–27] | [`5Ty7nfDD…5TVYrggX`](https://explorer.solana.com/tx/5Ty7nfDDwdxFZhBZMFbNJyUkpVJiKZGVtqK38aerfbDo5Cz1ZJTuEV2nEE3hQHxsY6bVXi1QDz1gur7k5TVYrggX?cluster=devnet) |
| settle #3 again (no-op) | [`3zCC9tLi…p1H4tnzX`](https://explorer.solana.com/tx/3zCC9tLiUVkj9C635ZmJ2EwPwmebMsPdxWaG7k1U8DT4XX7EGC6n41r4qcaqLYQNMmyqQTdZYAZvY5eip1H4tnzX?cluster=devnet) |
| `compute_clearing` mid-settlement (no-op) | [`2YhJpaFX…nkXobbA5`](https://explorer.solana.com/tx/2YhJpaFX5pGtrnfWE1XsoRjDndftFtzN5HkhGj4SkKEgzvqk8B9jexqSuGFufu1bWU7APhZqYAdAMsJLnkXobbA5?cluster=devnet) |
| settle overlap [25–31] | [`M4JDaNje…1Xcmu6Tp`](https://explorer.solana.com/tx/M4JDaNjecaAXHtnrezaQG9YEK4kpR7686wh8i1aJbtb2DBsCFXhLxnxKBsk3LXxRbs8oVockPQHVGxb1Xcmu6Tp?cluster=devnet) |
| settle #5 [35–41] | [`5unU2SE8…MNoqZkqV`](https://explorer.solana.com/tx/5unU2SE8wrMVDNabfR8jFuHToNGcE2EpRTNGu4XGEeLDUizrTgdZE6cjdxT2HdYy8Cgo3ZkxargVr2aZMNoqZkqV?cluster=devnet) |
| settle #4 [28–34] | [`tVXozm3q…9Y4jEBQi`](https://explorer.solana.com/tx/tVXozm3qgRLMSTZNkSD1KqqYuwKsxwSAzxU6iVXRRWxbYiubjfq1qsxZXs5VvQ9mYPK43Hyg5spH5kQ9Y4jEBQi?cluster=devnet) |
| settle #2 [14–20] | [`3QLGU1Wo…5MuAFALv`](https://explorer.solana.com/tx/3QLGU1WooLt4eT4bGHK6kjiopQkXA4VQNcyCX5FJDTjCbpwst6g5hgtdtTzFZeUGbL8nTKj3qBgiymhX5MuAFALv?cluster=devnet) |
| settle #1 [7–13] | [`4ggsfkUk…68fxp1rY`](https://explorer.solana.com/tx/4ggsfkUkxKjbczJRBL9ZkTRD3M28P83N9ipj63poiPLozjRekKhUvKePBBZgEe9DzB1pDndxkvt5efyg68fxp1rY?cluster=devnet) |
| settle #0 [0–6] | [`JPyVhrxU…xTEA9u4a`](https://explorer.solana.com/tx/JPyVhrxUBBsrqb5nerVtgAzxJu1MDKjgMgmwdsFpdpNu6tcz16G4UTFzq5dtdd2b2xgwM63wHinGDryxTEA9u4a?cluster=devnet) |

The 42 order signatures are in the run log of `uncross/scripts/devnet-multibatch.mjs`, and placement is reproducible with that script.

<p class="sources">Sources: <code>docs/phase2.md</code> (Task 1, multi-batch run, stress run), <code>uncross/programs/uncross/src/clearing.rs</code> (tests <code>both_sides_fill_to_the_same_total</code>, <code>per_order_floor_cannot_starve_the_seller</code>, <code>realistic_book_balances_at_a_non_round_price</code>).</p>
