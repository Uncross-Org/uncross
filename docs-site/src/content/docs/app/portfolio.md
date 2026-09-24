---
title: Portfolio page
description: What your wallet holds on devnet, and how much of it is locked in orders waiting for a cross.
---

On a batch venue, what you have comes in two parts:

- **In wallet:** yours to use now.
- **Locked:** held by an auction's vault as the escrow of an order that has not been paid out. Dollars sit behind a buy, shares behind a sell.

The Portfolio page shows both for every asset, with the orders holding the locked part and when each one crosses.

## Test dollars

The headline is your total test-dollar balance: what is in your wallet plus what is locked in buy orders, for example "$1,000.00 in wallet · $339.72 locked in 1 buy order".

## Shares

| Column | What it is |
|---|---|
| Asset | The ticker |
| In wallet | Shares in your wallet's token account for that ticker |
| Locked in sell orders | Shares escrowed by your sell orders that have not settled |
| Total shares | The two together |
| Reference price | The ticker's Pyth price on mainnet, read every 30 s, marked stale when older than 90 s |
| Value | Total shares × the reference price |

**Not valued:** a ticker with no Pyth price on Solana is listed but not valued. That covers HOODx, IBMx, XOMx, JPMx and ORCLx. SOL is shown but not valued either. It pays transaction fees and each order's account rent.

## Where the numbers come from

- **In wallet:** every token account your wallet owns, read from chain every 20 seconds.
- **Locked:** the escrow of every order that is neither settled nor cancelled, from your order accounts.
- **Value:** mainnet Pyth, read-only. Values are a convenience. The test tokens have no real value.

<p class="sources">Sources: <code>web/src/components/PortfolioPage.tsx</code>, <code>docs/numbers.md</code> (Portfolio), <code>uncross/scripts/tickers.json</code>.</p>
