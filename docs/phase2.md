# Phase 2 — hardening, PreStocks, mainnet, frontend

Working log for Phase 2. Devnet program ID (unchanged, same keypair will be used
on mainnet): `Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP`.

## Summary

| Task | Status |
|---|---|
| 1. Multi-batch settlement on devnet | Surfaced three conservation bugs and a wrong batch limit; all fixed. Multi-batch run: see below |
| 2. PreStocks verification | **Dropped** — every PreStocks mint charges an active 50 bps transfer fee |
| 3. Mainnet deploy | Awaiting funding |
| 4. Frontend | Deployed to Vercel production (`uncross.0xo.in` alias; DNS record pending). Devnet keeper + order activity running |
| 5. README | Drafted (`README.md`); live URL and final untested list to confirm after mainnet |
| 6. Friday demo | Timing conflict flagged: the deadline is the market close |

Task 1 was meant to be an hour of confirming the crank loop works. It turned
into the most important correctness work of the project, because the Phase 1
tests had only ever exercised books whose numbers happened to divide evenly.

## Task 1 — what the multi-batch work found

### Bug 1: the two sides could fill to different totals (fixed)

Pro-rating the marginal price tier used floor division per order. With 22 buy
orders of 10 sharing 200 units, each got floor(10 × 200/220) = 9, so the buy
side filled **198** against the sell side's **200**. Sellers would be paid for
200 shares that buyers only paid for 198 of: the quote vault goes short, the
last seller payout in a batch fails, and 2 shares strand in the ticker vault.
Phase 1 never hit it because every pro-rata tier there divided exactly.

Fix: the flooring remainder in the marginal tier is handed back one unit per
order, lowest index first, so each side fills to exactly the executable
volume. Test: `clearing::tests::both_sides_fill_to_the_same_total`.

### Bug 2: per-order rounding could leave the quote vault short (fixed)

Even with equal fill totals, rounding each order's quote leg separately can
break conservation — two buyers each owing 0.5 units floor to 0 against a seller
owed 1. Fix, in two parts:

- Buy escrow now rounds **up** (`clearing::escrow_for_buy`), so escrow always
  covers what a buyer can owe.
- Every order's quote leg is decided **once, in `compute_clearing`**, and stored
  (`OrderSummary.quote_amount`). Sellers get floor(fill × p\*); buyers are
  charged exactly that total between them, split by fill and capped at escrow.
  Settlement just moves pre-decided numbers, so totals balance to the unit
  regardless of batch order.

Tests: `per_order_floor_cannot_starve_the_seller`,
`realistic_book_balances_at_a_non_round_price`.

### Bug 3: refund after partial settlement could double-spend the vault (fixed)

`cancel_and_refund` could run after some orders had already been clear-settled.
A seller whose shares went to a buyer in one batch could then be refunded their
full escrow in the next — from a vault that no longer holds those shares. Fix:
an auction commits to one wind-down path on its first batch (`settle_path`:
clear or refund) and the other is rejected thereafter with
`SettlementPathLocked`. Each path conserves on its own; mixing them does not.
The pause trap is unaffected: if the mint is paused before any clear batch, the
whole auction winds down on the refund path.

### The batch limit was 7, not 18

Phase 0 Q6 measured ~18–19 transfers per transaction, each adding **one** new
account. `settle_batch` actually adds **three** per order — the order PDA and
the owner's two ATAs. Measured on the real instruction (v0 message, compute
budget instructions included, one signer):

| Orders per batch | Distinct owners | Two repeating owners |
|---|---|---|
| 6 | 1,073 bytes | 817 |
| 7 | **1,174** | 854 |
| 8 | 1,275 — over 1,232 | 891 |
| 12 | over | 1,039 |
| 18 | over | 1,261 — over |

So a crank settles **7 orders per transaction** when every order has a
different owner, and even with only two owners 18 never fit. A full 64-order
book needs 10 crank calls, not 4. The program's `MAX_BATCH` is now 12 — a
compute bound, not the transaction limit, which the crank has to respect itself.
Address lookup tables would compress each account to one byte and lift this;
they remain out of scope.

