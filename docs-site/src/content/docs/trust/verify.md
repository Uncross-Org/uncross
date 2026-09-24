---
title: Verify a clearing price
description: Check any Uncross cross yourself, from chain, without trusting the app, worked through on the 23 Sept MSTRx auction.
---

Every clearing price can be checked from public chain data. You need nothing from Uncross except the program's published rule. This page walks through it on a real auction: the **23 September MSTRx cross**, the first auction with orders from people other than the builder. The same steps apply to the [24 September community auction](/trust/transactions/#the-community-auction-24-sept), whose two books the script also matches.

## The fast way: a script

[`verify-auction.mjs`](/verify-auction.mjs) is a single file with no dependencies (Node 18 or later). It reads an auction account from devnet, decodes the orders the program stores in it, replays the clearing rule, and compares the result with what the program recorded.

```sh
curl -O https://docs.uncross.0xo.in/verify-auction.mjs
node verify-auction.mjs 6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7
```

Its actual output, 24 Sept 2026:

```
auction 6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7: settled, 3 orders
  #0 buy         1 @       164.24   filled 1
  #1 sell        1 @       158.01   filled 1
  #2 buy         1 @       151.09   filled 0

  candidate      demand     supply     volume    |D-S|
        151.09          2          0          0        2
        158.01          1          1          1        0
        164.24          1          1          1        0

Pyth check recorded at the cross: stale, price published 2026-07-02T13:48:55.000Z
replayed: $161.125 x 1 tokens, set by midpoint
recorded: $161.125 x 1 tokens
MATCH
```

Prices are per whole token. For MSTRx the multiplier is 1, so that is per share. Before publishing, the script was also run over 40 other devnet auctions. It matched the recorded price and volume on all 39 that had crossed.

## The same check, by hand

### 1. Read the auction account

