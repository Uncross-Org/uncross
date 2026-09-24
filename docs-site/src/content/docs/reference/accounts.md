---
title: Accounts and layout
description: The Auction and Order accounts, field by field, with byte offsets for reading them straight from chain.
---

Two account types belong to the program. Byte offsets below **include the 8-byte Anchor discriminator**, so they index directly into the raw account data an RPC returns. Integers are little-endian.

## Auction

A zero-copy account of **2,880 bytes** at PDA `["auction", ticker_mint, open_slot as u64 LE]`. It is zero-copy so Anchor never copies it onto the 4 KB program stack. The order summaries are stored inline, so the cross runs over this one account.

| Offset | Field | Type | Meaning |
|---|---|---|---|
| 0 | discriminator | [u8; 8] | Anchor account type tag |
| 8 | `open_slot` | u64 | first slot orders are accepted |
| 16 | `close_slot` | u64 | orders accepted before this slot; the cross from it |
| 24 | `freeze_slots` | u64 | cancelling stops at `close_slot − freeze_slots` |
| 32 | `cadence_slots` | u64 | the window length the opener intended |
| 40 | `clearing_price` | u64 | quote units per whole raw token |
| 48 | `executable_volume` | u64 | raw ticker units |
| 56 | `reference_price` | u64 | the gate-passing Pyth price, per raw token; 0 if none |
| 64 | `indicative_price` | u64 | would clear at, before the cross |
| 72 | `indicative_volume` | u64 | would trade, before the cross |
| 80 | `ticker_mint` | Pubkey | |
| 112 | `quote_mint` | Pubkey | |
| 144 | `ticker_token_program` | Pubkey | Token-2022 for xStocks |
| 176 | `quote_token_program` | Pubkey | legacy SPL Token for the test dollar |
| 208 | `vault_ticker` | Pubkey | |
| 240 | `vault_quote` | Pubkey | |
| 272 | `pyth_feed_id` | [u8; 32] | bound feed; all zero = no oracle |
| 304 | `protocol_fee_bps` | u16 | always 0, unused |
| 306 | `order_count` | u16 | |
| 308 | `settled_count` | u16 | |
| 310 | `ticker_decimals` | u8 | 8 for xStocks |
| 311 | `quote_decimals` | u8 | 6 |
| 312 | `status` | u8 | 0 open, 1 cleared, 2 settled |
| 313 | `reference_price_set` | u8 | 1 if a Pyth price passed and was used |
| 314 | `bump` | u8 | PDA bump |
| 315 | `settle_path` | u8 | 0 none, 1 clear, 2 refund |
| 316 | `oracle_gate` | u8 | gate verdict code ([table](/pyth/gate/#what-is-recorded-per-auction)) |
| 317 | padding | [u8; 3] | |
| 320 | `orders` | [OrderSummary; 63] | 40 bytes each |
| 2840 | `payer` | Pubkey | who paid the rent; all zero on auctions created before 16 Sept |
| 2872 | `oracle_publish_time` | i64 | publish time of the price the gate examined; 0 if none |

### OrderSummary (40 bytes, at 320 + 40 × index)

| Offset in summary | Field | Type |
|---|---|---|
| 0 | `limit_price` | u64 |
| 8 | `quantity` | u64 |
| 16 | `filled_quantity` | u64, set at the cross |
| 24 | `quote_amount` | u64, set at the cross: what a seller receives or a buyer is charged, in quote units |
| 32 | `active` | u8 |
| 33 | `cancelled` | u8 |
| 34 | `side` | u8: 0 buy, 1 sell |
| 35 | padding | [u8; 5] |

`MAX_ORDERS` is 63, not 64. The 64th summary slot's 40 bytes now hold `payer` and padding, so the account kept its size, and auctions created before the rent-reclaim upgrade still load. In those older accounts the bytes are zero, which reads as "payer unknown".

## Order

A Borsh account of **111 bytes** at PDA `["order", auction, order_index as u16 LE]`. **Never closed**: it is each order's permanent record ([Costs and rent](/mechanism/costs/)).

| Offset | Field | Type |
|---|---|---|
| 0 | discriminator | [u8; 8] |
| 8 | `auction` | Pubkey |
| 40 | `owner` | Pubkey |
| 72 | `order_index` | u16 |
| 74 | `side` | u8: 0 buy, 1 sell |
| 75 | `limit_price` | u64 |
| 83 | `quantity` | u64 |
| 91 | `escrow_amount` | u64 |
| 99 | `filled_quantity` | u64, written at settlement |
| 107 | `cancelled` | bool |
| 108 | `settled` | bool |
| 109 | `refunded` | bool |
| 110 | `bump` | u8 |

To find every order a wallet owns, ask for the program's accounts with `dataSize` 111 and a `memcmp` on the wallet at offset 40 ([Verify a clearing price](/trust/verify/#rebuild-a-closed-auction)).

**About `refunded`:** the program sets it in two places. `cancel_order` sets it, and so does settlement on the refund path. An unfilled order whose escrow came back at ordinary settlement reads false. The app does not read this flag.

## Vaults

Each auction's two vaults are ordinary associated token accounts owned by the auction PDA: one for the ticker mint (Token-2022), one for the quote mint (legacy SPL Token).

<p class="sources">Sources: <a href="https://github.com/Uncross-Org/uncross/blob/532dcb736e8aa2c811e8b4704a8f36ec0c0f0a73/uncross/programs/uncross/src/state.rs"><code>state.rs</code></a> (layouts, size tests), <code>lib.rs</code> (PDA seeds, flags), checked against live devnet accounts on 24 Sept 2026.</p>
