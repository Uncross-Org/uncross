# Uncross — revised submission description

**Draft for review. Nothing has been entered on the site.**

The universe figures were read on 23 Sept 2026 at 06:57 UTC. The IBMx quotes
were read at 17:32 UTC the same day, the same reading the landing page now
shows. Any other date is stated beside its figure. Review notes at the end mark
each change from the version live on the project page.

---

## Short description

A periodic call auction for tokenized stocks on Solana. Orders collect for a few minutes, then everyone fills at one price. Of the 1,026 xStocks on Solana, 971 have no DEX pool at all — for those, there is nowhere else to trade them.

---

## Full description

## The problem

**Of the 1,026 xStocks tokenized equities on Solana, 971 have no DEX pool at all.** Only 55 have any pool, and two of those are empty. For roughly 95% of the asset class there is no quote, no route and no venue.

| Pool TVL | Tickers | 24h volume |
|---|---|---|
| $1M or more | 9 | $34.2M |
| $100K – $1M | 12 | $7.7M |
| $10K – $100K | 12 | $1.6M |
| $1K – $10K | 12 | $3.8K |
| $1 – $1K | 8 | $337 |
| pool, but empty | 2 | $0 |
| **no pool** | **971** | **$0** |

*Method:* every asset listed by the xStocks public API (`api.xstocks.fi`, all 11 pages), then each of the 1,026 Solana mints verified directly on mainnet — every one is a Token-2022 mint under the same xStocks mint authority. Pool TVL and 24h volume from DexScreener. Read 23 Sept 2026. Seven of the 1,026 were marked trading-halted at the time (CRDAx, CKAHx, CKHUTx, CITICx, JPSTx, IWMx, TQQQx).

A second finding about the asset class: **all 1,026 mints carry the identical set of eight Token-2022 extensions** — metadata pointer, permanent delegate, default account state, scaled-UI amount, pausable, confidential transfer, transfer hook and token metadata — under one authority. One fixture template reproduces any of them, which is how we could list the whole universe on devnet.

Even a ticker that does have a pool can be close to untradeable. IBMx's pools hold $3,206 between them:

| Buy IBMx with USDC, 50 bps | 16 Sept | 23 Sept, 17:32 UTC |
|---|---|---|
| $10,000 | no route | **84.09%** price impact |
| $1,000 | no route | **13.45%** price impact |
| $100 | no route | **1.93%** price impact |
| $1 | no route | **0.69%** price impact |

On 16 Sept Jupiter published a price of $247.14 for IBMx and would not route a buy at any size. A week later it routes every size, and reports 84.09% price impact on a $10,000 buy against pools holding $3,206. The IBMx price itself moved on 23 Sept, from $201.54 at 06:57 UTC to $251.63 at 17:32 UTC. That is 13% below the IBM stock price read at the first reading, $231.91, and 7% above it at the second, $234.99. The quote you can see is not the price you can trade at. There is no Pyth feed for IBM on Solana.

The deep end is fine: on 16 Sept NVDAx, whose pool held $2.15M, quoted 0.24% impact on a $10,000 buy. The problem is everything below it.

## What Uncross does

Uncross is a uniform-price call auction. Orders collect during a short window and escrow into a program vault. At the close, the program picks the single price that trades the most shares, and everyone who can trade at that price fills there. Buyers are refunded the difference between their limit and the clearing price. Unfilled orders are returned in full.

Nobody trades at a worse price than they asked for, and nobody in an auction gets a worse price than anyone else in it. A book like this needs no pool and no market maker — only people who want to trade the same name in the same few minutes.

## What's built

- **Anchor program:** open, orders, cancel until a freeze window, clearing, batched settlement (tested across 42 distinct owners, both vaults ending at exactly zero), refunds, and `close_auction` rent reclaim, which cuts the net cost of an auction from 0.018 to about 0.00002 SOL when an auction runs through to close.
- **Live venue on devnet:** ten tickers crossing about every 19 minutes, run by a keeper, an activity bot and a faucet hosted on Railway.
- **Dashboard:** one candle per auction, a depth ladder, order entry, and every auction linked to its transactions.
- **Landing page:** the routing evidence above, how the auction works, the Pyth gate, and a live book read from devnet in the browser with no wallet required.
- **Browser wallets work end to end.** A wallet that had never existed connected through Wallet Standard in a fresh browser, took a faucet grant, placed an order and had it land on chain — driven through the UI only, and checked on chain rather than in the page. Most recent run: 23 Sept, transaction `3eZSqDJJyhUsJSCbrAK1GgRC88dNsbMZ25vw2FFjAJRPUFeobqubTXCC8b3BquyBVS641UoWeYuXBrypE8dPHCpy`.
- **Anyone can join:** "Get test tokens" funds a fresh wallet with SOL and test tokens in one step. It is rate-limited — one grant per wallet every three hours, and a total cap (currently 0.8 SOL, enough for roughly 40 new wallets) — so a burst of visitors can exhaust it.

## Pyth

Each auction runs Pyth through an eight-condition on-chain gate, including correct feed, Pyth ownership, full verification, freshness and a confidence cap, and records the verdict and the price's publish time on chain.