Compute is nowhere near binding: on the upgraded program `place_order` costs
22–32k CU, `compute_clearing` 16.6k, and a 6-order `settle_batch` 75k
(~12.5k per order).

### Stack overflow from the bigger account (fixed)

Adding `quote_amount` and the feed binding grew the Auction account to ~2.9 KB,
and Anchor deserializes a normal account onto the 4 KB BPF stack even when it
is `Box`ed — `PlaceOrder` and `CancelOrder` overflowed by 288 and 424 bytes.
The Auction is now a **zero-copy** account (`AccountLoader`, repr(C), explicit
padding), which is never copied onto the stack. `Order` stays Borsh.

## Oracle findings (affect task 6)

### The program could never have read a real Pyth price

On Solana mainnet, AAPL exists **only** as a Pyth push-oracle `PriceUpdateV2`
account owned by the receiver program `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`
— there is no classic price account. The Phase 1 reader only accepted the
classic format, so every mainnet auction would silently have recorded
`reference_price: None`. The reader now parses `PriceUpdateV2`, verified byte
for byte against the live account (discriminator = sha256("account:PriceUpdateV2")).

| Feed | Account | State |
|---|---|---|
| Equity.US.AAPL/USD, shard 1 | `D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW` | live, updates every ~10–20s |
| Equity.US.AAPL/USD, shard 0 | `DJ2FyTgUAkEtXW3U5P9PF19meFTRtW4ZWKKFgACfVbUy` | a month stale |
| Equity.US.IBM/USD, shards 0–5 | — | **no account exists on Solana** |
| AAPL on devnet | shard 0 only | 75 days stale — no live feed on devnet |

The Hermes `latest` price endpoint now returns 401 without an API key, but no
key is needed: the sponsored shard-1 account is fresh on-chain during market
hours, and the metadata endpoint (market schedule) is still open.

**IBM has no on-chain Pyth price on Solana at all.** For IBMx, the auction book
is the only on-chain price — the product's thesis, verified on a real ticker.

### Three oracle bugs, all fixed before touching mainnet

1. **Exponent scaling was inverted.** `scale_to_1e6` shifted the wrong way:
   AAPL read as $3.30 instead of $329.95, 100× off. The same code was in the
   Phase 1 reader; no devnet run ever had a live oracle, so nothing caught it.
   On mainnet the tie-break would have compared every candidate against $3.30
   and always chosen the lowest. Caught by a unit test built from real account
   bytes (`scales_every_exponent_the_right_way`).
2. **Per-share vs per-token units.** xStocks carry a scaled-UI multiplier: one
   raw AAPLx token is worth 1.0033 AAPL shares, one IBMx token 1.0204 IBM shares.
   Pyth quotes per share; limit prices are per raw token. `compute_clearing` now
   reads the ticker mint's *effective* multiplier (the scheduled
   `newMultiplier` once its timestamp has passed — for AAPLx today that is
   1.0033, not the stale-looking `multiplier` field 1.0027) and converts before
   comparing. `reference_price` is stored per raw token, the same units as
   `clearing_price`. Tested against the real AAPLx mint bytes.
3. **The spec'd confidence cap was never implemented**, and **no feed was bound
   to the auction**, so a permissionless `compute_clearing` caller could pass
   another asset's price to steer the tie-break. Now: conf/price ≤ 2%, and each
   auction stores its `pyth_feed_id` at creation; any other feed is ignored.

### Pyth keeps publishing after the close — decision needed

