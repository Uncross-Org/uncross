---
title: Error codes
description: Every error the Uncross program can return, its code, its message, and what triggers it.
---

Anchor numbers a program's custom errors from 6000. Explorer shows a failed Uncross transaction's error as `custom program error: 0x…`: the hex of the code below.

| Code | Hex | Name | Message | Raised by |
|---|---|---|---|---|
| 6000 | 0x1770 | `InvalidWindow` | close_slot must be after open_slot | `initialize_auction` |
| 6001 | 0x1771 | `FreezeTooLong` | freeze_slots must be smaller than the auction window | `initialize_auction` |
| 6002 | 0x1772 | `AuctionNotOpen` | auction is not accepting orders | `place_order` |
| 6003 | 0x1773 | `OutsideOpenWindow` | current slot is outside the auction's open window | `place_order` |
| 6004 | 0x1774 | `OrderBookFull` | auction order book is full | `place_order` (63 orders) |
| 6005 | 0x1775 | `ZeroQuantity` | quantity must be greater than zero | `place_order` |
| 6006 | 0x1776 | `ZeroPrice` | limit_price must be greater than zero | `place_order` |
| 6007 | 0x1777 | `OrderAuctionMismatch` | order does not belong to this auction | `cancel_order`, settlement |
| 6008 | 0x1778 | `NotOrderOwner` | only the order owner may cancel it | `cancel_order` |
| 6009 | 0x1779 | `PastFreezeWindow` | order is past the cancellation freeze window | `cancel_order` |
| 6010 | 0x177a | `AlreadyCancelled` | order already cancelled | `cancel_order` |
| 6011 | 0x177b | `AlreadySettled` | order already settled | `cancel_order` |
| 6012 | 0x177c | `AuctionNotClosed` | clearing can only run after the auction closes | `compute_clearing` |
| 6013 | 0x177d | `NotYetCleared` | settlement requires clearing to have run first | settlement |
| 6014 | 0x177e | `OrderIndexOutOfRange` | order index out of range | settlement (index, account count, or order address mismatch) |
| 6015 | 0x177f | `BatchTooLarge` | too many orders in one settlement batch | settlement (0 or more than 12) |
| 6016 | 0x1780 | `MathOverflow` | math overflow | `place_order` |
| 6017 | 0x1781 | `WrongMint` | wrong token account for this order's owner | settlement |
| 6018 | 0x1782 | `OrderIndexMismatch` | order_index must equal the auction's current order count | `place_order` |
| 6019 | 0x1783 | `SettlementPathLocked` | auction is already being wound down on the other settlement path | settlement |
| 6020 | 0x1784 | `AuctionNotSettled` | auction can only be closed once every order is settled | `close_auction` |
| 6021 | 0x1785 | `VaultNotEmpty` | auction can only be closed once both vaults are empty | `close_auction` |
| 6022 | 0x1786 | `WrongRentRecipient` | rent can only be returned to the account that paid it | `close_auction` |
| 6023 | 0x1787 | `UnknownRentPayer` | auction predates rent tracking and cannot be closed | `close_auction` |
| 6024 | 0x1788 | `RefundNotAllowed` | the refund path is only for when settlement cannot run: the mint must be paused | `cancel_and_refund`, unless the ticker mint is paused or the refund path is already chosen. Added 24 Sept; checked before any other refund check, so a mid-window or partly settled refund now returns this rather than `NotYetCleared` or `SettlementPathLocked`. |

"Settlement" means both `settle_batch` and `cancel_and_refund`.

## Errors from other programs

- **Token-2022 `0x43`**: "Transferring, minting, and burning is paused on this mint". The ticker's issuer has paused it. Settlement fails atomically and changes nothing ([Test: pause mid-auction](/devnet/pause-test/)).
- **Anchor constraint errors** (codes 2000–2999): an account passed does not match what the instruction requires, for example a vault that is not the auction's own.

## How the app shows them

The app turns the common ones into a sentence. For example, `PastFreezeWindow` reads "Cancellations are closed during the freeze window." When an order loses a race for its order index (`OrderIndexMismatch`), the app retries once on its own.

<p class="sources">Sources: <a href="https://github.com/Uncross-Org/uncross/blob/532dcb736e8aa2c811e8b4704a8f36ec0c0f0a73/uncross/programs/uncross/src/errors.rs"><code>errors.rs</code></a> (order, names and messages), <code>lib.rs</code> (where each is raised), <code>docs/phase2.md</code> (<code>SettlementPathLocked</code> = 6019 observed on chain), <code>web/src/lib/tx.ts</code>.</p>
