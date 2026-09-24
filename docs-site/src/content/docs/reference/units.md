---
title: Units and decimals
description: Raw units, the program's price unit, and how the app converts both to shares and dollars per share.
---

The program works in raw integer units only. The app converts to shares and dollars per share at the edges.

## The units on chain

| Quantity | Unit | Scale |
|---|---|---|
| Ticker amounts (quantity, escrow for a sell, fills) | raw ticker units | 10⁸ per token (xStocks have 8 decimals) |
| Test-dollar amounts (escrow for a buy, charges, proceeds) | quote atomic units | 10⁶ per dollar (6 decimals) |
| Prices (limit, clearing, indicative, reference) | quote atomic units **per whole raw token** | 10⁶ = $1.00 per token |

So a `clearing_price` of 247,500,000 is $247.50 per token, and an `executable_volume` of 1,000,000,000 is 10 tokens.

The money for a fill is `filled × price ÷ 10⁸`, in quote atomic units. Sellers' proceeds round down. A buy's escrow, `quantity × limit ÷ 10⁸`, rounds up.

## Tokens and shares

xStocks carry a scaled-UI multiplier *m*: one raw token is worth *m* shares ([Raw amounts and splits](/tokens/raw-amounts/)). The app reads each mint's **effective** multiplier (the scheduled new value once its time has passed) and converts:

| From | To | Formula |
|---|---|---|
| shares you type | raw units | round(shares ÷ *m* × 10⁸) |
| raw units | shares shown | raw ÷ 10⁸ × *m* |
| your $ per share | program price | round($ × *m* × 10⁶) |
| program price | $ per share shown | price ÷ *m* ÷ 10⁶ |
| quote atomic | dollars | ÷ 10⁶ |

A ticker whose multiplier is not 1 says so on its page. For AAPLx and MSTRx on devnet *m* is 1, so tokens and shares are the same.

## Slots and time

Auction windows are set in **slots**. A slot is a short period of the Solana clock, and its length is measured, not fixed. The keeper's auctions are 7,000 slots with a 700-slot freeze. At the measured devnet rate of about 6.04 slots per second (0.166 s per slot), that is about 19.3 minutes and 116 seconds. Those minute figures are derived, and they drift with the network ([Auction lifecycle](/mechanism/lifecycle/#timing)).

Pyth publish times and the 90-second freshness check use Unix seconds from the on-chain clock.

<p class="sources">Sources: <code>web/src/lib/units.ts</code>, <code>uncross/programs/uncross/src/clearing.rs</code> (<code>escrow_for_buy</code>, <code>assign_quote_amounts</code>), <code>docs/numbers.md</code> (Units; slot time), <code>docs/submission-draft.md</code> (6.04 slots/s).</p>
