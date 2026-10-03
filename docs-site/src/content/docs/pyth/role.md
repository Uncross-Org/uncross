---
title: What Pyth is used for
description: Pyth can break a tie between clearing prices the book already supports, and only when its price passes an on-chain gate. It never sets the price, and today the venue's tickers have no live Pyth price.
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

## Today: no live Pyth price for the venue's tickers

None of the venue's stock tickers has a live Pyth price on Solana.

- **AAPLx, NVDAx, TSLAx, GOOGLx, MSTRx.** Each has a sponsored push account on Solana mainnet. All five stopped updating within eleven seconds of each other, at 11:53 UTC on 28 Sept 2026. On 3 Oct 2026 the freshest price for each feed, in any `PriceUpdateV2` account on Solana mainnet, was still from that moment, and no other shard of these feeds exists (shards 0–7 checked).
- **HOODx, IBMx, XOMx, JPMx, ORCLx.** These have a Pyth feed ID but no price account on Solana, on any shard.

So at every cross on the venue the gate refuses, the program records why, and the clearing price is set by the book alone:

- **Tickers with a devnet Pyth account** (the first five). The keeper passes the freshest devnet account it can find. Those accounts were last published on 2 July 2026, so the gate records **stale**.
- **Tickers with no Pyth account.** Since 25 Sept the keeper opens their auctions with no feed bound, and the gate records **no feed configured**. The first to cross after that change was ORCLx auction [`8JYU6SRZ…iQKJ7Wsk`](https://explorer.solana.com/address/8JYU6SRZqRCgcny11FhzdoP3pNAEMaPJr12miQKJ7Wsk?cluster=devnet). Earlier auctions on these tickers recorded **wrong owner**, because the keeper passed a placeholder; those records stand, including the 24 Sept community auction's IBMx book.

**No cross on the venue's tickers has ever passed the gate.** Every one has recorded "stale", "no feed configured" or "wrong owner", and cleared on the book alone.

## The pull model, proven once on devnet

Pyth also offers a **pull** model. Anyone fetches a signed price update from Pyth's Hermes service and posts it on chain through the Pyth receiver program. The program needs no change for this, because the gate already accepts any fully verified `PriceUpdateV2` owned by the receiver, for the bound feed.

This was tested end to end on devnet on 3 Oct 2026, with a crypto feed, `Crypto.SOL/USD`:

- A current Hermes update was posted through receiver `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`, fully verified against Wormhole guardian set 1 ([`4AQjwjjd…ygJic36r`](https://explorer.solana.com/tx/4AQjwjjdb8k9VGC96L9zdzCqNX8pyWGyRqP6XhpTcmfdJFJvguZxWaA4NsmzdB4h5YpQ1oNUjXPa9GV3ygJic36r?cluster=devnet) verify, [`bLMA2Zog…5FvZSZ5M`](https://explorer.solana.com/tx/bLMA2ZogjMcsHby5w6jMnWoy1J9m2rBQcADPh1BkmbAsABhJ5RCh7Ao1ze2BZmACpBRAvR9CAUfpbzB5FvZSZ5M?cluster=devnet) post). The account it produced passes every check the gate makes.
- A 150-slot test auction bound to that feed, on an unlisted fixture mint, was then crossed against it ([`5vNJBbGE…7RyHG32r`](https://explorer.solana.com/tx/5vNJBbGEXLEcChv79yRhffEohQyjMz9wHUx5UVs9vhMYwtV6xtjCrxBiwZmRJUPfzisMvgst1dJMZ5WF7RyHG32r?cluster=devnet), block time 18:06:22 UTC). As the test read it from the auction account before closing it, the gate recorded **passed**, with the price published 21 seconds before the cross block.

The test used SOL/USD because the API key used for it is entitled to crypto feeds only; per the test's record, Hermes refuses equity feeds to that key. **The venue's stock tickers are not pulled**, so nothing above changes what happens at their crosses. Every step's signature is in `uncross/scripts/pyth-accept-result.json` and `uncross/scripts/pyth-cross-proof-result.json`.

## The price the app shows

When there is no fresh print, which today is always, a ticker's page says so in one line: **"No live Pyth price for this ticker. The book alone sets the clearing price."** No old price, no age and no warning are shown. The auction page says the same for each cross, with the program's recorded reason in its tooltip.

If a fresh print existed, the page would show it as an external reference, with its age, marked as read from Solana mainnet. It would be offered as a suggested price in the order form. It never feeds the devnet auction's price.

## Why not more?

A reference price tells you what an asset is worth, not whether you can trade there ([Why a call auction](/mechanism/why-call-auctions/)). Pyth's on-chain account also carries no trading-session marker. A thin overnight print and a liquid midday print look the same on chain ([After the close: a retraction](/pyth/after-hours/)). Using it only to break exact ties, and only when fresh and tight, keeps the book in charge of the price.

<p class="sources">Sources: <code>docs/pyth.md</code> §1, §4, §5; mainnet reads on 3 Oct 2026 of every <code>PriceUpdateV2</code> account for the five feeds and of shards 0–7; <code>uncross/programs/uncross/src/clearing.rs</code>, <code>oracle.rs</code>; <code>uncross/scripts/keeper.mjs</code>, commit <code>803c141</code>; the pull test, commits <code>e51cf50</code> and <code>47a174e</code>, with <code>uncross/scripts/pyth-accept-result.json</code> and <code>pyth-cross-proof-result.json</code>, and its transactions read on devnet on 4 Oct 2026; Hermes feed metadata (<code>ef0d8b6f…</code> is <code>Crypto.SOL/USD</code>); <code>web/src/components/AuctionStats.tsx</code> and <code>AuctionPage.tsx</code> (commit <code>f560ba4</code>).</p>
