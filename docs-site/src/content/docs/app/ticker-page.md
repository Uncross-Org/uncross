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
| **Crosses in** | (close slot − current slot) × the measured slot time. The slot is read every 12 s and counted forward between reads. The slot time comes from the network's recent performance samples every 2 minutes. It drifts: about 0.166 s on devnet in late September, about 0.235 s on 3 Oct 2026. | Every second, estimated |
| **Orders can be cancelled for …** | (close slot − freeze slots − current slot) × slot time | Every second, estimated |

**Would clear at vs cleared at.** Before the cross no oracle price is used, so the final price can differ from the last "would clear at" only if a tie survives the imbalance rule and a Pyth price passes the gate. On devnet the gate usually fails as stale, so in practice the two agree.

**Bid above ask.** In a continuous market that would be broken data. Here it is the mechanism: nothing executes on arrival, so buyers and sellers overlap until the cross, and the overlap is what trades. The page says so whenever it happens.

**A ticker whose multiplier is not 1** says so under "This auction". Every price and quantity on the page is converted to dollars per share and shares ([Units and decimals](/reference/units/)).

## External reference

| Shown as | What it is |
|---|---|
| **Pyth · XXX/USD** | When there is no fresh Pyth print for the ticker, which today is always, one line: "No live Pyth price for this ticker. The book alone sets the clearing price." No old price, age or warning is shown. |
| A price, "Published Ns ago on Solana mainnet" | Shown only if a fresh print (under 90 seconds old, the program's own limit) exists on Solana mainnet. It is read through the site's `/api/rpc` proxy every 12 s, with "extended hours" added when Pyth's schedule says the market is closed. |

None of the venue's tickers has a live Pyth price today ([What Pyth is used for](/pyth/role/#today-no-live-pyth-price-for-the-venues-tickers)). Whatever the panel shows, it never sets the devnet auction's price; a fresh Pyth price could only break a tie at the cross.

## Sidebar

| Shown as | What it is |
|---|---|
| **Price** | The clearing price of the ticker's latest auction that traded. Muted once more than an hour old. Hover to see when that auction's window closed. |
| **open · crosses in Nm** / **frozen · crosses in Nm** | Shown whenever the ticker's newest auction is taking orders, rounded up to the minute |
| **last cross N ago** | Time since the window closed on the ticker's last auction that traded. Not the settlement time, which follows seconds later. |
| **between auctions** | The few seconds between one auction's cross and the next one opening |
| **Search tickers** | Searches all 120 listed xStocks. A ticker with nothing running opens to its "Open an auction" card ([Open an auction](/app/open-and-crank/)). |

The sidebar reads the site's cached venue feed, refreshed every 15 s (the server refreshes its own read every 10 s). The ticker page reads the auction account directly. So the sidebar can lag the page by up to about 25 seconds.

Tickers show different timing because there is no shared schedule. Each ticker's next auction opens when its last one ends. See [Auction lifecycle](/mechanism/lifecycle/#timing).

## Charts and past crosses

**Candles.** One candle per auction. Open and close are clearing prices. High and low are the range of **limit prices placed**, not trades, because only one price trades per auction.

**Depth.** Cumulative demand and supply curves for the current book. Where they cross is where the auction would clear.

**Past crosses.** One row per auction: when its window closed, clearing price, volume, number of orders, **Pyth anchor**, and status (Settled, Settling or Refunded). "Pyth anchor: Yes" would mean a fresh Pyth price passed the gate at that cross; on the venue's tickers every row reads No.

## The auction page

Every auction has its own page, opened from **Past crosses**, from a receipt or from the Orders page. For example, the [23 Sept MSTRx cross](https://uncross.0xo.in/app?view=auction&auction=6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7). It shows:

- every order, with its wallet, limit, fill and what it paid or received;
- the demand and supply curves at the cross;
- the clearing rule replayed step by step from the auction account, with the candidate prices, which rule set the price, and a check that the replay matches the price the program recorded;
- whether a live Pyth price existed at the cross. For the venue's tickers it reads "No live Pyth price for this ticker at the cross. The book alone set the clearing price.", with the program's recorded reason in its tooltip;
- every transaction, labelled by what it did.

See [Verify a clearing price](/trust/verify/) for doing the same check yourself.

## The footer

Every page's footer shows how long ago the last auction opened and how many new wallets the faucet can still fund. A banner appears only when something is wrong: no auction has opened for 25 minutes, or the faucet has reached its cap.

<p class="sources">Sources: <code>docs/numbers.md</code> (every figure, source and refresh interval), <code>web/src/components/PastAuctions.tsx</code>, <code>web/src/App.tsx</code>, <code>web/src/components/AuctionPage.tsx</code>, <code>web/src/components/VenueStatus.tsx</code>.</p>
