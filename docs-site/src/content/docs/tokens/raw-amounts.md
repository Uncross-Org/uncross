---
title: Raw amounts and splits
description: Why the program stores raw token amounts, never display amounts, and how that makes a stock split mid-auction harmless.
---

## Raw amounts and display amounts

A token's balance is stored on chain as a whole number of its smallest units, the **raw amount**. xStocks have 8 decimals, so one token is 100,000,000 raw units.

xStocks also carry Token-2022's **scaled UI amount** extension, a multiplier *m* set by the issuer:

> display amount = raw amount × *m*

One displayed unit is one real share. So one raw token is worth *m* shares. On the real mints, *m* is close to 1. AAPLx was about 1.0033 and IBMx about 1.0204 when read on mainnet during Phase 2. The multiplier absorbs corporate actions such as dividends and splits.

## How issuers apply a split

To express a 2-for-1 split, the issuer doubles *m*. Every holder's raw balance is unchanged, and every wallet's displayed balance doubles at once. Issuers do use this. When read on mainnet, the PreStocks SPACEX token had a scheduled 5× multiplier (a 5:1 split), and OPENAI a 1.486× one.

The extension can also **schedule** a change: a `newMultiplier` with an effective timestamp. The effective multiplier is the new one once that time has passed, and the old one before.

## Why Uncross uses raw amounts only

Everything in the program is raw: order quantities, escrow, fills, and prices. Prices are quote units per whole raw token. A multiplier change between order entry and the cross changes nothing the program has recorded or will compute.

If the program stored display amounts instead, a split mid-auction would silently change what every open order means. A sell of "10 shares" escrowed before a 2-for-1 split would be 20 shares after it, while the program still thought 10.

The one place the program reads the multiplier is the Pyth conversion. Pyth quotes per share, so a passing price is multiplied by the **effective** multiplier before it is compared with limits ([The on-chain gate](/pyth/gate/#converting-the-price-to-the-auctions-units)).

## What the app does

People think in shares and dollars per share, so the app converts at the edges, with the mint's effective multiplier:

- shares you type → raw units: shares ÷ *m* × 10⁸;
- your price per share → program price: price × *m* × 10⁶;
- and back again for everything it displays.

A ticker whose multiplier is not 1 says so on its page. Details: [Units and decimals](/reference/units/).

## Tested: a split in the middle of an auction

On a devnet fixture mint the multiplier was changed mid-auction, between order entry and the cross. Every fill and refund came out exactly as predicted beforehand. The wallet display doubled. The accounting did not move. See [Test: split mid-auction](/devnet/split-test/).

<p class="sources">Sources: <code>docs/phase2.md</code> (per-share vs per-token bug, multipliers read on mainnet, PreStocks scheduled multipliers), <code>docs/phase1.md</code> (multiplier test), <code>uncross/programs/uncross/src/oracle.rs</code> (<code>effective_multiplier</code>), <code>web/src/lib/units.ts</code>.</p>
