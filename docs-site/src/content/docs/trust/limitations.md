---
title: Honest limitations
description: What Uncross does not show, what an operator can influence, what went wrong, and what it deliberately costs.
---

Read this page before relying on any claim elsewhere in these docs.

## What the devnet results do and do not show

**Most devnet orders come from a test bot.** An activity bot places orders on some tickers. They are priced around Pyth, or around Jupiter where no Pyth feed exists. So when a clearing price lands near the Pyth price, that shows **the bot followed its instructions**. It is not independent price discovery. What the crosses do demonstrate is the mechanism: one price, every order filled at it, escrow conserved to the unit.

**Only one auction has had anyone but us in it.** On 23 September a MSTRx auction cleared with three orders from three wallets. Two were placed by people other than the builder, from a group chat where the venue had been shared ([Verify a clearing price](/trust/verify/)). The three wallets have transacted with one another before, so these were people who know each other, not strangers. As of 24 September, **no open public auction has run**. Two community auctions were scheduled and neither ran.

**Candle high and low are limit prices placed, not trades.** Only one price trades per auction.

## The oracle tie-break has never run on chain

Pyth publishes no fresh price on devnet. The devnet accounts were last updated on 2 July 2026, so at every cross the gate fails, and the auction clears by the book alone. The path where a Pyth price passes the gate and breaks a tie is **covered only by unit tests**, built from the real mainnet account's and mint's bytes ([The on-chain gate](/pyth/gate/#tests)).

## What whoever sends the transactions can influence

The instructions that finish an auction are permissionless: anyone can send them, and the program checks everything itself. Two choices are still left to the sender. Neither lets anyone take funds. Both are stated here because they bear on how far the result can be trusted.

### Which Pyth account is passed at the cross

The sender of `compute_clearing` chooses which account to pass as the Pyth price.

- **They cannot** substitute another asset's price. The auction is bound at creation to one feed ID, and any other feed is refused. They cannot pass a fabricated price, because the account must be owned by Pyth's receiver program and fully verified. They cannot move the clearing price outside the set the book already supports, or change any volume, fill or payout rule.
- **They can** pass an account that fails the gate on purpose: the System Program, a stale shard, anything that is not the live price. The oracle rule is then skipped, and the midpoint rule decides. That matters in exactly one case: when a tie survives the imbalance rule and a fresh Pyth price would have broken it. There, the sender can choose between "the tied price nearest Pyth" and "the midpoint of the tied prices".

**What this means for trust.** The oracle tie-break is only as dependable as whoever sends the cross. Normally that is the keeper, which passes the right account. But anyone can send the cross first once the window closes. The price always stays within what the book supports equally well, on volume and on balance. On devnet the gate never passes anyway, so today this changes nothing in practice.

**Possible fixes, not implemented:** bind the Pyth account address itself at creation, not just the feed ID. Or refuse the cross, rather than skip the oracle rule, when the account passed is not the bound feed's account. No fix is planned before judging.

### Whether the auction settles or refunds

`cancel_and_refund`, the failure path, has no caller restriction and does not check that the mint is paused. The first batch after the cross fixes the auction's settle path for good.

- **They cannot** take funds, or cause anyone to receive less than their full escrow. The refund path returns every order's full original escrow.
- **They can**, by sending a refund batch before the keeper's first ordinary settlement, lock the auction onto refunds. The trades computed at the cross then never happen, and every order shows **Refunded**.

**What this means for trust.** Any wallet can void any auction's trades, at the cost of a transaction fee. Funds are never at risk, but an auction's result is not guaranteed to execute. **Possible fixes, not implemented:** allow the refund path only while the ticker mint is paused, or only after ordinary settlement has been impossible for some time.

## Stranded auction rent: found, and mostly recovered

`close_auction` returns an auction's rent (0.0183 SOL, for the auction account and its two vaults) once it is fully settled. The keeper built its working set from a local cache, and each redeploy reset that cache. So auctions opened before a redeploy were never cleared, and their rent sat stranded.

- **119 auctions were stranded** this way, found on 23 September.
- **118 of them were recovered** between 20:13 and 20:27 UTC on 23 September. The recovery closed 120 auctions in all: the 118, plus two opened on dormant tickers during testing. Together they returned **2.1994 SOL** of rent, for 0.0012 SOL in fees. 67 closes were sent by the recovery run and 53 by the keeper on Railway, from the same wallet, with the rent going to the same place. Every close signature is in [`docs/rent-recovery-2026-09-23.tsv`](https://github.com/Uncross-Org/uncross/blob/f7245ea33e019bbcfacfd17ccc6677a1d3bb5f5c/docs/rent-recovery-2026-09-23.tsv). The first is [`5YdN7KdX…ChFUqsW3`](https://explorer.solana.com/tx/5YdN7KdXG3XEeWR38sV6VWvKWwG5tf6V5aHnsbGsncabU4FxdWTBafhcZA5ijXL8R2HfKRmjY3oCsspsChFUqsW3?cluster=devnet).
- **One is permanently locked, at 0.0153 SOL.** It predates the reclaim upgrade, was cleared with no orders, and has no recorded payer, so `close_auction` refuses it. Its address is not in a committed file.
- **The cause is fixed.** At 21:08 UTC on 23 September the keeper was replaced with one that finds its working set by scanning the program's accounts instead of a cache, so a redeploy can no longer strand anything.

**Separately, 202 older auctions holding 3.09 SOL can never be closed.** They settled before the reclaim upgrade on 16 September, when auctions did not record who paid their rent. That rent is permanently locked. This was a known consequence of the upgrade, and is not caused by the keeper bug.

## Order rent is never returned, by design

Every order creates an account whose rent, **0.00121412 SOL**, is paid by the trader and never returned. The account is the durable settlement record. After the auction account is closed, it still lets any participant rebuild their fill and what they paid and got back. Closing it to return the rent was designed and then cancelled on 23 September for that reason ([Costs and rent](/mechanism/costs/)).

## Tokens that cannot be supported

Tokens with an active transfer fee break escrow balance: the vault receives less than the program records.

- **PreStocks:** 100 bps on every transfer as of 24 September, raised from 50 bps at epoch 1039.
- **Tessera:** 20 bps.

Both also use 9 decimals, which the app does not handle. See [Tokens we cannot support](/tokens/unsupported/).

## The issuer's powers over escrow

- **Pause:** while an xStock is paused, escrowed shares cannot move, not even to be refunded. Dollar refunds still work. Everything is recoverable once the pause lifts ([Test: pause mid-auction](/devnet/pause-test/)).
- **Seizure:** every xStock has a permanent delegate that can move or burn tokens in any account, escrow included.
- **Transfer hook:** switched off today. Switching it on would add accounts to every transfer and shrink settlement batches.

See [xStocks and Token-2022](/tokens/xstocks-token-2022/).

## Pyth's feed carries no session marker

The AAPL feed was measured publishing straight through the close and overnight. The claim that it stops was retracted ([After the close](/pyth/after-hours/)). The on-chain account has no trading-status field, so a thin extended-hours print and a liquid regular-session one cannot be told apart on chain. The program will use either as a tie-break if it is fresh and tight. Weekends were not measured.

## Smaller things

- **Capacity.** An auction holds at most 63 orders. The largest book tested had 42. Settlement fits 7 orders per transaction with distinct owners. Address lookup tables would raise that, and are not used.
- **Recorded gate verdicts can mislead.** Five tickers have no Pyth account on any network. Their auctions currently record "wrong owner", because the keeper passes a placeholder. A committed keeper change records "no feed configured" instead, and deploys after the 24 September community auction. A cross run from the app's own button passes a mainnet address that does not exist on devnet, so it also records "wrong owner" where the keeper would record "stale".
- **Timing is estimated.** Windows are fixed in slots. Minutes are derived from a measured slot rate that drifts, so the countdown is an estimate.
- **The faucet can run dry.** A global cap bounds how many new wallets it can fund. On 24 September it covered about 40, with 31 left.

## Not done

- **Not audited.** Nothing here has had a security audit.
- **Not on mainnet.** The program has never run against a real xStocks mint.

<p class="sources">Sources: <code>docs/submission-draft.md</code> (What we're not claiming, the MSTRx cross, rent recovery), <code>docs/rent-recovery-2026-09-23.tsv</code> (120 closes, 2.199437 SOL), <code>README.md</code> (What this doesn't solve; Not yet tested), <code>uncross/programs/uncross/src/lib.rs</code> (<code>compute_clearing</code>, <code>cancel_and_refund</code>, <code>settle_or_refund</code>), <code>oracle.rs</code>, <code>docs/pyth.md</code>, <code>docs/phase2.md</code>, commit <code>803c141</code>, <code>web/src/App.tsx</code> and <code>web/src/lib/tx.ts</code> (crank's Pyth account).</p>
