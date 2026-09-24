---
title: Program instructions
description: All seven instructions of the Uncross program, who may call each, when, and what it checks.
---

Program: `Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP` on devnet, written with Anchor. The IDL is committed at `uncross/idl/` and `web/src/idl/uncross.json`.

| Instruction | Who may call | When |
|---|---|---|
| `initialize_auction` | anyone (pays the rent) | any time |
| `place_order` | anyone (signs as the order's owner) | open slot ≤ slot < close slot |
| `cancel_order` | the order's owner only | slot < close slot − freeze slots |
| `compute_clearing` | anyone | slot ≥ close slot |
| `settle_batch` | anyone | after the cross |
| `cancel_and_refund` | anyone | after the cross, before any ordinary settlement, and only while the ticker mint is paused or once the refund path is chosen |
| `close_auction` | anyone | fully settled, vaults empty |

## `initialize_auction`

Arguments: `open_slot`, `close_slot`, `freeze_slots`, `cadence_slots`, `pyth_feed_id` (32 bytes, all zero for no oracle).

- Requires `close_slot > open_slot` (`InvalidWindow`) and `freeze_slots` smaller than the window (`FreezeTooLong`).
- Creates the auction account at PDA `["auction", ticker_mint, open_slot as u64 little-endian]`. Creates its two vaults as the auction PDA's associated token accounts for the ticker and quote mints, each under its own token program.
- Records the mints, token programs, vaults, decimals, window, feed ID and the rent payer. Sets `protocol_fee_bps` to 0, a field that is present but unused.

## `place_order`

Arguments: `side` (Buy or Sell), `limit_price`, `quantity`, `order_index`.

- Requires quantity > 0 (`ZeroQuantity`), limit > 0 (`ZeroPrice`), status open (`AuctionNotOpen`), the slot inside the window (`OutsideOpenWindow`), fewer than 63 orders (`OrderBookFull`), and `order_index` equal to the auction's current order count (`OrderIndexMismatch`).
- Escrow: a buy locks `ceil(quantity × limit_price / 10^ticker_decimals)` quote units; a sell locks `quantity` ticker units. Moved from the owner's canonical token account to the vault with `transfer_checked`.
- Creates the order account at PDA `["order", auction, order_index as u16 little-endian]`, paid by the owner. Writes the order's summary into the auction. Recomputes the indicative price and volume with no oracle.
- The owner's two token accounts must already exist. The app creates them in the same transaction if missing.

## `cancel_order`

- Requires slot < `close_slot − freeze_slots` (`PastFreezeWindow`). The order must not already be cancelled (`AlreadyCancelled`) or settled (`AlreadySettled`). The signer must own the order (`NotOrderOwner`), and the order must belong to the auction (`OrderAuctionMismatch`).
- Returns the full escrow from the vault to the owner. Marks the order cancelled, refunded and settled, and counts it as settled in the auction. Recomputes the indicative price and volume.

## `compute_clearing`

Accounts include `pyth_price_feed`, **any account the caller chooses**, checked by the gate and never trusted.

- A no-op if the auction is not open, that is, if it has already crossed. Requires slot ≥ close slot (`AuctionNotClosed`).
- Runs the [Pyth gate](/pyth/gate/). If it passes, converts the price per share to per raw token with the mint's effective multiplier. Records `oracle_gate`, `oracle_publish_time`, `reference_price_set` and `reference_price`.
- Computes the clearing price and volume ([The clearing rule](/mechanism/clearing-rule/)). Assigns every order's fill (`assign_fills`) and money leg (`assign_quote_amounts`).
- Sets status to Cleared, or straight to Settled if every order is already settled (for example, an empty book).

## `settle_batch`

Arguments: `order_indices`, 1 to 12 of them (`BatchTooLarge`). Remaining accounts: for each index, `[order, owner_ticker_ata, owner_quote_ata]`.

- Requires the auction to have crossed (`NotYetCleared`). Requires the settle path to be none or already clear (`SettlementPathLocked`), and sets it to clear.
- For each order: re-derives the order PDA from the index and requires it to match (`OrderIndexOutOfRange`). Requires the order to belong to the auction (`OrderAuctionMismatch`). **Skips it if already settled.** Requires both token accounts to be the owner's canonical ones (`WrongMint`).
- Buy: sends the filled shares, then escrow minus charge in quote. Sell: sends the proceeds in quote, then the unfilled shares. Zero-amount transfers are skipped.
- Records the order's filled quantity and marks it settled. When every order is settled, sets the auction to Settled.

## `cancel_and_refund`

Same arguments, accounts and per-order checks as `settle_batch`, on the **refund** path.

- **Checked first:** the ticker mint is paused, or the auction's settle path is already refund. Otherwise it fails with `RefundNotAllowed`. The second case lets sellers' shares be refunded after the issuer resumes. There is no caller restriction beyond this.
- Then requires the settle path to be none or already refund, and sets it to refund.
- Returns each order's full original escrow, ignoring its computed fill, and marks it refunded and settled.
- The pause check was added on 24 September. Before it, anyone could choose this path after a cross ([Honest limitations](/trust/limitations/#found-and-fixed-on-24-september-the-refund-path-could-void-a-cross)).

## `close_auction`

- Requires a recorded payer (`UnknownRentPayer`), status Settled with every order settled (`AuctionNotSettled`), both vaults at exactly zero (`VaultNotEmpty`), and the rent recipient to be the recorded payer (`WrongRentRecipient`).
- Closes both vaults and the auction account, returning their rent to the payer.
- There is no instruction that closes an order account, by design.

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `MAX_ORDERS` | 63 | orders per auction |
| `MAX_BATCH` | 12 | orders per `settle_batch` or `cancel_and_refund` call (a compute bound; transaction size limits a batch to 7 with distinct owners) |
| `ORACLE_MAX_AGE_SECS` | 90 | freshness window for a Pyth price |
| `MAX_CONF_BPS` | 200 | confidence cap: 2% of the price |

<p class="sources">Sources: <a href="https://github.com/Uncross-Org/uncross/blob/532dcb736e8aa2c811e8b4704a8f36ec0c0f0a73/uncross/programs/uncross/src/lib.rs"><code>lib.rs</code></a>, <code>state.rs</code>, <code>oracle.rs</code>, <code>errors.rs</code>, <code>web/src/lib/tx.ts</code>.</p>
