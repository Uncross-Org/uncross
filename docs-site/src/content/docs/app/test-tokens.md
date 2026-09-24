---
title: Get test tokens
description: The one-click faucet grant that gives a new wallet devnet SOL, test shares and test dollars.
---

The ticker tokens and the test dollar on this venue are fixture mints that belong to the venue. You cannot get them from a public faucet or by swapping. Without a grant, a new wallet can watch an auction but not take part.

## One click

With a wallet connected, the app shows **New here? Get test tokens** whenever the wallet is short of anything it needs. That means less than 0.005 SOL, no shares of the ticker you are viewing, or no test dollars. Click **Get test tokens**.

A grant contains:

| | Amount | Used for |
|---|---|---|
| Devnet SOL | 0.02 | transaction fees and each order's account rent |
| Ticker tokens | 12 of the ticker you are viewing, and of AAPLx and IBMx | selling |
| Test dollars (USDC-shaped) | 6,000 | buying |

A grant tops up rather than adds. SOL is sent only if the wallet has less than 0.02, and each token only if its balance is below the grant amount. The faucet also creates your token accounts for these mints and pays their rent.

12 tokens is 12 shares for a ticker whose multiplier is 1, such as AAPLx. For a ticker with a multiplier, the app shows tokens × multiplier shares. See [Raw amounts and splits](/tokens/raw-amounts/).

When the grant lands, the app says what arrived, with a link to the transaction, and the order form unlocks.

## Limits

The faucet refuses rather than degrading quietly, and its message says why. Limits:

- **One grant per wallet every three hours.**
- **A per-IP hourly count.** It is set loose, because requests reach the faucet through the site's proxy and share an edge address.
- **A global cap** on grants and on SOL paid out. On 24 Sept the cap covered about 40 new wallets, with 31 left that day. A burst of visitors can exhaust it.

If you are refused because of the cap, whoever is running the event can fund a wallet by hand.

<p class="sources">Sources: <code>uncross/scripts/faucet.mjs</code> (grant contents, top-up logic, limits), <code>web/src/components/GetTestTokens.tsx</code>, <code>docs/community-auction.md</code> (reachability, per-IP limit), <code>docs/submission-draft.md</code> (cap figures read from the live faucet on 24 Sept).</p>
