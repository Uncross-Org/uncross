---
title: What Pyth is used for
description: Pyth can break a tie between clearing prices the book already supports, and only when its price passes an on-chain gate. It never sets the price.
---

[Pyth](https://pyth.network) is an oracle network that publishes prices, including US stock prices, on Solana. Uncross gives it a narrow, deliberate role.

## A tie-break, not a price source

The clearing price is chosen by four rules, in order ([The clearing rule](/mechanism/clearing-rule/)):

1. the price that trades the most shares;
2. among ties, the one where buying and selling interest is most balanced;
3. **among remaining ties, the one nearest a Pyth price that passed the gate;**
4. otherwise, the midpoint of the tied range.

Pyth only ever chooses between prices the book already supports equally well, on volume and on balance. It cannot move the clearing price outside that set, add volume, or override the book. When the gate fails, rule 3 is skipped and rule 4 decides.

## Which feed

Pyth publishes two AAPL feeds that are easy to confuse:

| Feed | ID | Described as |
|---|---|---|
| `Equity.US.AAPL/USD` | `49f6b65c…5ad55688` | Apple Inc / US dollar |
| `Equity.Index.AAPL/USD` | `aaba35e6…0030f36` | "Pyth price in USD for AAPL 24/7" |

On Solana mainnet, AAPL exists only as a push-oracle `PriceUpdateV2` account owned by the Pyth receiver program. The live one is `D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW`. Which feed it carries was not assumed: the account was read and its feed-ID field (bytes 41–72) decoded. It is `Equity.US.AAPL/USD`, the regular equity feed, not the 24/7 index variant.

That one feed is bound everywhere. The program stores it per auction, the keeper passes it when opening AAPLx auctions, the app reads that account, and the site's mainnet proxy allows reads of that one account and nothing else.

Of the ten tickers on cadence, five have a live mainnet Pyth account: AAPLx, NVDAx, TSLAx, GOOGLx and MSTRx. The other five (HOODx, IBMx, XOMx, JPMx and ORCLx) have a Pyth feed ID but **no price account on Solana**, on any shard. For them the auction book is the only on-chain price there is. That is the case Uncross is built for.

## What actually happens on devnet

Uncross runs on devnet, and Pyth does not publish a live AAPL price there.

- **Tickers with a devnet Pyth account** (the five above). The keeper passes the freshest devnet account it can find. Those accounts were last published on 2 July 2026, so the gate rejects them as **stale** at every cross. The first cross after the recording upgrade recorded `stale` with publish time 1783000135, which is 2 July.
- **Tickers with no Pyth account.** The keeper currently opens their auctions bound to the feed ID. At the cross it has nothing real to pass, so it passes the System Program in its place, and the gate records **wrong owner**. That is true of the placeholder but misleading about the ticker. A keeper change committed on 24 Sept opens these tickers with no feed, so the gate records **no feed configured** instead. Per its commit message, it deploys after the 24 Sept community auction.

So on devnet the gate is exercised on its failure path at every cross, and every auction clears by the book alone. **The passing path has never run on chain.** It is covered by unit tests built from the real mainnet account's bytes ([The on-chain gate](/pyth/gate/#tests)).

## The price the app shows

The Pyth price on a ticker's page is the **mainnet** price, read directly from the mainnet account through a same-origin proxy that allows reads of that one account only. The app labels it as an external reference, with its age, and marks it stale after 90 seconds, the same limit the program uses. It is shown for context, and as the first suggested price in the order form. It never feeds the devnet auction's price.

## Why not more?

A reference price tells you what an asset is worth, not whether you can trade there ([Why a call auction](/mechanism/why-call-auctions/)). Pyth's on-chain account also carries no trading-session marker. A thin overnight print and a liquid midday print look the same on chain ([After the close: a retraction](/pyth/after-hours/)). Using it only to break exact ties, and only when fresh and tight, keeps the book in charge of the price.

<p class="sources">Sources: <code>docs/pyth.md</code> §1, §4, §5, <code>uncross/programs/uncross/src/clearing.rs</code>, <code>oracle.rs</code>, <code>uncross/scripts/tickers.json</code>, <code>uncross/scripts/keeper.mjs</code>, commit <code>803c141</code> (keeper "no feed" change).</p>
