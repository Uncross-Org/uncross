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

On Solana mainnet, AAPL exists only as a push-oracle `PriceUpdateV2` account owned by the Pyth receiver program. The one the app reads is shard 1, `D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW`. Which feed it carries was not assumed: the account was read and its feed-ID field (bytes 41–72) decoded. It is `Equity.US.AAPL/USD`, the regular equity feed, not the 24/7 index variant.

That one feed is bound everywhere. The program stores it per auction, the keeper passes it when opening AAPLx auctions, the app reads that account, and the site's mainnet proxy allows reads of that one account and nothing else.

Of the ten tickers on cadence, five have a Pyth price account on Solana mainnet: AAPLx, NVDAx, TSLAx, GOOGLx and MSTRx. These are sponsored push accounts: Pyth keeps them updated, not Uncross.

:::caution[The mainnet accounts stopped updating on 28 Sept 2026]
All five stopped within eleven seconds of each other, at 11:53 UTC on 28 Sept 2026. On 3 Oct 2026 the freshest price for each of these feeds, in any `PriceUpdateV2` account on Solana mainnet, was still from that moment. No other shard of these feeds exists (shards 0–7 checked). The app shows the reference as too old to use, which is correct.

Pyth's Hermes service, which serves the latest prices off chain, has required an API key since 26 Aug 2026. So whether Pyth itself is still publishing these feeds could not be checked anonymously, and these docs do not claim either way.
:::

The other five (HOODx, IBMx, XOMx, JPMx and ORCLx) have a Pyth feed ID but **no price account on Solana**, on any shard. For them the auction book is the only on-chain price there is. That is the case Uncross is built for.

## What actually happens on devnet

Uncross runs on devnet, and Pyth does not publish a live AAPL price there.

- **Tickers with a devnet Pyth account** (the five above). The keeper passes the freshest devnet account it can find. Those accounts were last published on 2 July 2026, so the gate rejects them as **stale** at every cross. The first cross after the recording upgrade recorded `stale` with publish time 1783000135, which is 2 July.
- **Tickers with no Pyth account.** Since 25 Sept the keeper opens their auctions with no feed bound, and the gate records **no feed configured**. The first to cross after the change was ORCLx auction [`8JYU6SRZ…iQKJ7Wsk`](https://explorer.solana.com/address/8JYU6SRZqRCgcny11FhzdoP3pNAEMaPJr12miQKJ7Wsk?cluster=devnet), which recorded code 2. Before that, these auctions were bound to the feed ID. The keeper then had nothing real to pass at the cross, so it passed the System Program in its place, and the gate recorded **wrong owner**. That was true of the placeholder but misleading about the ticker. Auctions from before the change, including the 24 Sept community auction's IBMx book, still read "wrong owner".

So on devnet the gate is exercised on its failure path at every cross, and every auction clears by the book alone. **The passing path has never run on chain.** It is covered by unit tests built from the real mainnet account's bytes ([The on-chain gate](/pyth/gate/#tests)).

## The price the app shows

The Pyth price on a ticker's page is the **mainnet** price, read directly from the mainnet account through a same-origin proxy that allows reads of that one account only. The app labels it as an external reference, with its age, and marks it stale after 90 seconds, the same limit the program uses. It is shown for context, and as the first suggested price in the order form while it is fresh. It never feeds the devnet auction's price. Since 28 Sept 2026 the account has not updated, so the app shows its last price as too old to use and does not suggest it.

## Why not more?

A reference price tells you what an asset is worth, not whether you can trade there ([Why a call auction](/mechanism/why-call-auctions/)). Pyth's on-chain account also carries no trading-session marker. A thin overnight print and a liquid midday print look the same on chain ([After the close: a retraction](/pyth/after-hours/)). Using it only to break exact ties, and only when fresh and tight, keeps the book in charge of the price.

<p class="sources">Sources: <code>docs/pyth.md</code> §1, §4, §5; mainnet reads on 3 Oct 2026 of every <code>PriceUpdateV2</code> account for the five feeds and of shards 0–7; <code>uncross/programs/uncross/src/clearing.rs</code>, <code>oracle.rs</code>, <code>uncross/scripts/tickers.json</code>, <code>uncross/scripts/keeper.mjs</code>, commit <code>803c141</code> (keeper "no feed" change).</p>
