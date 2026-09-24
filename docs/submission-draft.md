# Uncross — revised submission description

**Final text, 24 Sept 2026.** Paste two sections: "Short description" into the
short description field, and everything from "The problem" down to the end of
"Built with" into the full description. Stop at the line above "Review notes";
those are for us and are not part of the submission.

The universe figures were read on 23 Sept 2026 at 06:57 UTC. The IBMx quotes
were read at 17:32 UTC the same day, the same reading the landing page shows.
Any other date is stated beside its figure.

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

Even a ticker that does have a pool can be close to untradeable. IBMx's pools held $3,206 between them at 17:32 UTC on 23 Sept: DexScreener's reported liquidity, summed over every pair that contains the IBMx mint. These are point-in-time readings from Jupiter's quote API:

| Buy IBMx with USDC, 50 bps | 16 Sept | 23 Sept, 17:32 UTC |
|---|---|---|
| $10,000 | no route | **84.09%** price impact |
| $1,000 | no route | **13.45%** price impact |
| $100 | no route | **1.93%** price impact |
| $1 | no route | **0.69%** price impact |

On 16 Sept Jupiter published a price of $247.14 for IBMx and would not route a buy at any size. A week later it routes every size, and reports 84.09% price impact on a $10,000 buy against pools holding $3,206. The IBMx price itself moved on 23 Sept, from $201.54 at 06:57 UTC to $251.63 at 17:32 UTC. That is 13% below the IBM stock price read at the first reading, $231.91, and 7% above it at the second, $234.99. The quote you can see is not the price you can trade at. There is no Pyth feed for IBM on Solana.

The instability is the point. On the same day, the same $1 buy cost 18.46% in price impact at 06:57 UTC and 0.69% at 17:32 UTC. Anyone re-running these quotes will get different numbers again. With so little in the pools, a single trade or a change in liquidity is enough to move the quote.

The deep end is fine: on 16 Sept NVDAx, whose pool held $2.15M, quoted 0.24% impact on a $10,000 buy. The problem is everything below it.

## What Uncross does

Uncross is a uniform-price call auction. Orders collect during a short window and escrow into a program vault. At the close, the program picks the single price that trades the most shares, and everyone who can trade at that price fills there. Buyers are refunded the difference between their limit and the clearing price. Unfilled orders are returned in full.

Nobody trades at a worse price than they asked for, and nobody in an auction gets a worse price than anyone else in it. A book like this needs no pool and no market maker — only people who want to trade the same name in the same few minutes.

## What's built

- **A cross with other people in it.** On 23 September a MSTRx auction cleared with three orders from three wallets. Two of them were placed by people other than the builder, from a group chat where the venue had been shared.
  - **Who they were.** The three wallets have transacted with one another before, so these were people who know each other, not strangers. This was on devnet and was not an open public event. None of the three is one of the test bot's wallets.
  - **The fills.** The buyer's limit was $164.24 and the seller's $158.01. The auction cleared both at $161.125, each $3.115 better than their own limit. The third order, a buy at $151.09, was below the clearing price and got its escrow back in full.
  - **How the price was set.** The program's on-chain Pyth check failed as stale, so no oracle set that price. $158.01 and $164.24 tied on both volume and balance, and the midpoint rule set it.
  - **Transactions.** Cross: `2SKcwefYsGdpquxrgJP2yRdnn2VpyBEL7oV2GdmjBsTFGqqHvP6L58wxMcAsuU7DYnyvhmeJBMRrhMpFK75FpLAU`. Settlement: `4ws2ByFqvSJzCVG73iW1D7CRSP8eYNqKBoq2CybQk2a6mdkHK1byo8KpmEnRFBEVWfHtzpYZiJK3RFQahNGBKY8A`.
