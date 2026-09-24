---
title: Auction lifecycle
description: Open, orders and escrow, the freeze, the cross, batched settlement, refunds and rent reclaim, with what you can and cannot do at each stage.
---

Every auction goes through the same stages. Each stage is enforced by the on-chain program and measured in **slots**, not minutes.

## At a glance

| Stage | Slots | Place an order | Cancel your order | What happens |
|---|---|---|---|---|
| **Open** | open slot → close slot − freeze | yes | yes, full refund at once | Orders collect. Escrow is locked in the auction's vaults. |
| **Freeze** | last 700 slots before close | **yes** | **no** | Orders still collect, but none can be cancelled. |
| **Awaiting cross** | close slot → the cross | no | no | The window has closed. The cross can be sent. |
| **Cleared** | after `compute_clearing` | no | no | One price is fixed, with every order's fill and money leg. |
| **Settling** | after the first batch | no | no | Batches pay each order out of the vaults. |
| **Settled** | every order paid | no | no | Both vaults are empty. The auction's rent can be returned. |

:::note[The book does not close at the freeze]
The freeze stops **cancellation** only. The program accepts `place_order` until the window closes. An order placed during the freeze is final: it cannot be cancelled. The order form says so while an auction is in its freeze.
:::

## Timing

The keeper opens each auction with a window of **7,000 slots** and a freeze of **700 slots**. Those are the only fixed numbers. They are written into each auction account (`close_slot`, `freeze_slots`), and anyone can read them there.

Converting slots to minutes needs the network's slot rate, which is measured, not specified, and it drifts. At the rate measured on devnet, **6.04 slots per second (about 0.166 s per slot)**:

- 7,000 slots ≈ 19.3 minutes (derived);
- 700 slots ≈ 116 seconds, about two minutes (derived).

The app counts down using the same measured rate. It reads the current slot every 12 seconds and the slot rate every two minutes, so its countdown is an estimate. See [Read a ticker page](/app/ticker-page/).

There is no shared schedule across tickers. The keeper checks every 20 seconds, and when a ticker has no auction taking orders it opens one starting at the current slot. Each ticker's clock therefore starts wherever its last auction ended, and the tickers drift apart. Between one auction's cross and the next one's opening there are a few seconds with no auction running. The sidebar says "between auctions" then.

## 1. Open

`initialize_auction` creates the auction account and its two vaults: one token account for the ticker, one for the test dollar. Both vaults are owned by the auction's PDA, so only the program can move what is in them. The instruction also fixes:

- the ticker and quote mints;
- the open slot, close slot and freeze length;
- the Pyth feed the auction will accept, or none. This binding is what stops anyone passing another asset's price at the cross. See [The on-chain gate](/pyth/gate/).
- who paid the rent, so that `close_auction` can return it to them later.

Anyone can open an auction. The keeper opens them for ten tickers on cadence. For a listed ticker with nothing running, the app can ask the faucet service to open one ([Open an auction, run the cross](/app/open-and-crank/)).

## 2. Orders and escrow

`place_order` is accepted while the auction is open and the current slot is in its window. It also needs the book not to be full: an auction holds at most **63** orders. It moves your escrow into the auction's vault in the same transaction:

- **Buy:** quantity × limit price in test dollars, rounded up to the micro-dollar;
- **Sell:** the shares themselves.

It also creates an **order account** for you, which records the owner, side, limit, quantity, escrow and, later, the fill. You pay that account's rent, and it is never returned, by design ([Costs and rent](/mechanism/costs/)).

After every order, and after every cancel, the program reruns the clearing rule over the live book and stores the result as the indicative price and volume. The app shows these as **Would clear at**.

Buys and sells overlap freely before the cross. A best bid above the best ask is normal here: nothing executes until the cross, and the overlap is what will trade.

## 3. Cancelling, and the freeze

`cancel_order` returns your full escrow immediately, in the same transaction. Only the order's owner can cancel it. It is refused with `PastFreezeWindow` once the current slot reaches close slot − freeze slots.

The freeze exists so the book cannot change shape by withdrawal in the final moments. Orders can still arrive, but none can leave.

