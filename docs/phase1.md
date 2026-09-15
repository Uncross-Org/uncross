# Phase 1 — on-chain program, devnet results

Uniform-price call auction for tokenized equities. This document records what
was actually run and verified on devnet, with transaction signatures. Mainnet
is a separate, single pass and has **not** been run yet (see "Mainnet budget"
at the end).

Cluster: devnet. Program ID: `Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP`.
Fixture mints and their extension diff against the real mainnet AAPLx mint are
in [docs/devnet-fixture.md](devnet-fixture.md).

| | |
|---|---|
| Deploy tx | [`3gNrx6wH…1hcv`](https://explorer.solana.com/tx/3gNrx6wHiZtb64dq81kicJibnph1usbXmKVjvgdJvWe3Mts86jaRf3YD4JFRYhD5SKQpD7BHaAnghrV2pd3y1hcv?cluster=devnet) |
| Program data account | `7Kqq9XySMiYy7H9kucgaF2Vp6oeaE66B1tRYfGUTZv2` |
| IDL account | `554JQBHAdnpE7jKQZxLxbeg2gdEsPrADZ8q7rH16z4MC` |
| Deploy wallet | `68N5a3Nj5u7Kc5RPiyu4iH3qVLN1A7wu1fEWErNtqLJf` |
| Wallet 2 | `DxC9wmwQHc5uSKNTGnfrZebzMHtsTkBTpes5KxyTUiUW` |

Two things are worth stating before the results: the auction never ran with an
oracle anchor (`reference_price_set=false` in every run), because no Pyth
classic price account exists on devnet for a fixture mint — the account passed
fails `oracle::read_fresh_price`'s owner check and the auction proceeds without
a reference price. Per [phase0.md](phase0.md) Q3 that is the *normal* path for
this venue, not a failure, so it is the path that got the most testing. The
oracle tie-break branch itself is covered only by unit tests
(`clearing::tests::oracle_breaks_price_tie`), not on-chain.

## Step 2 — definition of done

Auction `Bddkdu6qTgVNiMecNLZrd1yYQdTEYuk5qft7B9Bt43U4` (open slot 498908583,
close 498908843, freeze 60 slots, cadence 750 slots).

Order book as placed — two wallets, both sides, six orders:

| # | Wallet | Side | Limit | Qty | Outcome |
|---|---|---|---|---|---|
| 0 | deploy | SELL | 240.00 | 10 | filled 10 |
| 1 | wallet 2 | BUY | 250.00 | 10 | filled 10 |
| 2 | deploy | SELL | 245.00 | 5 | filled 0 |
| 3 | wallet 2 | BUY | 243.00 | 8 | filled 0 |
| 4 | deploy | SELL | 300.00 | 1 | cancelled before freeze, refunded |
| 5 | deploy | SELL | 310.00 | 1 | cancel rejected in freeze window; filled 0, refunded at settlement |

**Clearing price: 247.50, executable volume: 10 shares.** This is the exact
result the spec's tie-break chain requires, checked by hand against the
program's output: V(p) = 10 at every one of 240 / 243 / 245 / 250, so the first
tie-break applies — |D−S| is 8 at 240 and 243 but 5 at 245 and 250 — and with
no fresh oracle the still-tied {245, 250} resolves to its midpoint, 247.50.

Settlement economics verified against wallet balances (raw units):

- Seller (deploy) delivered 10 shares, received 10 × 247.50 = **2,475.00** quote
  — i.e. 7.50/share *better* than its 240.00 limit, which is the whole point of
  uniform pricing.
- Buyer (wallet 2) received 10 shares, paid 2,475.00, and was refunded
  10 × (250.00 − 247.50) = **25.00** plus its entire 1,944.00 escrow from the
  unfilled order #3.
- Both vaults ended at exactly **0** — nothing stranded.
- Auction status `Settled`, `settled_count = 6/6`.

Indicative price is recomputed and written on every `place_order` and
`cancel_order`, as required. The harness reads it back after each call; in this
run it stood at 247.50 / 10 shares once the book was built (order #4) and was
unchanged by the cancel of #4, which is correct — #4 was a 300.00 sell that
never affected the cross. The clearest per-order progression captured is from
the two Step 3 auctions, where the value visibly moves as the second side
arrives: 200.00 / volume 0 → 205.00 / volume 4 shares (pause test) and
100.00 / volume 0 → 110.00 / volume 6 shares (multiplier test). In both, the
indicative price before any cross exists is the lone resting order's own limit
with zero executable volume, and it becomes the real clearing price the moment
the book crosses — matching what `compute_clearing` later produced in each case.

`cancel_order` on #4 (before the freeze window) succeeded and refunded the
escrow immediately. `cancel_order` on #5, attempted after `close_slot −
freeze_slots`, was rejected with `PastFreezeWindow` — the freeze window works
in both directions.

`compute_clearing` was called twice; the second call was a no-op that left
price, volume and fills byte-identical, confirming idempotency.

### Signatures

| Step | Signature |
|---|---|
| initialize_auction | `4LWcYzZDXugUqRteR7ZxbJnZgjnPfxFgWnDRrizaVrRKkAcUx8N4BYi23ayv4DirGVjyncZtwAf7aAmMkNpSCCJt` |
| place_order #0 | `2HMSToeaLgmJkNVoUSZVXPLzNxTX5c4wMnQ1Ajy5wd9CY899CgLgQRwKMHhM3j3cZeB7GuFPRH85gGBkDBDrwfQ1` |
| place_order #1 | `2ZE9hmg1uab7ZyFwPGCFJX5HEjeWpjpBeEVd32BughYY2dR1QwTUX3kaZZrc71gDpnbL4QwBhrN8HjHroJH7U25g` |
| place_order #2 | `32GZvbu41fynTUgQgW4aQKARCxuvJQA5Ni9xMRgDhDKp3ULrwAt8ikjFgGjPyinapT847tqm8xkikzxGiZB35AwG` |
| place_order #3 | `4gNatvg7Dg2KrNFhHMqPPkkEk5ZWHP9XCJMsoLgEiPXg3vfgHgUG8j8LgwGTZYxXR2SLeaPM2GkiFX1aggoUVAjs` |
| place_order #4 | `3W7x1fubkjaYRGwDuvQ4qZ2va2RDGQntNY9xgSmQR6tW9YYK2E48yuJyjdutec5YaVzDKiJx9GSmmw89v5tzYEQz` |
| cancel_order #4 (pre-freeze) | `5Vk6fZ9J7LCNgfox1b1SShVNEJachSoGFFVNaGV9imm3pvWQP24J4K2Ck5zSHJif918mnAkzeB2CtsJ9G5daYvHC` |
| place_order #5 | `Kb2u57eGwU7uLPr4yF84FA9LHqCc5djoDiHws8HTY9ikeSTFztZxzEgHWhSN8ie9976opJVBhLJicCVqqh6beQ5` |
| cancel_order #5 (in freeze) | rejected — `PastFreezeWindow`, no transaction landed |
| compute_clearing | `324CU6VC5pTuFzFTiXgj5iUkWofFqNocak41m4mDt39i5yEgnQNaeCzDcvYJCr2VAuk1VsVCjnT4pe5nUPeyFL3P` |
| compute_clearing (idempotent) | `5QzRNSSQaLxCRTRgkXvr11prMjheVYgDLXSZXmezn7df9VF8fvJKsPefw1BXteRwQAvJGWaFM7yixAA2yYy4kv9c` |
| settle_batch [0..5] | `2QkuCd6VfKoRhk4yRZSWVBqmbsPocDLdrwAwhy3VSCGEr6uw4A1Z4GwJmC2PaKjL8pWdN7MNaAFkGQuqkhqCifhF` |

All six orders settled in a single `settle_batch` call, within the ≤18 limit
that [phase0.md](phase0.md) Q6 measured. A batch large enough to need splitting
was not exercised on-chain — the measured 18/19-order ceiling is still a
transaction-size calculation, not something this run proved end to end.

## Step 3 — the two fixture-only traps

### Pause test — passes

Auction `243zHq9yVZWornL3GLCUV9xNDrsjC2w1nDCpfRpsEt5R`: SELL 4 @ 200 (deploy),
BUY 4 @ 210 (wallet 2), cleared at 205.00 for 4 shares, then the fixture mint
was paused via its `pausableConfig` authority *before* settlement.

`settle_batch` failed exactly as it should:

```
Program log: Transferring, minting, and burning is paused on this mint
Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb failed: custom program error: 0x43
```

and the failure was clean in the sense that matters: the transaction aborted
atomically, the auction stayed `Cleared` with `settled_count = 0/2`, every
wallet balance was byte-identical before and after, and both vaults still held
the full escrow. No partial transfer, no half-settled order.

Recovery then worked in two stages, and the staging is itself the finding:

1. **While still paused**, `cancel_and_refund` on the BUY order succeeded and
   returned wallet 2's full 840.00 quote escrow. The quote mint is a different
   mint and was never paused, so quote-denominated refunds stay available even
   while the equity token is frozen.
2. **After resume**, `cancel_and_refund` on the SELL order returned the 4-share
   escrow. Final state: both vaults **0**, auction `Settled` 2/2, and both
   wallets back to their exact pre-auction balances.

**The finding worth carrying forward:** a paused ticker mint blocks refunds of
that ticker too, not just settlement. `cancel_and_refund` is not an escape
hatch from a pause — it is an escape hatch from a *failed clearing*, and while
an issuer holds the pause authority (they do on every mint in Q1) escrowed
shares are unreachable until the issuer unpauses. That is inherent to
Token-2022's pausable extension, not something the program can route around,
and it should be said plainly in user-facing copy rather than discovered by a
user mid-pause. The program's part — failing atomically and leaving every
balance recoverable the moment the pause lifts — works.

A separate side-effect worth recording: calling `cancel_and_refund` twice on
the same order is a no-op the second time (`if order.settled { continue; }`),
verified on auction `7UNGYionNP8UzEh881TW2Hu1hzem2ugPrp6YCnzjwLey` — balances
did not move on the repeat call. No double refund.

| Step | Signature |
|---|---|
| initialize_auction | `5zSWWcECSgLRrcj6wmPkdnuh5GJUYdvES8Xt8CyzFZUGUW248bQNbkyQRNPXMS66THReggMztvxM3F2pHqCYeJh3` |
| place_order #0 (SELL 4 @ 200) | `4SCjHhegb1fSfrUhDYxikDEoHa4T4DjTLma4Q5smo4yRDDeidYtBmz3qZ3Cqg9yQT4N58uffgr46qaumcfKjA567` |
| place_order #1 (BUY 4 @ 210) | `27e2ZnfCrfFkpn6hkAcTXfzWPXnawyRUZXtiCBWJRFDxPwqsd6mQWpXteEwDY5fx1hz73cLxYRGvrpthKpnUin4J` |
| compute_clearing | `P9Jf2Sc9PaK3GSNQNuhEiBkJNGnjdBZTCxkLkZDmAEmEeWjDhiuuP28G8dBLe4LSYYPm5wTbn4WMv6ms98EBtvY` |
| pause mint | `4FHHJEmuJWpYEy3oksW2hKENbzT7Z9THwYmch4CpVEnsiJmTPszWReMRi4r5hoBW448TicTqPoDLhwiy9gYZYotC` |
| settle_batch (while paused) | rejected — Token-2022 `0x43`, no transaction landed |
| cancel_and_refund [1] (paused, quote side) | `5SEFyptpcyg2xKzmyjRLFJHsEXf97Rj4rxhgTpTuZCX2iaJB34hRPAJaFZRNNJsqNGD51Ajf3MXbiZUMvy7DjrCT` |
| resume mint | `DQ37fmkWpnwGeKJpSsdZp8zY3Wmr3LfXQG6bUaV1fkr9UotkKUrbiyc3msUxZCctCpUsm1V8DwJQyykxcc7WjTw` |
| cancel_and_refund [0] (after resume) | `54YkbSwCBhYGnpAnqbDy13T3x5d9RnqEmFQnX3z5L7HxeqUfmZDFKY6UyeMuB8LUPHaw4fKzpprJzCUhfHrSdhoi` |

### Multiplier test — passes

Auction `FAi9XwsdZtCbwFxmHQ65G4swWsjP8vHmevhXaoGUUfnk`: SELL 6 @ 100 (deploy),
BUY 6 @ 120 (wallet 2). With the escrow held and the auction open, the fixture
mint's `scaledUiAmountConfig` multiplier was changed from 1 to **2** — the
issuer's stock-split mechanism, applied mid-auction.

The expected raw outcomes were written down *before* the multiplier changed:
clearing at 110.00 (midpoint of the tied 100/120 candidates), a 600000000-raw
fill, 660000000 raw quote to the seller, 60000000 raw refunded to the buyer.
Every one of them came back unchanged after the change:

| | Pre-settle (raw) | Post-settle (raw) | Delta |
|---|---|---|---|
| deploy ticker | 98400000000 | 98400000000 | 0 (all 6 escrowed shares sold) |
| deploy quote | 2475000000 | 3135000000 | **+660000000** |
| wallet 2 ticker | 1000000000 | 1600000000 | **+600000000** |
| wallet 2 quote | 96805000000 | 96865000000 | **+60000000** |
| vaults | 600000000 / 720000000 | 0 / 0 | emptied |

Clearing price came out at `110000000` with executable volume `600000000`, and
both orders filled `600000000` — identical to the pre-change prediction.

The proof that the multiplier was genuinely live during settlement, rather than
inert: wallet 2's ticker account read **raw `1600000000` but UI `32`** at the
same moment. The display layer doubled; the program's accounting did not move.
State holds raw amounts only, as the data model requires. No fix needed.

| Step | Signature |
|---|---|
| initialize_auction | `GwmoiFpNRgKtXAGt1vz85KVqJGyeisaeR4JPXDA1MnZZe3fsy7VLXezbUAT8SRLjpwtNC2rkxkgDJBCDAzqLNKd` |
| place_order #0 (SELL 6 @ 100) | `4SpoB576zVxvD53N1H9iypSCAKzDuodXbEVKP9oBS7XW61nz6xcxiME3GDAQP9MEyghY73G62UuZfKeGc21VTJ1F` |
| place_order #1 (BUY 6 @ 120) | `4aUjFo2fqigaS8A6DSNZ8GqNxQuBLoV6g943sd9pTfP1F3PzaxmvEqRVb1qMvavkKfST9dkRcxVKTvBU5qpW1711` |
| set multiplier 1 → 2 | `4BZK8vxKbPs7CF3T5bWzZk9pZ3zLaBFwuqKpUrghMrhNjsPnudggg6Qj2XCMSwDTf2h8EG54dy2N81ZhMuNT5PGd` |
| compute_clearing | `2PvqBTsYe6rb5VpVDE23zyH5hc1U9emFQBdUCnR4jKZS7zWkXfaXYcqUd5gk8yhmxMn9fECMPJvZijSj3f8jjmSQ` |
| settle_batch [0,1] | `3vYPfkaBEJog8u3m2MzDMMBcLgrXrdPZYNNEqcLV1zJdhitFSQH3dnuenS6UEbYMZF9NNcSGJqKgLZZo3sp5moxV` |
| reset multiplier 2 → 1 | `4fSHNJ3DZg1CmTHwWzMyzGvHJpa4izZDkjwAqZx9UfKCTZXbUkYxpTWGaB5bWtLQH3oAvZMrmTZSziaoHjKXrT1J` |

## Bugs found and fixed during Phase 1

One real bug, caught by a unit test before it ever reached devnet. The fill
routine originally assumed the clearing price was always one of the book's own
limit prices, splitting orders into "strictly better than p\*" (fill in full)
and "exactly at p\*" (pro-rata). The spec's third tie-break — midpoint of the
tied range — can land *between* two real order prices, where no order sits at
p\* to absorb the remainder, and the "strictly better" bucket alone could then
exceed the executable volume. It was replaced with a general tiered
price-priority fill: best price first, filling whole tiers until the volume is
exhausted, pro-rating only the single marginal tier. Regression test:
`clearing::tests::never_fills_more_than_executable_volume`. The
`strictly_better_orders_fill_first` test now deliberately exercises a
midpoint clearing price (95, between candidates 90 and 100).

11 unit tests pass, including two that assert `Auction::SIZE` and `Order::SIZE`
match actual Borsh-serialized length — a mismatch there would have deployed
fine and then failed at runtime on account writes.

## Mainnet budget — single pass, no redeploy allowance

All figures measured on devnet; rent is size-determined and identical on
mainnet. SOL at ~$100–105 per [phase0.md](phase0.md) Q7.

### (a) Recoverable — rent that comes back

| Account | SOL | How to recover |
|---|---|---|
| Program data account (412,248 bytes) | **2.09509868** | `solana program close` |
| IDL account (5,672 bytes) | **0.02946400** | `anchor idl close` |
| **Total recoverable** | **2.12456268** | |

### (b) Locked rent — real cost with the current program

The program has **no close instruction** for auction, order, or vault accounts.
Their rent is not recoverable today. Per auction:

| Account | SOL |
|---|---|
| Auction account (2,013 bytes) | 0.01087628 |
| Vault ticker ATA, Token-2022 (179 bytes) | 0.00155956 |
| Vault quote ATA, legacy (165 bytes) | 0.00148844 |
| Order account × 4 (103 bytes each) | 0.00469392 |
| **Per 4-order auction** | **0.01861820** |

Adding a `close_auction` instruction that reclaims this once an auction is
`Settled` is the obvious Phase 2 item; it would move ~0.0186 SOL per auction
from this column into the recoverable one.

### (c) Genuinely spent — transaction fees, gone

Measured by reconciliation rather than estimated: the deploy wallet started at
5 SOL and ended at 2.79669604, a total outlay of **2.20330396 SOL**. Summing
the rent actually sitting in every account it funded — program 2.09509868 +
program stub 0.00083312 + IDL 0.02946400 + the two fixture mints 0.00515620 +
four wallet ATAs 0.00609600 + four auction accounts 0.04350512 + eight vault
ATAs 0.01219200 + the seven order accounts it paid for 0.00821436 — gives
2.20055948 in recoverable-or-locked rent. The residual is fees:

**≈ 0.00274 SOL in transaction fees** (≈ $0.29) across the entire devnet
campaign: one program deploy (~410 chunk-write transactions), the IDL write,
the full fixture setup, and all four test auctions — roughly 550 transactions
at the 5,000 lamport base fee, with no priority fee.

For a single mainnet pass the fee component is the deploy (~410 txs) plus one
auction's ~7 transactions, so **~0.0021 SOL (≈ $0.22)**. Priority fees during
congestion are the only thing that would move this materially, which is what
the headroom below is for.

(An attempt to sum `meta.fee` across all transactions directly was abandoned —
the public devnet RPC rate-limited the historical queries. The reconciliation
above is exact on the rent side and therefore accurate on fees to within the
handful of lamports of rounding in the account sums.)

### Recommendation

**Fund the mainnet deploy wallet with 2.30 SOL** (≈ $240), plus whatever AAPLx
and USDC the demo orders need. That is 2.125 recoverable + 0.019 locked +
~0.003 fees + ~0.15 headroom for priority fees during congestion. After the
demo, `solana program close` returns ~2.12 SOL, making the true unrecoverable
cost of the mainnet pass **~0.021 SOL (≈ $2.20)** — the locked account rent
plus fees, nothing more.

The earlier Phase 0 Q7 estimate of ~5 SOL was high on two counts: it assumed
2–3 redeploy iterations (no longer allowed — devnet absorbs iteration now) and
it did not separate recoverable rent from spend, which made a largely
refundable deposit look like a cost.

## What has not been tested

- **Mainnet.** Nothing in this document ran against a real xStocks mint.
- **A settlement batch that needs splitting.** Every auction here settled in one
  call; the ≤18 ceiling is a measurement from Q6, not an executed multi-batch run.
- **The oracle tie-break on-chain.** Every devnet run had
  `reference_price_set=false`. Only unit tests cover the fresh-oracle branch.
- **A live transfer hook.** The fixture, like the real mints, has the extension
  present with `programId: null`. If an issuer ever sets a hook program, every
  transfer gains accounts and the settle-batch ceiling roughly halves (Q6).
- **A full 64-order book.** Largest book tested was 6 orders.
