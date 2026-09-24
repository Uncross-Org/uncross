---
title: Connect a wallet
description: Switching a Solana browser wallet to devnet and connecting it to the app.
---

Uncross runs on Solana **devnet**. Your wallet has to be set to devnet too, or it will look for your balances on the wrong network.

## Switch to devnet

- **Phantom:** Settings → Developer Settings → Testnet Mode → Devnet.
- **Solflare:** the network dropdown → Devnet.
- **Backpack** and other wallets: look for a network or developer setting and choose Solana devnet.

Nothing on devnet is worth anything. Tokens there are free, and you cannot lose money.

## Connect

Open [uncross.0xo.in/app](https://uncross.0xo.in/app) and click **Select Wallet**. The app finds any wallet installed in your browser that supports the Wallet Standard, including Phantom, Solflare and Backpack. Pick yours and approve.

Once connected, the order form shows your balances for the ticker you are viewing and for the test dollar. If you have none, the app offers [test tokens](/app/test-tokens/).

## What the app can and cannot do with your wallet

The app can only **ask** your wallet to sign a transaction. You approve each one in the wallet: placing an order, cancelling one, or (if you choose) running a cross or settlement. It cannot move anything without your approval.

What it asks you to sign is always an instruction to the Uncross program, `Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP`, sometimes preceded by creating your own token accounts. Your wallet shows each transaction before you approve it, and every one is public on [Solana Explorer](https://explorer.solana.com/?cluster=devnet) afterwards.

## Checked with a real browser wallet

On 24 Sept, on the live site, a wallet that had never existed went through the whole path in a fresh browser. It connected through Wallet Standard, took a faucet grant, placed two orders, cancelled one while the auction was open, and was refused a cancel once the auction froze. Then it got the second order's receipt at the cross. The script that drives it is `uncross/scripts/order-path-browser.mjs`, and the signatures are in [Transaction index](/trust/transactions/).

<p class="sources">Sources: <code>docs/community-auction.md</code>, <code>web/src/main.tsx</code>, <code>docs/submission-draft.md</code> (browser-wallet run).</p>
