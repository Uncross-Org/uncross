---
title: FAQ
description: Short answers to the questions people ask most, each linking to the page with the full answer.
---

## The mechanism

**Why don't orders trade when they arrive?**
Because it is a call auction. Orders collect during a window and all trade at once, at one price, so thin markets can meet in one place instead of each trader crossing a spread alone. [Why a call auction](/mechanism/why-call-auctions/)

**How is the price chosen?**
It is the price that trades the most shares. Ties go first to the smallest imbalance between demand and supply, then to the price nearest a fresh Pyth price if one passed the gate, then to the midpoint. [The clearing rule](/mechanism/clearing-rule/)

**Will I pay my limit?**
Only if the auction clears exactly at it. If you bid $250 and it clears at $247.50, you pay $247.50 and the difference comes back. [Order statuses](/mechanism/order-statuses/)

**Can I get a worse price than someone else in the same auction?**
No. Everyone who trades gets the clearing price. Money moves in whole micro-dollars, so two buyers' totals can differ from exact pro-rata by one micro-dollar. [The clearing rule](/mechanism/clearing-rule/#what-each-order-pays-or-receives)

**My limit was on the right side of the clearing price, but I filled nothing. Why?**
Price priority. When more shares are willing to trade than can be matched, better-priced orders fill first. [Who fills at the clearing price](/mechanism/clearing-rule/#who-fills-at-the-clearing-price)

**Why is the best bid above the best ask?**
Because nothing executes until the cross. Overlapping buyers and sellers are exactly what will trade. [Glossary](/start/glossary/)

**When can I cancel?**
Until the freeze, the last 700 slots of the window (about two minutes at the measured devnet slot rate). [Auction lifecycle](/mechanism/lifecycle/)

**Can I place an order during the freeze?**
Yes. Only cancelling stops. An order placed during the freeze cannot be cancelled. [Auction lifecycle](/mechanism/lifecycle/)

**How long is an auction?**
7,000 slots, about 19 minutes at the measured devnet rate. A new one opens for each scheduled ticker as soon as the last one ends. [Auction lifecycle](/mechanism/lifecycle/#timing)

## Money and safety

**Who holds my funds while I wait?**
The auction's vaults, token accounts owned by the auction's program-derived address. Only the program can move them. [What the program guarantees](/trust/guarantees/)

**Can the operator take my funds?**
No instruction lets anyone redirect escrow. Settlement pays each order's owner, checked by the program. The token issuer is different: it can pause the token or move tokens from any account. [xStocks and Token-2022](/tokens/xstocks-token-2022/)

**What if the issuer pauses the token mid-auction?**
Settlement fails safely. Dollar refunds still go out, and share refunds go out once the pause lifts. Tested for real on devnet. [Test: pause mid-auction](/devnet/pause-test/)

**What if there's a stock split mid-auction?**
Nothing changes. The program holds raw amounts, and a split only changes the display multiplier. Tested for real. [Test: split mid-auction](/devnet/split-test/)

**Are there fees?**
No trading fee. You pay Solana's transaction fee and 0.00121412 SOL of rent for each order's account, which is not returned, by design. [Costs and rent](/mechanism/costs/)

**Why isn't order rent returned?**
The order account is the permanent record of your order and its settlement. It lets you rebuild your outcome from chain even after the auction is closed. [Costs and rent](/mechanism/costs/#why-order-accounts-are-never-closed)

## Pyth

**Does Pyth set the price?**
No. It can only break an exact tie between prices the book already supports, and only if it passes eight on-chain checks. [What Pyth is used for](/pyth/role/)

**Does the reference price stop after the 4pm close?**
Not in the window measured. The AAPL feed kept publishing at every one of 80 checks over 10h38m. An earlier claim that it stops was retracted. [After the close: a retraction](/pyth/after-hours/)

**Has the Pyth tie-break ever run on chain?**
No. Devnet has no fresh Pyth price, so it is covered by unit tests only. [The on-chain gate](/pyth/gate/#tests)

## Devnet

**Why devnet, not mainnet?**
On devnet the mints could be built to match the real xStocks with authorities the team holds. That made it possible to test a pause and a split mid-auction, which only the issuer can do on mainnet. [Why devnet](/devnet/why-devnet/)

**Is any of this real money?**
No. Everything is test tokens on devnet. [Get test tokens](/app/test-tokens/)

**Does the clearing price show real price discovery?**
No. Most devnet orders come from a test bot priced around Pyth. A cross near Pyth shows the bot followed instructions. [Honest limitations](/trust/limitations/)

**Why can't I trade PreStocks or Tessera tokens?**
They charge a transfer fee (PreStocks 100 bps, raised from 50; Tessera 20 bps), which leaves escrow short. [Tokens we cannot support](/tokens/unsupported/)

## Checking

**How do I check a clearing price myself?**
Read the auction account from chain and replay the rule, or run a one-file script. [Verify a clearing price](/trust/verify/)

**Has it been audited?**
No. [Honest limitations](/trust/limitations/#not-done)

<p class="sources">Every answer is a summary of the page it links to; the sources are listed there.</p>
