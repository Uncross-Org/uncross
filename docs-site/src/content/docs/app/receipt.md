---
title: Your receipt
description: What your order came to after the cross, field by field, and where each figure comes from.
---

After an auction crosses, the app shows **Your result** under the order form. It covers every order you had in that auction. It stays on screen after the next auction opens, because it is keyed to your orders, not to the ticker's newest auction.

## The heading

- **Cleared at $X per share**: the auction's single clearing price. If nothing traded, it reads **No trade this round**.
- **Settling** or **Settled**: whether the settlement transaction has landed yet, with its time once it has.
- A link to the auction account on Solana Explorer.

## Each order

| Field | What it is |
|---|---|
| Status | One of the seven [order statuses](/mechanism/order-statuses/), with a one-line explanation |
| **N of M shares filled** | Shares that traded, out of shares you asked for |
| **Your limit** | Your max (buy) or min (sell) price per share |
| **Clearing price** | The price every fill in the auction traded at |
| **You paid** (buy) | What the program charged this order at the cross |
| **AAPLx delivered** (buy) | The shares that arrived in your wallet in the settlement transaction |
| **You received** (sell) | What arrived in your wallet in the settlement transaction |
| **Returned to you** | What came back: test dollars for a buy (unused escrow), shares for a sell (unfilled shares) |
| **Settlement** (or **Cancelled**) | The transaction that paid the order out, linked to Explorer. "not landed yet" until it does. |

A filled buy also says how much less than your limit you paid per share. A filled sell says how much more than your limit you received.

If one settlement transaction paid several of your orders at once, their token movements cannot be split between them. The receipt then shows the total that came back for all of them together.

## Where the figures come from

Every figure is on-chain settlement data, from one of two sources. The receipt never mixes them.

**Live.** The auction account still exists. The fill, the clearing price and what each order paid or received are the program's own per-order record, written at the cross. What came back is your wallet's token movement in the settlement transaction.

**Rebuilt.** The auction has since been closed and its rent returned, so its per-order record is gone. The receipt says so. The fill comes from your order account, which is never closed. What was paid, received and returned comes from the settlement transaction's token movements. The clearing price is worked back from those: what was paid ÷ what filled.

A rebuilt receipt is only possible because order accounts are never closed ([Costs and rent](/mechanism/costs/)). The keeper does not close an auction holding an order from anyone other than the test bot, so a participant's auction normally keeps its live record.

The app reads your orders through the site's `/api/orders`, which finds every order account your wallet owns, with each order's auction and the transactions that placed and settled it. It refreshes every 10 seconds. A settled order's transactions are cached on the server, because they cannot change.

## Checking it yourself

Everything on the receipt can be checked independently: the auction account for the fill and money legs, and the settlement transaction for the transfers. [Verify a clearing price](/trust/verify/) walks through it on a real auction.

<p class="sources">Sources: <code>web/src/components/Receipt.tsx</code>, <code>web/src/lib/settlement.ts</code> (<code>receiptOf</code>), <code>docs/numbers.md</code> (Your orders, the receipt, Orders and Portfolio).</p>
