---
title: Glossary
description: Every term these docs use, for readers who know markets but not Solana, and readers who know Solana but not markets.
---

## Market terms

**Call auction.** Orders are collected over a period and matched all at once, at one price, instead of trading one by one as they arrive. Stock exchanges use call auctions to open and close the trading day. Uncross runs one every window, for each ticker.

**Continuous market.** Every order trades the moment it meets an opposite order or a pool. Most crypto venues work this way, including every AMM pool.

**Limit price.** The worst price an order accepts: the most a buyer will pay per share, or the least a seller will take. In the app the field is labelled **Max price** for a buy and **Min price** for a sell.

**Clearing price.** The single price an auction trades at. Every fill in the auction is at this price. See [The clearing rule](/mechanism/clearing-rule/).

**Uniform price.** Everyone in the auction trades at the same price, whatever their limit. A buyer who bid $250 and a buyer who bid $248 both pay the clearing price if it is $247.50.

**Demand and supply at a price.** Demand at *p* is every share buyers would buy at *p*: all buys with a limit at or above *p*. Supply at *p* is every share sellers would sell at *p*: all sells with a limit at or below *p*.

**Executable volume.** The shares that can actually change hands at a price: the smaller of demand and supply there.

**Imbalance.** How far apart demand and supply are at a price, |demand − supply|. The second tie-break prefers the price with the smallest imbalance.

**Price priority.** When more shares are willing to trade than the executable volume, the best-priced orders fill first: the highest buys and the lowest sells.

**Pro rata.** Shared in proportion to size. Orders at the same limit that can only partly fill share what is left in proportion to their quantities.

**Bid and ask.** The best (highest) buy limit and the best (lowest) sell limit in the book. In a continuous market the bid is always below the ask, because a crossing pair would trade at once. In a call auction nothing trades until the cross, so the **bid can sit above the ask**. That overlap is exactly what will trade.

**Indicative price.** What the auction would clear at if it crossed now. The app shows it as **Would clear at**.

**Reference price.** A price published by someone else, here Pyth. It tells you what an asset is worth, not whether you can trade there.

**Price impact.** How far a trade moves the price against the trader in a pool. On a thin pool, even small trades have large impact.

**Liquidity / TVL.** How much value sits in a pool (total value locked). Little liquidity means large price impact.

**Stock split.** A company divides each share into several, lowering the price per share. xStocks express splits through the token's multiplier. See [Raw amounts and splits](/tokens/raw-amounts/).

## Solana terms

**Solana.** A public blockchain. Programs (smart contracts) run on it, and every account and transaction on it is public.

**Mainnet and devnet.** Mainnet is the real network, where tokens have value. Devnet is a public test network with the same software, where tokens are free and worthless. Uncross runs on devnet. See [Why devnet](/devnet/why-devnet/).

**Wallet.** A browser extension (Phantom, Solflare, Backpack) that holds your keys and asks you to approve each transaction. Your wallet address is a public key.

**SOL.** Solana's native token. It pays transaction fees and account rent. On devnet it is free.

**Transaction and signature.** A transaction is a signed request to one or more programs. Its **signature** is its unique ID. Paste it into [Solana Explorer](https://explorer.solana.com/?cluster=devnet) (set to devnet) to see exactly what it did.

**Slot.** Solana's clock tick. A slot is a short period in which one block can be produced. Uncross measures auction windows in slots, not minutes, because slots are what the program can read. Converting slots to minutes needs the network's measured slot rate, which drifts. On devnet it was measured at about 0.166 s per slot.

**Program.** Code deployed on Solana. The Uncross program is `Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP`.

**Instruction.** One call to a program, such as `place_order`. A transaction carries one or more instructions. See [Program instructions](/reference/instructions/).

**Account.** A piece of on-chain storage with an address. Each auction is an account; so is each order.

**PDA (program-derived address).** An account address derived from a program and some seed data, with no private key. Only the program can sign for it. Uncross's auction and order accounts are PDAs, and each auction's escrow vaults are owned by the auction's PDA. So no person holds the escrowed funds.

**Rent.** A deposit in SOL that an account must hold to exist. Closing the account returns it. See [Costs and rent](/mechanism/costs/).

**Mint.** The account that defines a token: its supply, decimals and rules. Each ticker has a mint.

**Token account / ATA.** An account holding one wallet's balance of one token. The **associated token account** (ATA) is the standard one for a given wallet and mint.

**Token-2022.** Solana's newer token program. It supports **extensions**: optional features built into a mint, such as a pause switch or a transfer fee. xStocks use it. See [xStocks and Token-2022](/tokens/xstocks-token-2022/).

**Raw amount.** A token balance in its smallest unit, as the chain stores it. xStocks have 8 decimals, so 1 token is 100,000,000 raw units. The **display amount** is what a wallet shows, which for xStocks is the raw amount times the multiplier.

**Oracle.** A program or data source that publishes off-chain data, such as a stock price, on chain. Pyth is an oracle.

**Keeper / crank.** A service that sends the routine transactions a protocol needs, such as opening auctions, running the cross and settling. The Uncross program does not trust the keeper. Anyone can send these instructions.

## Uncross terms

**Window.** The period an auction takes orders, from its open slot to its close slot. The keeper uses 7,000 slots.

**Freeze.** The last part of the window (700 slots on the keeper's auctions), during which orders **cannot be cancelled**. New orders are still accepted until the window closes.

**The cross.** The moment the clearing price is computed, by the `compute_clearing` instruction, once the window has closed.

**Escrow.** Funds an order locks when placed, held in the auction's vault until settlement or cancellation. A buy locks dollars, a sell locks shares.

**Vault.** One of two token accounts each auction owns: one for the ticker, one for the test dollar.

**Settlement.** Moving shares and dollars out of the vaults to each order's owner after the cross, in batches. See [Auction lifecycle](/mechanism/lifecycle/).

**Settle path.** Each auction is wound down one way only: by ordinary settlement (**clear**) or by full refund (**refund**). The first batch fixes which.

**The gate.** The eight checks a Pyth price must pass before the auction may use it. See [The on-chain gate](/pyth/gate/).

**Receipt.** The app's summary of what one of your orders came to. See [Your receipt](/app/receipt/).

**Fixture mint.** A devnet mint built to match a real mainnet xStock's extensions. Its authorities are held by the Uncross team, so issuer actions can be tested.

<p class="sources">Sources: <code>uncross/programs/uncross/src/</code>, <code>docs/numbers.md</code>, <code>docs/phase0.md</code>, <code>web/src/components/OrderForm.tsx</code>.</p>
