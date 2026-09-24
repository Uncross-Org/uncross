---
title: Why a call auction
description: Most tokenized stocks on Solana have no pool at all, and many that do are too thin to trade. A call auction gathers the traders instead.
---

## The problem: a price you can see is not a price you can trade

Tokenized US stocks trade on Solana around the clock, but most of them have almost no liquidity. A reference price is easy to find. The ability to trade at it is not.

### Most xStocks have no pool at all

Every asset listed by the xStocks public API (`api.xstocks.fi`, all 11 pages) was read on **23 Sept 2026 at 06:57 UTC**. Each of the 1,026 Solana mints was then verified directly on mainnet. Every one is a Token-2022 mint under the same xStocks mint authority. Pool TVL and 24-hour volume come from DexScreener.

| Pool TVL | Tickers | 24h volume |
|---|---|---|
| $1M or more | 9 | $34.2M |
| $100K – $1M | 12 | $7.7M |
| $10K – $100K | 12 | $1.6M |
| $1K – $10K | 12 | $3.8K |
| $1 – $1K | 8 | $337 |
| pool, but empty | 2 | $0 |
| **no pool** | **971** | **$0** |

Only 55 have any pool, and two of those are empty. For roughly 95% of the asset class there is no quote, no route and no venue. Seven of the 1,026 were marked trading-halted at the time: CRDAx, CKAHx, CKHUTx, CITICx, JPSTx, IWMx and TQQQx.

### A pool can exist and still not work

IBMx has pools. Here is what buying it with USDC cost on Jupiter's quote API at 50 bps slippage, on two dates:

| Buy IBMx | 16 Sept | 23 Sept, 17:32 UTC |
|---|---|---|
| $10,000 | no route | 84.09% price impact |
| $1,000 | no route | 13.45% price impact |
| $100 | no route | 1.93% price impact |
| $1 | no route | 0.69% price impact |

On 16 Sept, Jupiter published a price of $247.14 for IBMx and would not route a buy at any size tried, down to $1. A week later it routed every size, and reported 84.09% impact on $10,000 against pools holding $3,206 in total. That figure is DexScreener's reported liquidity, summed over every pair containing the IBMx mint. On 23 Sept the same $1 buy cost 18.46% in price impact at 06:57 UTC and 0.69% at 17:32 UTC. With so little in the pools, one trade is enough to move the quote.

These are point-in-time readings. Anyone re-running them will get different numbers. The instability is the point.

There is **no Pyth price for IBM on Solana at all**. For IBMx, the auction book is the only on-chain price there is.

The deep end is fine: on 16 Sept NVDAx, whose pool held $2.15M, quoted 0.24% impact on a $10,000 buy. The problem is everything below it.

## What a call auction changes

A pool asks each trader to trade alone, against whatever liquidity happens to be there. On a thin pool, that means paying a large spread or finding no route at all.

A call auction asks traders to arrive in the same window instead. Orders collect, nothing executes on arrival, and at the close they meet each other at one price. That price is the one that trades the most shares ([The clearing rule](/mechanism/clearing-rule/)). Everyone who can trade at it does. Nobody pays more than their limit, and nobody gets a worse price than anyone else in the same auction.

This is how stock exchanges handle the moments when liquidity is thinnest, at the open and the close of the trading day. It needs no pool and no market maker, only people who want to trade the same name in the same few minutes.

## What a reference price can and cannot do

A good reference price, such as Pyth's, can guard an auction's price against manipulation. Uncross uses Pyth that way, narrowly: [What Pyth is used for](/pyth/role/). But a reference cannot supply liquidity. Measured on mainnet at 4:02 AM ET on 16 Sept, buying with USDC through Jupiter at 50 bps slippage, with Jupiter's own reference price:

| Token | Reference | Buy $100 | Buy $1,000 | Buy $10,000 |
|---|---|---|---|---|
| AAPLx | $330.77 | 0.19% | 0.33% | 0.41% |
| NVDAx | $213.53 | 0.09% | 0.15% | 0.24% |
| IBMx | $247.14 | no route | no route | no route |
| XOMx | $165.74 | 2.02% | 2.33% | no route |
| JPMx | $346.49 | 2.52% | no route | no route |

"No route" means the aggregator declined to route that size. A direct pool swap might still fill, at a worse price.

## What this does not claim

Uncross runs on devnet, and most of its orders come from a test bot. It demonstrates the mechanism, not that real liquidity will arrive. See [Honest limitations](/trust/limitations/).

<p class="sources">Sources: <code>docs/submission-draft.md</code> (universe and IBMx readings, 23 Sept), <code>docs/pyth.md</code> §6 (16 Sept capture), <code>site/lib/liquidity-capture.json</code>, <code>docs/data/xstocks-universe-2026-09-23.json</code>.</p>
