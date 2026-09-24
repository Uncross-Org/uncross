---
title: Read a ticker page
description: Every number on a ticker's page, where it comes from, and how often it refreshes.
---

The dashboard follows one rule: never show a value whose meaning can't be explained in one sentence. This page gives that sentence for every figure.

The top of a ticker's page keeps two sources apart:

- **This auction** is produced by Uncross, from the orders in the book, on devnet.
- **External reference** is Pyth. It is the only number that comes from outside Uncross.

## This auction

| Shown as | What it is | Refresh |
|---|---|---|
| **Would clear at** (before the cross) | The price the auction would clear at if it crossed now. The program writes it on every order and every cancel, by running the clearing rule over the live book with no oracle price. | Live: a websocket subscription to the auction account, plus a poll every 8 s (every 4 s where the endpoint has no websocket) |
| **N shares would trade if the auction crossed now** | The volume at that price, the smaller of demand and supply, converted to shares with the ticker's multiplier | As above |
| **Cleared at**, **N shares traded** (after the cross) | The clearing price and volume the program wrote once, at the cross, with a Pyth price if one passed the gate | As above |
| **Best bid** | The highest limit among live buy orders, worked out in your browser | As above |
| **Best ask** | The lowest limit among live sell orders | As above |
| **Crosses in** | (close slot − current slot) × the measured slot time. The slot is read every 12 s and counted forward between reads. The slot time comes from the network's recent performance samples every 2 minutes, about 0.166 s on devnet. | Every second, estimated |
| **Orders can be cancelled for …** | (close slot − freeze slots − current slot) × slot time | Every second, estimated |

**Would clear at vs cleared at.** Before the cross no oracle price is used, so the final price can differ from the last "would clear at" only if a tie survives the imbalance rule and a Pyth price passes the gate. On devnet the gate usually fails as stale, so in practice the two agree.

**Bid above ask.** In a continuous market that would be broken data. Here it is the mechanism: nothing executes on arrival, so buyers and sellers overlap until the cross, and the overlap is what trades. The page says so whenever it happens.

**A ticker whose multiplier is not 1** says so under "This auction". Every price and quantity on the page is converted to dollars per share and shares ([Units and decimals](/reference/units/)).

## External reference

| Shown as | What it is | Refresh |
|---|---|---|
| **Pyth · XXX/USD** | The ticker's Pyth price account on **Solana mainnet**, read through the site's `/api/rpc` proxy, with public endpoints as fallback. Price × 10^exponent. | Every 12 s |
| **Published Ns ago** | Now − the price's publish time. Over 90 s is marked **stale**, the same limit the program uses. | Every second |
| **Extended hours** | Pyth's own schedule for the feed says the market is closed, but the price is still fresh | Schedule read hourly |
| **Last check: stale, not used** | What the program's eight-condition gate recorded at the latest cross of this ticker. The program checks the **devnet** Pyth account the keeper passes in, not the mainnet one shown above. | Every 30 s |

The price shown is mainnet Pyth. The auction's own check reads devnet Pyth at the cross, and uses it only to break a tie, never to set the price. The devnet accounts were last published on 2 July 2026, so most auctions record "stale" ([What Pyth is used for](/pyth/role/)).

## Sidebar

| Shown as | What it is |
|---|---|
| **Price** | The clearing price of the ticker's latest auction that traded. Muted once more than an hour old. Hover to see when that auction's window closed. |
| **open · crosses in Nm** / **frozen · crosses in Nm** | Shown whenever the ticker's newest auction is taking orders, rounded up to the minute |
| **last cross N ago** | Time since the window closed on the ticker's last auction that traded. Not the settlement time, which follows seconds later. |
| **between auctions** | The few seconds between one auction's cross and the next one opening |

The sidebar reads the site's cached venue feed, refreshed every 15 s (the server refreshes its own read every 10 s). The ticker page reads the auction account directly. So the sidebar can lag the page by up to about 25 seconds.

Tickers show different timing because there is no shared schedule. Each ticker's next auction opens when its last one ends. See [Auction lifecycle](/mechanism/lifecycle/#timing).

## Charts and past crosses

**Candles.** One candle per auction. Open and close are clearing prices. High and low are the range of **limit prices placed**, not trades, because only one price trades per auction.

**Depth.** Cumulative demand and supply curves for the current book. Where they cross is where the auction would clear.

**Past crosses.** One row per auction: when its window closed, clearing price, volume, number of orders, **Pyth anchor**, and status (Settled, Settling or Refunded). "Pyth anchor: Yes" means a fresh Pyth price passed the gate and was recorded at that cross.

## The auction page

Every auction has its own page, opened from **Past crosses**, from a receipt or from the Orders page. For example, the [23 Sept MSTRx cross](https://uncross.0xo.in/app?view=auction&auction=6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7). It shows:

- every order, with its wallet, limit, fill and what it paid or received;
- the demand and supply curves at the cross;
- the clearing rule replayed step by step from the auction account, with the candidate prices, which rule set the price, and a check that the replay matches the price the program recorded;
- the Pyth check the program recorded;
- every transaction, labelled by what it did.

See [Verify a clearing price](/trust/verify/) for doing the same check yourself.

## The footer

Every page's footer shows how long ago the last auction opened and how many new wallets the faucet can still fund. A banner appears only when something is wrong: no auction has opened for 25 minutes, or the faucet has reached its cap.

<p class="sources">Sources: <code>docs/numbers.md</code> (every figure, source and refresh interval), <code>web/src/components/PastAuctions.tsx</code>, <code>web/src/App.tsx</code>, <code>web/src/components/AuctionPage.tsx</code>, <code>web/src/components/VenueStatus.tsx</code>.</p>