- **Anchor program:** open, orders, cancel until a freeze window, clearing, batched settlement (tested across 42 distinct owners, both vaults ending at exactly zero), refunds, and `close_auction` rent reclaim, which cuts the net cost of an auction from 0.018 to about 0.00002 SOL when an auction runs through to close.
- **Live venue on devnet:** ten tickers crossing about every 19 minutes, run by a keeper, an activity bot and a faucet hosted on Railway.
- **Dashboard:** one candle per auction, a depth ladder, order entry, and every auction linked to its transactions. The top of each ticker separates what the book computes (the price it would clear at, the shares that would trade, best bid and ask, time to the cross) from the one external number, Pyth, with its age and what the program's own check made of it.
- **Every participant sees what their order came to.** After the cross, each order's receipt shows whether it filled, shares filled out of shares asked, the limit, the clearing price, what was paid or received, what came back, and the settlement transaction. It is read from on-chain settlement data, keyed to the order rather than to the ticker's newest auction, so it stays after the next auction opens. An Orders page lists every order a wallet has placed on any ticker, and a Portfolio page shows each asset in the wallet and locked in orders.
- **Landing page:** the routing evidence above, how the auction works, the Pyth gate, and a live book read from devnet in the browser with no wallet required.
- **Browser wallets work end to end, checked on chain.** On 24 Sept, on the live site, a wallet that had never existed connected through Wallet Standard in a fresh browser, took a faucet grant and placed two orders through the page.
  - It cancelled the first while the auction was open: `5xuRETXFQpt6DvstKBPnRZuh6NhyFk7TeoSsWXnwi49MgchrHs3sKmM9rDzhdcygT7L8NwFg4eTZk65kFJPT3eNg`.
  - Once the auction froze, the page disabled Cancel. A cancel sent straight to the program was refused on chain with `PastFreezeWindow`: `wzwxgAAigSUqiMhgrABrjSiUuS8CT3phv7YpLbANdsoA46b1FwQhxwCAxxUWDjHP1kJU74d5cCqfKnTGyaZ3ikF`.
  - At the cross, the page announced the result and showed the second order's receipt with its settlement: `sf9HDGvT1VPE8PksBqjY4o89PATQkh8q2ZJarPSuqestVwKD1M54LgvqJmLB67DJ7eYmTBWZ92GQVLb6uQt4Lbf`.
  The script that drives it is `uncross/scripts/order-path-browser.mjs`.
- **Anyone can join:** "Get test tokens" funds a fresh wallet with SOL and test tokens in one step. It is rate-limited: one grant per wallet every three hours, and a total cap of 0.8 SOL. A new wallet gets 0.02 SOL, so the cap covers about 40 new wallets, and 31 were left on 24 Sept. A burst of visitors can exhaust it.

## Pyth

Each auction runs Pyth through an eight-condition on-chain gate, including correct feed, Pyth ownership, full verification, freshness and a confidence cap, and records the verdict and the price's publish time on chain.

We claimed the reference price disappears after the US close. We then checked the AAPL feed 80 times over 10h38m, straight through the close. It never stopped. We retracted the claim everywhere. The narrower, true finding: the on-chain account carries no session marker, so a thin after-hours print and a liquid midday one are indistinguishable. That is an argument for pricing thin names from a book. Full write-up in `docs/pyth.md`.

## Why devnet

We read the real AAPLx mint off mainnet and built a devnet fixture matching all eight of its Token-2022 extensions. That let us run two tests impossible on mainnet, where those authorities belong to the issuer: pausing the mint mid-auction, with every balance recoverable, and applying a stock-split multiplier mid-auction, with open orders unchanged. The mint read, the extension diff and the transaction signatures are in the repo.

## What we're not claiming

- **No open public auction has run yet.** The only auction with anyone but us in it is the 23 September MSTRx cross above: three wallets from one group chat, on devnet.
- Most devnet orders are placed by a test bot priced around Pyth, or around Jupiter where no feed exists. A clearing price near the reference shows the bot followed instructions, not independent discovery.
- On devnet the Pyth gate usually fails, because the devnet AAPL account is stale, so the oracle tie-break path is unit-tested only.
- Candle high and low show the range of limit prices placed, not trades. One price trades per auction.
- Issuers retain pause and seizure rights. A paused mint blocks refunds of that token.
- **Order rent is not returned, by design.** Every order creates an account that is never closed. It keeps the owner, limit, quantity, escrow and filled quantity after the auction account is closed, and every settlement transaction touches it. So any participant can rebuild their own outcome from chain at any time: the fill from the account, and what they paid and got back from the settlement transfers in its history. The cost is the account's rent, 0.00121412 SOL per order, paid by the trader and kept. We had designed closing these accounts to return that rent, and cancelled it because it would erase the record.
- **The keeper stranded auctions until 23 Sept.** `close_auction` returns an auction's rent once it is fully settled: 0.0183 SOL, for the auction account and its two vaults. The keeper built its working set from a local cache, and each redeploy reset that cache, so auctions opened before a redeploy were never cleared. On 23 Sept, 119 auctions were stranded this way. We then recovered 120 auctions between 20:13 and 20:27 UTC: 118 of the 119, plus two opened on dormant tickers during testing. They returned 2.1994 SOL of rent for 0.0012 SOL in fees, and every close signature is in `docs/rent-recovery-2026-09-23.tsv`. The 119th cannot be recovered. It predates the reclaim upgrade, was cleared with no orders, and has no recorded payer, so its 0.0153 SOL stays locked. At 21:08 UTC on 23 Sept we replaced the keeper with one that finds its working set with a program scan instead of a cache, so a redeploy can no longer strand anything. It also never closes an auction that has an order from anyone but our test bot, so a participant's auction keeps its full on-chain record. As of 20:31 UTC on 23 Sept, 245 auction accounts hold 3.74 SOL. 202 of them, holding 3.09 SOL, settled before the reclaim upgrade, have no recorded payer, and can never be closed. 32 are settled and closeable, 10 are live, and one is the stranded auction above.

