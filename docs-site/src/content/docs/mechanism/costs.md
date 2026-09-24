---
title: Costs and rent
description: What an order costs in SOL, what comes back, and why order accounts are never closed.
---

Uncross charges **no trading fee**. The auction account has a `protocol_fee_bps` field, but the program always sets it to 0 and never reads it. What an order costs is Solana's own charges: a transaction fee, and rent for the accounts it creates.

On devnet all of this is paid in free test SOL. The faucet's 0.02 SOL grant covers several orders.

## Per order

| Item | SOL | Returned? |
|---|---|---|
| Order account rent (111 bytes) | 0.00121412 | **No, by design** (below) |
| Transaction fee | 0.000005 base fee per signature | No |
| Your token accounts for the ticker and test dollar, if they do not exist yet | one-time rent | Created by the faucet grant, at the faucet's expense. The order transaction creates any that are missing, at yours. |

The app warns when a wallet's balance falls below 0.005 SOL, and says each order needs about 0.002 SOL for its account and fees. The app's transactions set no priority fee.

## Why order accounts are never closed

Each order creates an account that records the owner, side, limit, quantity, escrow and filled quantity. Every settlement transaction touches it. So after the auction itself has been closed and its record deleted, the order account still lets any participant rebuild their own outcome from chain:

- the fill, from the account;
- what they paid and got back, from the settlement transfers in its transaction history.

The app's receipts and Orders page rely on exactly this. They start from the wallet's order accounts, and a receipt for a closed auction is marked "rebuilt from the settlement transaction" ([Your receipt](/app/receipt/)).

Closing order accounts to return their rent was designed as an optimisation, and cancelled on 23 Sept 2026 for this reason. The program's source says no instruction should be added to close one. The 0.00121412 SOL per order is the price of the guarantee.

## Per auction

Opening an auction creates the auction account (2,880 bytes) and two vault token accounts. Their combined rent is about **0.0183 SOL**, paid by whoever opens it. That is the keeper, or the faucet service for auctions opened from the app.

`close_auction` returns all of it to the recorded payer once the auction is settled and both vaults are empty ([Auction lifecycle](/mechanism/lifecycle/#7-closing-and-rent-reclaim)). With that, opening, crossing, settling and closing an auction costs about **0.00002 SOL net**, down from about 0.018 SOL before the reclaim existed.

Auctions created before the reclaim upgrade on 16 Sept recorded no payer. They can never be closed, and their rent stays locked. How much, and the 119 auctions a keeper bug stranded, are in [Honest limitations](/trust/limitations/).

<p class="sources">Sources: <code>uncross/programs/uncross/src/state.rs</code> (<code>Order</code> and its comment, <code>Order::SIZE</code>), <code>lib.rs</code> (<code>protocol_fee_bps = 0</code>, <code>close_auction</code>), <code>README.md</code>, <code>docs/submission-draft.md</code>, <code>docs/phase1.md</code> (base fee), <code>web/src/components/OrderForm.tsx</code>, <code>web/src/lib/tx.ts</code>, <code>uncross/scripts/faucet.mjs</code>.</p>
