---
title: What the program guarantees
description: The properties the on-chain program enforces by itself, how each is enforced, and what it cannot protect against.
---

These guarantees come from the program's own checks, not from the app, the keeper or anyone's good behaviour. Each one names the check that enforces it. The program has **not been audited**.

## Price

**One price per auction.** Every fill trades at `clearing_price`. Each order's money leg is computed from it, once, at the cross.

**No buyer pays more than its limit; no seller receives less.** A buy fills only if its limit is at or above the clearing price, and its charge is capped at its escrow. A sell fills only if its limit is at or below it. The only exception is rounding down to the micro-dollar. See [The clearing rule](/mechanism/clearing-rule/#what-this-rule-guarantees).

**The oracle cannot set the price.** Pyth can only choose among prices already tied on volume and on imbalance, and only after passing an eight-condition gate. It is bound to one feed per auction at creation.

## Escrow

**Escrow is held by the program, not a person.** Each auction's two vaults are token accounts owned by the auction's PDA. Only the program can sign for them, and only through its own instructions.

**Placing an order moves exactly the escrow it records.** Buy escrow is quantity × limit, rounded up, so it always covers the most the order could owe.

**Cancelling returns the full escrow, only to the owner, only before the freeze.** The owner must sign, and the program checks that the order belongs to both that owner and that auction.

**Settlement pays each order's owner, not whoever sends it.** For each order in a batch, the program re-derives the order's address and checks it belongs to the auction. It checks that the receiving token accounts are the owner's canonical accounts for the two mints. Funds cannot be redirected to the sender.

## Settlement

**Totals balance to the unit, whatever order batches land in.** Every fill and money leg is fixed at the cross. The two sides fill to exactly the executable volume, and buyers are charged exactly what sellers are paid. Settlement only moves these stored numbers. Tested with 42 wallets and batches sent out of order ([Test: 42-wallet settlement](/devnet/settlement-at-scale/)).

**No double payment.** An order already settled is skipped, so a repeated or overlapping batch pays nothing twice.

**Refunds only when settlement cannot run.** `cancel_and_refund` is refused (`RefundNotAllowed`) unless the ticker mint is paused, or an earlier batch already took the refund path. Nobody can void a cross by choosing refunds. This check was added on 24 September ([Honest limitations](/trust/limitations/#found-and-fixed-on-24-september-the-refund-path-could-void-a-cross)).

**One wind-down path per auction.** The first batch fixes ordinary settlement or refund, and the other is refused from then on (`SettlementPathLocked`). Mixing them could refund a seller shares a buyer had already received. A failed batch rolls back and does not lock the path.

**The cross runs once.** A second `compute_clearing` is a no-op, including mid-settlement.

**Rent is returned only when nothing is owed.** `close_auction` requires a recorded payer, Settled status, every order settled, and both vaults at exactly zero, and it pays only the recorded payer. Leaking rent is recoverable. Stranding escrow is not.

**Every order keeps a permanent record.** Order accounts are never closed.

## What the program cannot protect against

- **The issuer.** It can pause the token, freezing escrowed shares until it unpauses. It can move or burn tokens in any account, escrow included. It could switch on a transfer hook. See [xStocks and Token-2022](/tokens/xstocks-token-2022/).
- **The sender's choice of Pyth account.** The sender of the cross chooses which Pyth account to pass. It cannot take funds or move the price outside what the book supports. See [Honest limitations](/trust/limitations/#what-whoever-sends-the-cross-can-influence).
- **Transfer fees.** A token with an active transfer fee would leave the vault short. Such tokens are not supported.
- **Bugs not yet found.** The program is unaudited. Its unit tests (24, all passing) and the devnet tests are listed in [Transaction index](/trust/transactions/) and [The on-chain gate](/pyth/gate/#tests).

<p class="sources">Sources: <code>uncross/programs/uncross/src/lib.rs</code> (account constraints on <code>CancelOrder</code>, <code>CloseAuction</code>; checks in <code>settle_or_refund</code>), <code>clearing.rs</code>, <code>state.rs</code>, <code>docs/phase2.md</code>, <code>README.md</code>.</p>