We claimed the reference price disappears after the US close. We then checked the AAPL feed 80 times over 10h38m, straight through the close. It never stopped. We retracted the claim everywhere. The narrower, true finding: the on-chain account carries no session marker, so a thin after-hours print and a liquid midday one are indistinguishable. That is an argument for pricing thin names from a book. Full write-up in `docs/pyth.md`.

## Why devnet

We read the real AAPLx mint off mainnet and built a devnet fixture matching all eight of its Token-2022 extensions. That let us run two tests impossible on mainnet, where those authorities belong to the issuer: pausing the mint mid-auction, with every balance recoverable, and applying a stock-split multiplier mid-auction, with open orders unchanged. The mint read, the extension diff and the transaction signatures are in the repo.

## What we're not claiming

- **No public auction with outside participants has happened yet.** Every order on the venue so far is ours.
- Most devnet orders are placed by a test bot priced around Pyth, or around Jupiter where no feed exists. A clearing price near the reference shows the bot followed instructions, not independent discovery.
- On devnet the Pyth gate usually fails, because the devnet AAPL account is stale, so the oracle tie-break path is unit-tested only.
- Candle high and low show the range of limit prices placed, not trades. One price trades per auction.
- Issuers retain pause and seizure rights. A paused mint blocks refunds of that token.
- Order accounts are not yet closed after settlement, so their rent is not returned. Designed, not shipped.
- **Rent reclaim works, but the keeper does not always reach it.** `close_auction` returns an auction's rent once it is fully settled. The keeper, though, only acts on auctions in a locally cached working set, and a redeploy resets that cache, so auctions opened beforehand are never cleared and never become closeable. As of 23 Sept, 363 auction accounts hold 5.55 SOL of rent: 203 pre-date the reclaim upgrade and have no recorded payer, and 119 were orphaned this way, holding 1.82 SOL.

## Built with

Anchor, Next.js, TradingView lightweight-charts, shadcn/ui, Aceternity UI (licensed), Pyth's price-feed receiver program on-chain, and Railway for the keeper, activity bot and faucet. Everything else is original work.

---

## Review notes

▲ **Problem section now leads with the 95% finding** — 1,026 mints, 55 with any pool (two of them empty), 971 with none — with the method, the date, and the seven halted tickers. The short description leads with it too.

▲ **Correction to my earlier report: it is 971 with no pool, not 973.** 973 is the count with no usable liquidity — 971 with no pool plus two pools holding $0 (URAx, PMx). I reported 973 as "no pool", which was wrong. The table now shows both.

▲ **Added: the identical eight-extension set** as a finding about the asset class.

▲ **Corrected: "no route" for IBMx.** The live version says Jupiter returns no route "for a trade of even $1". That was true on 16 Sept and is false today: Jupiter routes every size. Replaced with a dated two-column table, so both readings stand as what they were.

▲ **IBMx figures updated to the 17:32 UTC reading, the one the landing page shows.** They moved a long way within the day. At 06:57 the impact was 18.46% on $1, 19.81% on $100, 29.33% on $1,000 and 86.57% on $10,000, with the token at $201.54. At 17:32 it was 0.69%, 1.93%, 13.45% and 84.09%, with the token at $251.63. Only the $10,000 figure held, so the text leads with it, and the table is ordered largest first. The pool figure is now $3,206: DexScreener's liquidity summed over every IBMx pair, the method the 16 Sept capture used. The earlier draft said $1,533. I have not confirmed how that figure was read, so I have not used it.

▲ **Every price now carries its date and time.** $247.14 is the 16 Sept figure; $201.54 and $251.63 are today's, at 06:57 and 17:32 UTC. The live version presents $247.14 undated.

▲ **Added: browser-wallet signing** with today's on-chain signature. The README still lists this under "Not yet tested" and needs that line deleted when this goes in.

▲ **Added: the landing page** to "What's built".

▲ **Added: the faucet qualifier** — cooldown and total cap, with the current figure.

▲ **Added: "No public auction with outside participants has happened yet."** Two were scheduled and neither ran. Nothing here should imply otherwise.

▲ **Rent disclosure** is in present tense with figures read this morning. If the keeper fix and the orphan recovery land before Friday, this paragraph gets rewritten with the SOL actually returned.

▲ **"Every 20 minutes" → "about every 19 minutes."** Measured: 7,000 slots at 6.04 slots/s is 19.3 minutes.

▲ **Added: Railway and Pyth's receiver** to "Built with".

**Things you should check before pasting:**
- **The 1,026 is xStocks' own API, verified on chain.** It is far larger than the ~60 names at launch; the universe has grown. If a judge remembers "60 xStocks", the method line is what answers them.
- **The site and this text now agree.** The landing page headline was corrected and deployed at 17:39 UTC on 23 Sept. It shows the same two dated IBMx readings and the same 17:32 figures as the table above.
- **The IBMx figures are a moving target.** If you paste this days from now, they will be days old; the table's column header dates them, so they stay true as a record. If you want them current on the day you paste, ask and I will re-read and update both this text and the site together.
- **The rent paragraph says 119 orphans; the keeper's dry run lists 118 to clear.** I have not reconciled the one-auction difference. The recovery run reports the exact count, SOL and signatures, and the paragraph gets rewritten from those.