This was checked end to end on the live site on 24 Sept, with a fresh browser wallet. It cancelled one order while the auction was open. Once the auction froze, the page disabled Cancel, and a cancel sent straight to the program was refused on chain with `PastFreezeWindow`. Signatures are in [Transaction index](/trust/transactions/).

## 4. The cross

Once the current slot reaches the close slot, anyone can send `compute_clearing`. The keeper normally does, within one of its 20-second ticks. The instruction:

1. runs the Pyth price the sender passed through the eight-condition gate, and records the verdict and the price's publish time on the auction;
2. computes the clearing price and volume by [the clearing rule](/mechanism/clearing-rule/);
3. fixes every order's fill and every order's money leg, what each seller receives and each buyer is charged, and stores them in the auction account.

It runs once. A second call is a no-op. An auction with no orders, or whose orders were all cancelled, goes straight to **Settled**, because nothing is left to pay out.

## 5. Settlement, in batches

`settle_batch` pays out a list of orders using the numbers fixed at the cross:

- **Buy:** receives its filled shares, plus its escrow minus its charge;
- **Sell:** receives its proceeds, plus its unfilled shares.

Anyone can send it. It is batched because a Solana transaction is limited to 1,232 bytes, and each order adds three accounts: the order and the owner's two token accounts. Measured on the real instruction, **7 orders fit per transaction** when every owner is different. The program allows up to 12 per call as a compute bound. A 42-order book settled in six batches ([Test: 42-wallet settlement](/devnet/settlement-at-scale/)).

Batches are safe to repeat and to send in any order. An order already settled is skipped, so a duplicate batch pays nothing twice, and overlapping batches settle only the new orders. Settlement moves only numbers decided at the cross. So the totals balance, and both vaults end at exactly zero, whatever order batches land in.

When every order is settled, the auction's status becomes **Settled**.

## 6. The refund path

`cancel_and_refund` is the failure path. It returns every order's **full original escrow**, ignoring the computed fill. It exists for when ordinary settlement cannot run, most importantly when the token's issuer has paused the mint ([Test: pause mid-auction](/devnet/pause-test/)).

An auction is wound down **one way only**. The first batch, whether `settle_batch` or `cancel_and_refund`, fixes the auction's settle path, and the other instruction is refused from then on with `SettlementPathLocked`. Mixing them would let a seller be refunded shares a buyer had already received. A failed settlement attempt, such as one rejected because the mint is paused, rolls back and does not lock the path.

:::caution[Anyone can choose the refund path first]
`cancel_and_refund` has no caller restriction and does not check whether the mint is paused. Whoever sends the **first** batch after the cross chooses the path. A wallet that sends a refund batch before the keeper's first settlement locks the auction onto refunds. Every order then gets its full escrow back, and the trades computed at the cross never happen. No funds are at risk. But any wallet can void any auction's trades this way. This is listed in [Honest limitations](/trust/limitations/).
:::

## 7. Closing and rent reclaim

`close_auction` returns the rent of the auction account and both vaults to whoever paid it: about 0.0183 SOL per auction. It refuses anything that could still owe someone money. It requires that:

- the auction recorded who paid its rent (auctions created before 16 Sept did not, and can never be closed);
- the status is **Settled**, with every order settled;
- both vaults hold exactly zero;
- the rent goes to the recorded payer and nowhere else.

On devnet it was tested refusing an auction mid-window, one cleared but unsettled, one partially settled, one with a stray token in a vault, and a wrong rent recipient. It then closed a finished one. Anyone can send it.

The keeper closes finished auctions, but never one that holds an order from anyone other than the test bot. That way a participant's auction keeps its full on-chain record.

**Order accounts are never closed.** They are the permanent record of each order and its settlement. See [Costs and rent](/mechanism/costs/).

<p class="sources">Sources: <code>uncross/programs/uncross/src/lib.rs</code> (every instruction and check), <code>state.rs</code>, <code>docs/railway.md</code> (keeper start command), <code>docs/numbers.md</code> (timing and slot rate), <code>docs/submission-draft.md</code> (6.04 slots/s, browser-wallet run, keeper close policy), <code>docs/phase2.md</code> (batch size, path lock), <code>README.md</code> (close_auction tests), <code>web/src/components/OrderForm.tsx</code>.</p>