Polled through the 16:00 ET close on Tue 15 Sept: the AAPL account **did not
stop**. It kept publishing every 3–14s, price still moving, at least to 16:11 ET
(Hermes' own schedule says 09:30–16:00). These look like extended-hours prices.

Two consequences:

- `PriceUpdateV2` has **no trading-status field**, so the spec's
  `status == Trading` gate cannot be implemented literally; freshness is the
  only on-chain signal. The program therefore **will** anchor to post-market
  prints if they are fresh and tight. Restricting to regular hours on-chain would
  mean hard-coding the NYSE calendar, DST and holidays into the program —
  fragile, and not done. *This is a decision for you:* accept extended-hours
  prints as a reference (current behaviour), or ask for the calendar check.
- The pitch "no reference price when Wall Street is closed" holds overnight and
  at weekends, but possibly not 16:00–20:00 ET. When the feed actually goes
  stale is being measured.

  > **Measured result (later):** it did not go stale overnight either. Checked
  > every five minutes from 16:11 to 02:49 ET, the latest print was never more
  > than 14 seconds old. The overnight claim is retracted; see
  > [docs/pyth.md](pyth.md).

### Task 6 timing conflict

Submission closes **Fri 18 Sept 16:00 ET — which is the market close.** A
"run one after the close" clip recorded Friday would land after the deadline.
The frozen-path clip should be recorded on an earlier night, once the overnight
staleness window is confirmed.

## Task 2 — PreStocks: dropped

Pulled `prestocks.com/api/prestocks` (8 tokens) and read three mints live off
mainnet, the same way Q1 did.

| Token | Mint | Liquidity (Jupiter) | 24h volume |
|---|---|---|---|
| ANTHROPIC | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | $679,420 | $1,658,503 |
| OPENAI | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | $720,296 | $1,396,998 |
| SPACEX | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | $108,950 | $5,437 |

All three: Token-2022, 9 decimals, `defaultAccountState = initialized`,
permanent delegate, transfer hook present with `programId: null`, pausable (not
paused), scaled-UI multiplier, confidential transfers — and **`transferFeeConfig`
at 50 bps**, with `confidentialTransferFeeConfig`. The newer fee took effect at
epoch 1032; mainnet is at epoch 1035, and every mint shows a nonzero
`withheldAmount`, so it is being charged now.

A program-owned PDA **can** hold them — `CreateAssociatedTokenAccount` for a PDA
simulated successfully against all three. Custody is not the problem.

**Why it is dropped:** a transfer fee is an extension the program does not
handle. A seller escrowing 10 tokens delivers 9.95 to the vault while the
program records 10, and every outbound transfer withholds another 0.5%, so
settlement goes insolvent on the ticker side. Per the brief, the program was not
extended to accommodate it. (Anthropic would have been the pick.)

Side observation that validates the Phase 1 multiplier trap: SPACEX has a
scheduled 5× multiplier (effective June 2026 — a 5:1 split) and OPENAI a
1.486× one. Issuers do use this mechanism on live mints.

## IBMx — verified in

Read live the same way: Token-2022, 8 decimals, the **identical** extension set
to AAPLx (no transfer fee), and PDA-ATA creation simulates successfully. A devnet
fixture replicating it was created at `9aGoR5JbatqRYbc4SpQuT3pWVLPhZQJvDq26FFb23Jzp`
with the live multiplier (1.015340763856885), so the frontend's per-share
conversion is exercised on devnet.

## Regression on the upgraded program

The Phase 1 definition-of-done run, repeated on the zero-copy program: clearing
at 247.50 × 10 shares, identical fills, cancel before freeze succeeds, cancel in
the freeze window rejected (`PastFreezeWindow`), second `compute_clearing` a
2.2k-CU no-op, all six orders settled in one batch, both vaults exactly zero.

| Step | Signature |
|---|---|
| initialize_auction | `3bkfFfn9jtoxL7pGE3oHh18jRfz6KrPqrEXMnmij4eU6b3QKRzcPnkp7Ukd2L77JzjTinYZmkm8hzxy2vRD4EZBJ` |
| compute_clearing | `4xEomFanmDX8fwhSdoXZ74jMNiDqw1bkYVDZzhx6reL2RdtspFN3yefP7Kn6kGCrgLMtqavPDt1iHNby85X3Ve1T` |
| settle_batch [0..5] | `4bJG1KMZx3gvAEReQBeXxmHpAWE8L2rvDuiJdbqf5obBXr8sQRXun4jD8CGxJPimEKV6Z5UYyfghR5Mr1BnU8jCv` |

Devnet upgrade: `2Q14KghFp6tjjuAxXsT1BCtm5jPJmRoA7XFftsw56AJikPf73fvcGvdEgdrw2S826MSVo2Xm1w2kYNXKMciKRmCW`
(program data extended by 40 KB of headroom first).

Unit tests: 24, all passing — including real mainnet bytes for the AAPL price
account and the AAPLx mint.

### Pause and multiplier traps, re-run on the upgraded program

Both re-run on the **IBMx fixture** (so they could run alongside the AAPLx
multi-batch test, and because IBMx starts at a real non-1 multiplier).

**Pause — passes.** Auction cleared at 205.00 × 4, mint paused, then
`settle_batch` failed atomically — Token-2022 `0x43`, "Transferring, minting,
and burning is paused on this mint". Status stayed `cleared`, `settled 0/2`,
every balance and both vaults unchanged — and `settle_path` stayed `none`: the
failed transaction rolled back its own path write, so a failed settlement
attempt does not lock the auction into the clear path. The quote-side refund
went through while still paused; after resume, a clear-settle attempt was
rejected with `SettlementPathLocked` (the new guard, working as intended), the
sell side was refunded, auction `settled 2/2` on the refund path, both vaults
exactly zero.

**Multiplier — passes.** SELL 6 @ 100 and BUY 6 @ 120 placed at m = 1.0153;
multiplier then changed to **2** before clearing. Cleared at 110.00 × 6 exactly
as predicted beforehand. Raw deltas: seller +660,000,000 quote, buyer
+600,000,000 ticker and +60,000,000 quote refund (escrow 720,000,000 −
charge 660,000,000); both vaults zero. Multiplier reset to 1.015340763856885
afterwards.

| Step | Signature |
|---|---|
| pause: settle_batch while paused | rejected — `0x43`, nothing landed |
| pause: cancel_and_refund [1] while paused | `4DNRgi4M1aXGQd7GajCDk3XrVEoznDRu5kqUojdhL5Ek1A2mTpG3DZaXoDCHBjYMTdtE8oQ4YFfAar2CZBBPGxbZ` |
| pause: settle_batch after refunds began | rejected — `SettlementPathLocked` (6019) |
| pause: cancel_and_refund [0] after resume | `2r9ANErSqUQUzQLSQwwbrJvwDwZXkGr6uwCeFUkh4QdWWh6ew9JJc4gVEBixbD1RfGkHmZ4ztQ5LDY9GNpP1eNB7` |
| multiplier: set 1.0153 → 2 | `uWkV19hzfH1kcjHxwBKTUNqvCHs7SnHo7B46BdZDEMALSDsLUZoN9qbgAdQhLjBUqsY7SZg4hvQJGjvnWEaZm4v` |
| multiplier: compute_clearing | `5H6bFXTHyaBveTcNoQdzVWRF6kTbpCy5ejjTzBgVxZDendpfR6GeZdmGNVrKJ67cJ4yZHkS8RGjUfdDKTg9n2hp9` |
| multiplier: settle_batch [0,1] | `5bmP3jkqpcujvMMPrU5aqCivJudXQwxy6Hffn8M7jgZVKqVfFSHpfPkcm7rvHRGyW7ETCPyYscSeidALh85wbvMa` |

### Public devnet RPC is a real constraint

The first multi-batch attempt crashed on rate limits (HTTP 429), and not in a
way ordinary retries fix: web3.js's `confirmTransaction` races a websocket
against its own polling, and on a throttled RPC one side can reject *after* the
other resolved — an unhandled rejection that kills the process mid-run. The
scripts now confirm by polling `getSignatureStatuses` over plain HTTP, batch
reads with `getMultipleAccountsInfo`, and back off on every call. The keeper
uses the same path. The same failure would hit a mainnet crank on a public RPC,
so a keyed RPC is worth having for the demo.

## Multi-batch run

### The keeper cranked a real 38-order, 38-owner book to completion

The first multi-batch attempt died after 38 orders were placed (the RPC crash
above), leaving a live auction `9uBAAY4gFtD9kG9EPYb8oU9wExRdkGRKmejqERk4r74V`
with escrow from 38 distinct owners. Rather than abandon it, the keeper
(`scripts/keeper.mjs --no-open`) was pointed at it — the first time the
production crank path ran on a book that needs several transactions.

It cleared at 100.37 × 190 shares, then settled in six 7-order batches
(7, 7, 7, 7, 7, 3 — the transaction-size limit measured above). Final state:
`settled 38/38`, both vaults exactly **0**.

| Step | Signature |
|---|---|
| compute_clearing | `3PqGDbUVEeTUrs1fmMDuRUjVun69A7pZJBi56rAvzbNHq2H7WNXaAoeaoA83YDqey8gjTYwojAJCMGy3mxuubbVP` |
| settle [0–6] | `2zSMaAAc5X5jzkKNUuAuLwbfQMR6j8JR1WYbf6xahGNGVZ53MtPsNRbgShPvBmQhbKv2Dmg6ymeGticY6CxUtzWh` |
| settle [7–13] | `3gsdcCkovRwJo95xHomt4azqxhv8MBjAuAwfMa6hjSoaULHr5SDk4amXQedzcys9QwJ9zzj8dNTdakfwD1GxzbCC` |
| settle [14–20] | `4GW28JuCAnCqQiJycMEc1RvXHz4MGW5WNnqNBWp76HX7xvCu3w9wHxpMx3j2cVKm4gdYbKX5vmK49vAs5WjqJ5BK` |
| settle [21–27] | `wHEm3NBswDCHPtiaDeNfByPHaUCKtTV95jkzJebMHLYAAp6JNSKsuLqqsXEESiFZyYo7NGMbSCdcKowCEbE2wGR` |
| settle [28–34] | `5rYzSPJ71eubroNSAmMWhnDQDJWiry6WUBm8xy1L2vW1Gsjmbo4PDzASAG7nYxDEJxBknc1oezEi8MLDmsTXVBor` |
| settle [35–37] | `5jx9PE94CGRm1tBLYFWnzM8JiTX1z754c7QNLRFGEjcsQLPNcTmGwSTBotM9biLLfsj94fouXNGLfpXiBsv7fcn2` |

This settled in order and never exercised a pro-rata tier (the book happened to
clear with every buy filled in full), so it is not the stress test. That run —
out-of-order batches, a duplicate, an overlap, and a pro-rata tier spanning
every batch — is below.

### Stress run — passes

Auction `C8pGy4va4btnEQTMbbptnwiFNxnoH2d9md5tSuMff3Mb`: **42 orders from 42
distinct owners** (22 buys of 10 @ 100.37, interleaved with 18 sells of 10 @
90.00 and 2 sells of 10 @ 100.37), settled in 7-order batches.

**Clearing: 100.37 × 200 shares.** The 22 buys form one tier of 220 shares
competing for 200, so every buy is pro-rated — and because the buys sit at
even indices across the whole book, **the pro-rata tier spans every batch
boundary**. Fills and quote legs, as `compute_clearing` fixed them:

- Buy fills: 909,090,910 for #0 and #2, 909,090,909 for the other 20 — the two
  leftover units from floor division go to the lowest indices. Buy total
  20,000,000,000 = sell total 20,000,000,000.
- Buy charges: 912,454,547 / 546 / 545 by the same rule. Buyers charged
  20,074,000,000 = sellers paid 20,074,000,000, exactly.

Settlement was deliberately submitted out of order and abused:

| Step | Result |
|---|---|
| Batch #3 [21–27] first | `settled 7/42`, status stays `cleared`, path locks to `clear` |
| Batch #3 again | Lands as a no-op: settled count and both vaults byte-identical (33k CU of skipped orders) |
| `compute_clearing` mid-settlement | No-op: clearing price, every fill and every quote amount unchanged |
| `cancel_and_refund` [0–6] | Rejected, `SettlementPathLocked` |
| Overlap [25–31]: 3 settled + 4 not | Settles exactly the 4 new orders (`11/42`) |
| Batches #5, #4, #2, #1, #0 | `18 → 21 → 28 → 35 → 42/42`, status `settled` |

**Final: both vaults exactly zero, and all 42 owners' balance changes match
their fill and quote amount to the unit** (buyers: +fill shares, −charge;
sellers: −fill shares, +proceeds; each measured against a snapshot taken
before the auction opened).

Every settle transaction was 1,162 bytes (limit 1,232) and used 70k–129k CU.
The indicative price moved as the book filled — 100.37 with no cross, 95.185
once the first sell arrived, back to 100.37 once the buy side outgrew the
sells at 90 — and the final indicative matched `compute_clearing`.

| Step | Signature |
|---|---|
| initialize_auction | `3ckf99Ax8WpxHCpiuxSKKHHvcL2ewsDdtnzTf9h5qQXL8yjSnwj1hEwZktWGU7efobn2iXhSSHsu2zaPQGFJp5ci` |
| compute_clearing | `2gzwsuTp7HT6Tf46RJYf7qCzdetEkRu8iDqxWDiTnUexZbvtKiniUjGwyxcewfQw5CGDqUij9yFMTtxSwHFnXwrN` |
| settle #3 [21–27] | `5Ty7nfDDwdxFZhBZMFbNJyUkpVJiKZGVtqK38aerfbDo5Cz1ZJTuEV2nEE3hQHxsY6bVXi1QDz1gur7k5TVYrggX` |
| settle #3 again (no-op) | `3zCC9tLiUVkj9C635ZmJ2EwPwmebMsPdxWaG7k1U8DT4XX7EGC6n41r4qcaqLYQNMmyqQTdZYAZvY5eip1H4tnzX` |
| compute_clearing mid-settlement (no-op) | `2YhJpaFX5pGtrnfWE1XsoRjDndftFtzN5HkhGj4SkKEgzvqk8B9jexqSuGFufu1bWU7APhZqYAdAMsJLnkXobbA5` |
| settle overlap [25–31] | `M4JDaNjecaAXHtnrezaQG9YEK4kpR7686wh8i1aJbtb2DBsCFXhLxnxKBsk3LXxRbs8oVockPQHVGxb1Xcmu6Tp` |
| settle #5 [35–41] | `5unU2SE8wrMVDNabfR8jFuHToNGcE2EpRTNGu4XGEeLDUizrTgdZE6cjdxT2HdYy8Cgo3ZkxargVr2aZMNoqZkqV` |
| settle #4 [28–34] | `tVXozm3qgRLMSTZNkSD1KqqYuwKsxwSAzxU6iVXRRWxbYiubjfq1qsxZXs5VvQ9mYPK43Hyg5spH5kQ9Y4jEBQi` |
| settle #2 [14–20] | `3QLGU1WooLt4eT4bGHK6kjiopQkXA4VQNcyCX5FJDTjCbpwst6g5hgtdtTzFZeUGbL8nTKj3qBgiymhX5MuAFALv` |
| settle #1 [7–13] | `4ggsfkUkxKjbczJRBL9ZkTRD3M28P83N9ipj63poiPLozjRekKhUvKePBBZgEe9DzB1pDndxkvt5efyg68fxp1rY` |
| settle #0 [0–6] | `JPyVhrxUBBsrqb5nerVtgAzxJu1MDKjgMgmwdsFpdpNu6tcz16G4UTFzq5dtdd2b2xgwM63wHinGDryxTEA9u4a` |

The 42 order signatures are in `uncross/scripts/devnet-multibatch.mjs`'s run
log; placement is reproducible with that script.

### The web app's own transaction code, driven end to end

`web/scripts/wallet-flow.ts` runs the functions the UI calls on click
(`placeOrderIxs`, `cancelOrderIx`, `computeClearingIx`, `settleIx`, `sendIxs`,
`sendMany`) against devnet, with local keypairs standing in for a browser
wallet, on the IBMx fixture (multiplier 1.0153, so every price and quantity
goes through the per-share conversion). Sell 3 @ $100/share, buy 3 @ $110,
buy 1 @ $50 then cancelled. Indicative $105.00 × 3.0000 shares after the
second order; cleared at **$105.00/share × 3.0000 shares**; settled 3/3; both
vaults zero. It also confirmed the app's ATA handling: each place-order
transaction creates the Token-2022 ticker ATA and the legacy USDC ATA
idempotently.

| Step | Signature |
|---|---|
| sell 3 @ $100 | `2uFQVk7BnJJkpPSwuGDuxUZZUtt5pXS8BcSfK7uGVVsBfTBhSzK3VqwehuPwFaxq9E29rXb6CfL9WSPjGEKLApDV` |
| buy 3 @ $110 | `2KGpK3rDfFZeh2krRdAmahrw2geQMeEKxQVPRENtaU3u1eTSHm6jetXXXbq67D8jds6giDyzoy8zcY5SSgf4mSx2` |
| buy 1 @ $50 | `2NAPv3cnPBg4xEyaGzR6MVttJ95ZtmcCipX18forw36o1gekguJ6tvRT1NBaiKwJ4fd1Ddatqp3h95Z6jfR5vgeZ` |
| cancel #2 | `2voYdJUaiuUytMvajGKdFZ9iYtmGzyt4yUi5GzpYBeDKvbPjTfqVeRFkpJsCFtuAzYdxjSDJfBkaUNcZ2B9hZaNY` |
| compute_clearing | `22AZrNnWM49asDum4YY5vbfkKw4RmEeuj9dM2jUXtBDmem66ydpzig8QJpQp7hP1mNiqF8C9cXc7EMtJx2k1QUmA` |
| settle | `2jCyg2YV9MYtB3kZNreGwHDcMz2Vk9oJJNSz5ENkMrb1KkLXb3Wdo3UTzuKkN1oxRuz6NT3n8z7aPdaw3z28ZeM4` |

Still not exercised: a real browser wallet (Phantom/Solflare/Backpack) signing.

### Bug: empty auctions never finished (fixed)

`compute_clearing` always left an auction `cleared`, and only settlement moved
it to `settled`. An auction with no orders — or whose orders were all
cancelled — has nothing to settle, so it stayed `cleared` forever, and the
keeper and the UI both kept treating it as unfinished. Caught by the UI showing
"An auction is waiting to be finished · 0 orders · 0 to settle". Now
`compute_clearing` marks it `settled` when nothing is left to settle.

### Task 1 checklist

| Requirement | Result |
|---|---|
| Book with >36 orders across both sides, settled in batches | 42 orders, 22 buy / 20 sell, 6 batches plus an overlap |
| Partial settlement leaves state consistent and re-entrant | Status `cleared` with an exact running count after every batch; `compute_clearing` mid-settlement is a no-op |
| Batches idempotent and order-independent | Middle batch first, then descending; overlap settles only new orders |
| A batch submitted twice doesn't double-pay | Duplicate lands as a no-op; vaults unchanged |
| Both vaults end at exactly zero | Yes — and every owner's delta matches to the unit |
| Pro-rata at p\* correct across a batch boundary | Yes — all 22 pro-rated buys, spread across all batches |

### Re-verified 24 Sept 2026: PreStocks and Tessera, both still out

Read live off mainnet (epoch 1041) with `uncross/scripts/read-mints.mjs`.

- **PreStocks, all 8 mints** (from `prestocks.com/api/prestocks`): the transfer
  fee is now **100 bps**, raised from 50 bps at epoch 1039, uncapped, and being
  withheld. Everything else would work: 9 decimals, Token-2022 with ten
  extensions, the transfer hook disabled (`programId: null`), new accounts start
  `initialized`, not paused, and a PDA-owned token account simulates fine.
- **Tessera, the three verified mints** tOpenAI `oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ`,
  tKalshi `TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ` and tSpaceX
  `TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v` (Jupiter's `tessera` tag, issuer
  tessera.pe): Token-2022 with only a transfer fee and metadata. The fee is
  **20 bps**, active since epochs 918–987, uncapped. 9 decimals, and a PDA-owned
  token account simulates fine.

Both fail on the transfer fee alone. A fee makes the vault receive less than
the program records, so settlement cannot balance. The program is not extended
for it. Both also use 9 decimals, where the dashboard's unit conversion assumes
xStocks' 8, which would be a second change.
