---
title: Place an order
description: The order form, what gets locked, and what happens when you submit, cancel, or reach the freeze.
---

## The form

**Buy or Sell.** Pick a side.

**Max price per share** (buy) or **Min price per share** (sell). This is your limit: the worst price you accept. You will never pay more than a max price or receive less than a min price. If the auction clears at a better price, you get the better price.

Under the price field, the app suggests prices to tap:

- **Pyth reference**, where the ticker has a live Pyth price and it is fresh (under 90 seconds old). The first chip is highlighted as a starting point.
- **Would clear**, the price the book would clear at right now, if it would trade anything.
- **Best bid** and **Best ask** in the current book.

For tickers with no Pyth price on Solana (HOODx, IBMx, XOMx, JPMx, ORCLx), the form says so. There the only price is the one the book makes, and past clearing prices are under **Past crosses**.

**Shares.** How many. For a sell, a **Max** chip fills in your whole balance.

## What gets locked

The summary shows exactly what the order will lock until the cross:

- **Buy:** *Max cost*, which is shares × your max price, rounded up to the micro-dollar. That amount of test dollars is locked.
- **Sell:** *Min proceeds* is shares × your min price. The shares themselves are locked.

"Everyone fills at one price. If it clears below your max, you pay less and the rest comes back." That line under the summary is the whole idea.

## Submitting

Click **Buy N AAPLx** (or Sell) and approve in your wallet. One transaction:

1. creates your token accounts for the ticker and test dollar if they are missing;
2. calls `place_order`, which moves your escrow into the auction's vault and creates your order account.

Orders are numbered in the order they arrive. If someone else's order lands between the app reading the book and your transaction arriving, the program refuses yours with `OrderIndexMismatch`. The app then reads the book again and retries once, automatically.

The form refuses to submit, and says why, when:

- no auction is open, or it is closed to new orders;
- you do not have enough test dollars (buy) or shares (sell);
- your SOL is low. Each order needs about 0.002 SOL for its account and fees.

The program itself also refuses an order when the book already holds 63 orders (`OrderBookFull`).

## After you submit

Your order appears under the form with status **Open**. It does not trade yet. The **Would clear at** figure at the top of the page is recomputed by the program with every order, including yours.

You may see the **best bid above the best ask**. In a continuous market that would be broken data. Here nothing executes on arrival, so buyers and sellers overlap until the cross, and the overlap is what trades.

## Cancelling

Until the freeze, **Cancel** returns everything the order locked in the same transaction.

Once the auction enters its freeze (the last 700 slots, about two minutes), Cancel is disabled, and the program refuses a cancel sent to it directly (`PastFreezeWindow`). You can **still place new orders** during the freeze. The form warns that they cannot be cancelled.

## At the cross

When the window closes, the keeper sends the cross within seconds, and settlement follows. The page announces the result, and [your receipt](/app/receipt/) replaces the open order.

<p class="sources">Sources: <code>web/src/components/OrderForm.tsx</code>, <code>web/src/App.tsx</code> (suggestions), <code>web/src/lib/tx.ts</code> (<code>placeOrderIxs</code>, error messages), <code>uncross/programs/uncross/src/lib.rs</code> (<code>place_order</code>, <code>cancel_order</code>), <code>uncross/scripts/tickers.json</code> (tickers with no Pyth account).</p>