The auction is [`6RmfQTeT…Npqxyhf7`](https://explorer.solana.com/address/6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7?cluster=devnet). Fetch it with any Solana RPC:

```sh
curl -s https://api.devnet.solana.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getAccountInfo","params":["6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7",{"encoding":"base64"}]}'
```

It is 2,880 bytes, owned by the Uncross program. The fields you need, by byte offset including the 8-byte discriminator (full layout in [Accounts and layout](/reference/accounts/)):

| Field | Offset | Type | This auction |
|---|---|---|---|
| `clearing_price` | 40 | u64 | 161,125,000 ($161.125) |
| `executable_volume` | 48 | u64 | 100,000,000 (1 token) |
| `order_count` | 306 | u16 | 3 |
| `status` | 312 | u8 | 2 (settled) |
| `reference_price_set` | 313 | u8 | 0 (no Pyth price used) |
| `oracle_gate` | 316 | u8 | 8 (stale) |
| order summaries | 320 + 40 × *i* | 40 bytes each | below |
| `oracle_publish_time` | 2872 | i64 | 1783000135 (2 July 2026) |

Each order summary holds the limit (u64), quantity (u64), filled quantity (u64), money leg (u64), then `active`, `cancelled` and `side` bytes (0 = buy, 1 = sell).

| # | Side | Limit | Quantity | Filled | Money leg |
|---|---|---|---|---|---|
| 0 | <span class="buy">Buy</span> | $164.24 | 1 | 1 | charged $161.125 |
| 1 | <span class="sell">Sell</span> | $158.01 | 1 | 1 | receives $161.125 |
| 2 | <span class="buy">Buy</span> | $151.09 | 1 | 0 | — |

### 2. Replay the rule

- **Candidates:** $151.09, $158.01, $164.24.
- **At $151.09:** demand 2 (both buys), supply 0 → volume 0.
- **At $158.01:** demand 1 (the $164.24 buy), supply 1 → volume 1, imbalance 0.
- **At $164.24:** demand 1, supply 1 → volume 1, imbalance 0.

$158.01 and $164.24 tie on volume and on imbalance. The oracle rule applies only if a Pyth price passed the gate, and `reference_price_set` is 0. So the midpoint decides: ($158.01 + $164.24) ÷ 2 = **$161.125**, matching `clearing_price`.

The buy at $151.09 is below the clearing price and fills nothing.

### 3. Check why no oracle broke the tie

`oracle_gate` = 8 is **stale**. The keeper passed the devnet MSTR Pyth account, whose latest price was published at 1783000135 (13:48:55 UTC on 2 July 2026), months older than the 90-second limit. The auction therefore cleared from the book alone. Gate codes are listed in [The on-chain gate](/pyth/gate/#what-is-recorded-per-auction).

### 4. Check the money actually moved

The settlement transaction [`4ws2ByFq…hNGBKY8A`](https://explorer.solana.com/tx/4ws2ByFqvSJzCVG73iW1D7CRSP8eYNqKBoq2CybQk2a6mdkHK1byo8KpmEnRFBEVWfHtzpYZiJK3RFQahNGBKY8A?cluster=devnet) moved, per its token balance changes:

| Account owner | MSTRx | Test dollars |
|---|---|---|
| Auction vaults | −1 | −$315.33 |
| `G4o8…xWPc` (buy #0) | **+1** | +$3.115 back: escrow $164.24 − charge $161.125 |
| `218b…Z7US` (sell #1) | 0 (its share was already in escrow) | **+$161.125** |
| `Cwcg…p9Gu` (buy #2) | 0 | +$151.09 back: its full escrow |

$3.115 + $161.125 + $151.09 = $315.33, exactly what left the vault. The seller received $3.115 more than its limit, and the buyer paid $3.115 less than its limit.

The cross itself is [`2SKcwefY…K75FpLAU`](https://explorer.solana.com/tx/2SKcwefYsGdpquxrgJP2yRdnn2VpyBEL7oV2GdmjBsTFGqqHvP6L58wxMcAsuU7DYnyvhmeJBMRrhMpFK75FpLAU?cluster=devnet).

**About these wallets.** None of the three is one of the test bot's wallets. Two of the orders were placed by people other than the builder, from a group chat where the venue had been shared. The three wallets have transacted with one another before, so these were people who know each other, not strangers. It ran on devnet and was not an open public event.

## A second example: the tie-break on imbalance

[The clearing rule](/mechanism/clearing-rule/#a-real-auction-worked-by-hand) works through auction [`Dw4UdSGL…ttm8nt8U`](https://explorer.solana.com/address/Dw4UdSGL6fvCPu6QuC8s7RkLv6gLETHzbaaLttm8nt8U?cluster=devnet). There four prices tie on volume and the imbalance rule narrows them to two before the midpoint. The script matches it too. It crossed before the gate was recorded, so its gate reads "not recorded".

## Rebuild a closed auction

A settled auction may later be closed to return its rent, and then its account is gone. The order accounts are never closed, so the record survives:

1. **Find the order accounts.** Ask for program accounts of size 111 bytes whose owner field (offset 40) is the wallet:

   ```sh
   curl -s https://api.devnet.solana.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts","params":["Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP",{"encoding":"base64","filters":[{"dataSize":111},{"memcmp":{"offset":40,"bytes":"<WALLET>"}}]}]}'
   ```

2. **Read each one.** It holds its auction's address (offset 8), side, limit, quantity, escrow and filled quantity ([Accounts and layout](/reference/accounts/#order)).
3. **Read the settlement transaction** from the order account's transaction history. Its token balance changes give what was paid, received and returned. The clearing price is what was paid ÷ what filled.

For `G4o8…xWPc` this returns one order account, [`62u1HoBD…uZBmiFU1`](https://explorer.solana.com/address/62u1HoBDiSiUvjpPG7rf7wy28EHck6GPjyhVuZBmiFU1?cluster=devnet), for auction `6RmfQTeT…yhf7`: a buy, limit 164.24, quantity 1, escrow 164.24, filled 1, settled.

The app's receipts do exactly this for closed auctions, and label the result as rebuilt ([Your receipt](/app/receipt/)).

## In the app

The app's [auction page](https://uncross.0xo.in/app?view=auction&auction=6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7) does all of the above in the browser. It replays the clearing rule step by step from the auction account and says which rule set the price. For this auction it reads: "$158.01 and $164.24 tie on volume and on balance. The program's Pyth check recorded 'stale', so no oracle broke the tie, and the midpoint of the tied range sets the price: $161.125". It then checks the replay against the recorded price. It is still worth running the script: the page is part of the app, and the script depends only on the chain.

<p class="sources">Sources: devnet reads of the auction account, the settlement transaction and the order accounts, made 24 Sept 2026; <code>uncross/programs/uncross/src/state.rs</code> (layout), <code>clearing.rs</code>; <code>docs/submission-draft.md</code> (the MSTRx cross and its participants); <code>web/src/components/AuctionPage.tsx</code> and <code>web/src/lib/clearing.ts</code>.</p>