## Built with

Anchor, Next.js, TradingView lightweight-charts, shadcn/ui, Aceternity UI (licensed), Pyth's price-feed receiver program on-chain, and Railway for the keeper, activity bot and faucet. Everything else is original work.

---

## Review notes

▲ **Corrected: outside participation.** The earlier text said every order so far was ours. That was false. Two of the three orders in the 23 Sept MSTRx auction were placed by people from the builder's group chat. It is now the first item in "What's built", with what it is and is not. Checked on chain: none of the three wallets is a bot owner, deploy or wallet2. The three have transacted with one another before (a shared multisig in November 2025, and one funded another in May 2026), and the text says so rather than leave a judge to find it.

▲ **24 Sept, final pass.** The keeper paragraph said the scan-based keeper was "not yet deployed"; it has been live since 21:08 UTC on 23 Sept, and the paragraph now says so. "What's built" adds the settlement receipt, the Orders and Portfolio pages, and the split between book figures and the Pyth reference. The browser-wallet bullet now cites today's live run, which also shows cancel accepted while open and refused once frozen. The faucet figures are from its live health endpoint and its grant log on 24 Sept; an earlier version of this pass said 0.016 SOL per grant, which was wrong. The README's "not yet tested: a real browser wallet signing" line is deleted.

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

▲ **Order rent: now stated as a design decision, not a defect.** The live version says order accounts "are not yet closed… Designed, not shipped", which reads as a missing optimisation. That optimisation is cancelled: order accounts are the settlement record the dashboard reads from, and closing them would destroy it. The wording says what the record contains and what it costs, and does not claim more. The stranded-auction paragraph is a separate, genuine defect and stays as it is.

▲ **Rent disclosure rewritten from the recovery.** Every figure comes from chain: the counts from a read of every auction account before and after, and the SOL from each close transaction's balance change plus its fee. 53 of the 120 closes were sent by the keeper running on Railway, not by the recovery run. It picks up auctions from the program's recent transactions, so once the recovery cleared an auction, the Railway keeper could see it and close it itself. Both use the same wallet, and the rent went to the same place.

▲ **"Every 20 minutes" → "about every 19 minutes."** Measured: 7,000 slots at 6.04 slots/s is 19.3 minutes.

▲ **Added: Railway and Pyth's receiver** to "Built with".

**Things you should check before pasting:**
- **Which MSTRx wallet was yours** (G4o8…xWPc the buyer, 218b…Z7US the seller, or Cwcg…p9Gu the unfilled buyer). The text does not name it and does not need to, but confirm it before pasting. If yours was one of the two that filled, the cross was between you and one other person; if yours was the unfilled one, it was between two other people. Either way the wording holds.
- **The 1,026 is xStocks' own API, verified on chain.** It is far larger than the ~60 names at launch; the universe has grown. If a judge remembers "60 xStocks", the method line is what answers them.
- **The site and this text now agree.** The landing page headline was corrected and deployed at 17:39 UTC on 23 Sept. It shows the same two dated IBMx readings and the same 17:32 figures as the table above.
- **The IBMx figures are a moving target.** If you paste this days from now, they will be days old; the table's column header dates them, so they stay true as a record. If you want them current on the day you paste, ask and I will re-read and update both this text and the site together.
- **118 vs 119, reconciled.** 119 auctions were stranded: 118 whose window ended and were never cleared, plus one that was cleared with no orders and no recorded payer. The dry run listed 118 because the 119th had nothing left to clear. The old "1.82 SOL" was the auction accounts' own lamports for those 119. It left out the two vault accounts per auction, whose rent `close_auction` also returns, which is why 2.1994 SOL came back rather than about 1.8.
