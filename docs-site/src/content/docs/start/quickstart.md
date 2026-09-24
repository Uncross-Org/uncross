---
title: "Quickstart: your first order"
description: From an empty wallet to a settled order, in six steps. Everything is on devnet and uses test tokens.
---

Everything here happens on Solana **devnet**, with test tokens that are worth nothing. You cannot lose money.

## 1. Switch your wallet to devnet

You need a Solana browser wallet, such as Phantom, Solflare or Backpack, set to devnet.

- **Phantom:** Settings → Developer Settings → Testnet Mode → Devnet.
- **Solflare:** the network dropdown → Devnet.

More in [Connect a wallet](/app/wallet/).

## 2. Open the app and connect

Go to [uncross.0xo.in/app](https://uncross.0xo.in/app) and pick a ticker from the sidebar, for example AAPLx. Click **Select Wallet** and approve the connection.

## 3. Get test tokens

A new wallet has nothing to trade with, and the test tokens exist only on this venue. Click **Get test tokens**. One grant sends:

- 0.02 devnet SOL, for transaction fees and each order's account rent;
- 12 tokens of the ticker you are viewing, and of AAPLx and IBMx (12 tokens is 12 shares where the ticker's multiplier is 1; see [Raw amounts and splits](/tokens/raw-amounts/));
- 6,000 test dollars (a USDC-shaped test token).

One grant per wallet every three hours. More in [Get test tokens](/app/test-tokens/).

## 4. Place an order

Choose **Buy** or **Sell**. Enter a price per share and a number of shares. The form suggests prices you can tap: the Pyth reference where the ticker has one, what the book would clear at, and the best bid and ask. Approve the transaction in your wallet.

Your order does not trade now. It waits in the book with its funds locked:

- a **buy** locks shares × your max price in test dollars;
- a **sell** locks the shares.

More in [Place an order](/app/placing-an-order/).

## 5. Wait for the cross

The countdown shows when the auction crosses. Until the **freeze** (the last 700 slots, about two minutes) you can cancel and get everything back. During the freeze you can still place orders, but no order can be cancelled.

When the window closes, the program computes one clearing price. Everyone whose limit allows it fills at that price. [The clearing rule](/mechanism/clearing-rule/) explains how the price is chosen.

## 6. Read your receipt

Seconds after the cross, settlement lands and your receipt appears under the order form. It shows:

- whether you filled, and how many shares;
- your limit and the clearing price;
- what you paid or received, and what came back to you;
- a link to the settlement transaction.

The receipt stays on screen after the next auction opens. Every order you have placed is on the **Your orders** page, and your balances, including what is locked in orders, are on **Portfolio**. See [Your receipt](/app/receipt/), [Orders page](/app/orders/) and [Portfolio page](/app/portfolio/).

<p class="sources">Sources: <code>docs/community-auction.md</code> (the participant path, tested from a fresh wallet), <code>web/src/components/GetTestTokens.tsx</code>, <code>OrderForm.tsx</code>, <code>Receipt.tsx</code>, <code>uncross/scripts/faucet.mjs</code>.</p>
