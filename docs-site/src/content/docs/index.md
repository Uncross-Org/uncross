---
title: What Uncross is
description: A periodic call auction for tokenized stocks on Solana. Orders collect for a window, then everyone who trades fills at one price.
---

Uncross is a **periodic call auction** for tokenized US stocks on Solana. Orders do not trade when they arrive. They collect during a window of about 19 minutes. Cancelling closes for the last 700 slots of it, about two minutes. Then everything in the book clears at a single price: the price at which the most shares change hands.

- **Buyers** pay the clearing price, never their limit if the clearing price is lower. The difference comes back to them.
- **Sellers** receive the clearing price, never less than they asked.
- **Unfilled orders** get everything they locked back.
- **Nobody in an auction gets a worse price than anyone else in it.** There is one price.

It is live at [uncross.0xo.in](https://uncross.0xo.in) on **Solana devnet**. There everything is a test token and nothing is worth money. It was built for the Stocklana hackathon (Solana Foundation), September 2026. The source is at [github.com/Uncross-Org/uncross](https://github.com/Uncross-Org/uncross).

## Why it exists

Of the **1,026** xStocks tokenized equities on Solana, only **55** had any DEX pool when read on 23 Sept 2026, and **971** had none at all. For those 971 there is no quote, no route and no venue. Even many tickers that do have a pool are too thin to trade at a sensible price. [Why a call auction](/mechanism/why-call-auctions/) has the figures and how they were read.

A call auction needs no pool and no market maker. It needs only people who want to trade the same name in the same few minutes. It gathers them and lets them meet at one price, instead of leaving each to cross a spread alone.

## Where to start

**New to Uncross?** Read [Quickstart: your first order](/start/quickstart/), then [Auction lifecycle](/mechanism/lifecycle/).

**You know markets but not Solana.** Read [Glossary](/start/glossary/) for the Solana terms (wallet, slot, account, rent, Token-2022), then [The clearing rule](/mechanism/clearing-rule/). The mechanism is a standard uniform-price call auction. What is particular here is custody and settlement, covered in [xStocks and Token-2022](/tokens/xstocks-token-2022/) and [What the program guarantees](/trust/guarantees/).

**You know Solana but not markets.** Read [Why a call auction](/mechanism/why-call-auctions/) and [The clearing rule](/mechanism/clearing-rule/) first. For the program itself, see [Program instructions](/reference/instructions/) and [Accounts and layout](/reference/accounts/).

**Judging or auditing a claim?** Read [Honest limitations](/trust/limitations/) and [Verify a clearing price](/trust/verify/). Every signature cited in these docs is listed in [Transaction index](/trust/transactions/).

## What runs where

| Part | What it is |
|---|---|
| On-chain program | `Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP` on devnet, written in Rust with Anchor. Holds escrow, computes the clearing price, settles. |
| Ticker mints | Devnet fixtures built to match the real xStocks mints extension for extension. See [Why devnet](/devnet/why-devnet/). |
| Keeper | A service on Railway that opens a new auction for each of ten tickers whenever one ends, and runs the cross and settlement. Anyone else may run them too. |
| Activity bot | A service that places test orders on some tickers, priced around Pyth. See [Honest limitations](/trust/limitations/). |
| Faucet | Gives a new wallet devnet SOL, test shares and test dollars in one click. |
| Pyth | A reference price from Solana **mainnet**, read-only. It breaks ties between prices the book already supports, and never sets the price. |

<p class="sources">Sources: <code>README.md</code>, <code>docs/submission-draft.md</code>, <code>docs/railway.md</code>, <code>uncross/programs/uncross/src/lib.rs</code>.</p>
