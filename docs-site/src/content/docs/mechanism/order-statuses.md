---
title: Order statuses
description: The seven statuses an order can have in the app, what each means, and where the money is.
---

The app gives every order one of seven statuses. They are the same words everywhere: the receipt, the Orders page and the Portfolio page. They are worked out from on-chain data, from the order account and its auction account.

| Status | What it means | Where your escrow is |
|---|---|---|
| **Open** | Resting in the book. The auction has not reached its freeze. | In the auction's vault. Cancel to get it back at once. |
| **Frozen** | The auction is in its freeze, or its window has closed and the cross has not run yet. It can no longer be cancelled. | In the auction's vault, until settlement. |
| **Filled** | Every share you asked for traded, at the clearing price. | Paid out at settlement. |
| **Partially filled** | Some of your shares traded at the clearing price. The rest were not needed. | Paid out at settlement. |
| **Unfilled** | Your limit was on the wrong side of the clearing price, so nothing traded. | All returned at settlement. |
| **Cancelled** | You cancelled it before the freeze. | All returned in the cancel transaction itself. |
| **Refunded** | The auction was wound down on the refund path, so every order got back everything it locked. | All returned by the refund. |

## What happened to the money, status by status

**Open.** A buy has locked quantity × limit in test dollars; a sell has locked its shares. Both sit in token accounts owned by the auction's PDA, which only the program can move.

**Frozen.** Same as Open, except you can no longer cancel. The status covers both the freeze itself and the short wait between the window closing and the cross being sent.

**Filled.**
- *Buy:* you received all the shares you asked for. You were charged the clearing price per share, and the difference between your limit and the clearing price came back to you. If you bid $250 and it cleared at $247.50, you got $2.50 a share back.
- *Sell:* you received the clearing price for every share, which is at least your limit.

**Partially filled.** Only the best-priced orders fill when more shares are willing to trade than can be matched. The tier at the cut-off is shared in proportion to size ([Who fills at the clearing price](/mechanism/clearing-rule/#who-fills-at-the-clearing-price)).
- *Buy:* you received the shares that filled. What came back is your escrow minus the charge for those shares: the unfilled part, plus your limit-minus-clearing difference on the filled part.
- *Sell:* you received the clearing price for the shares that filled, and your unfilled shares came back.

**Unfilled.** A buy whose limit is below the clearing price, or a sell whose limit is above it, trades nothing. Your full escrow comes back at settlement. An unfilled order can also be one that was willing at the clearing price but lost on price priority, when better-priced orders used up the volume.

**Cancelled.** The cancel transaction returned your full escrow immediately. The order is excluded from the clearing price.

**Refunded.** The auction took the failure path, `cancel_and_refund`, which ignores computed fills and returns every order's full original escrow. It exists for when ordinary settlement cannot run, such as when the issuer has paused the token. It can also be triggered by any wallet that sends a refund batch before the first ordinary settlement ([Auction lifecycle](/mechanism/lifecycle/#6-the-refund-path)). Either way, nothing traded and nothing was lost.

## Crossed but not yet settled

After the cross, an order already shows **Filled**, **Partially filled** or **Unfilled**, because its fill is fixed at the cross. The money moves a few seconds later, when settlement lands. Until then the receipt is marked **Settling**, and amounts still to come read "at settlement".

## How the app decides

In order, the first that applies wins:

1. the order account says it was cancelled → **Cancelled**;
2. the auction was wound down on the refund path → **Refunded**;
3. the auction has not crossed → **Open** before the freeze, **Frozen** after;
4. the fill is zero → **Unfilled**;
5. the fill equals the quantity → **Filled**; otherwise **Partially filled**.

The fill comes from the auction account while it exists, and from the order account once the auction has been closed.

There is no other status. In particular, there is no "failed" status. A transaction that fails on chain changes nothing, so an order either exists with one of the statuses above or was never placed.

<p class="sources">Sources: <code>web/src/lib/settlement.ts</code> (<code>OrderStatus</code>, <code>STATUS_HELP</code>, <code>orderStatus</code>), <code>web/src/lib/auction.ts</code> (<code>auctionPhase</code>), <code>uncross/programs/uncross/src/lib.rs</code>, <code>docs/numbers.md</code>.</p>
