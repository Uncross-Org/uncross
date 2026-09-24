---
title: The on-chain gate
description: The eight conditions a Pyth price must meet before an auction may use it, what happens when it fails, and what is recorded on chain at every cross.
---

At the cross, `compute_clearing` takes one account the sender chooses, meant to be the ticker's Pyth price. The program trusts nothing about it. Before the price can break a tie, it must pass every one of these checks, in this order.

## The eight conditions

1. **The auction was created with a feed ID.** An all-zero ID means "no oracle" for this auction.
2. **The account is owned by the Pyth receiver program** (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`). Anyone can create an account with arbitrary bytes. Only the receiver program can write a real Pyth price.
3. **The first eight bytes are the `PriceUpdateV2` discriminator**, `sha256("account:PriceUpdateV2")[..8]`, and the account is long enough to hold a price.
4. **The verification level is `Full`.** Only fully Wormhole-verified prices count. `Partial` is rejected. It also encodes with an extra byte that would shift every later field.
5. **The feed ID in the account equals the feed ID stored in the auction when it was created.** `compute_clearing` is permissionless, so without this binding any caller could pass another asset's price to steer the tie-break.
6. **The price is positive.**
7. **It was published within 90 seconds** of the current on-chain time.
8. **The confidence interval is no wider than 2% of the price.** A price that uncertain is too loose to break a tie with.

The first failing check decides the verdict. A price passes only if all eight hold.

## When the gate fails

**The auction still clears, from the book alone.** Rule 3 of [the clearing rule](/mechanism/clearing-rule/), nearest the oracle price, is skipped, and a surviving tie goes to the midpoint. `reference_price_set` is recorded as false.

**No other price is substituted.** The program does not fall back to an older price, a stored price, or an average. A stale, wide, wrong-feed or unverified price never reaches the clearing logic.

:::caution[What the sender controls]
The sender of `compute_clearing` chooses which account to pass. Checks 2–5 stop them passing a fake price or another asset's price. They can still pass an account that fails the gate on purpose, which forces the midpoint rule in the one case where the oracle would have broken a tie. See [Honest limitations](/trust/limitations/).
:::

## What is recorded, per auction

Every cross writes the gate's verdict to the auction account, so any cross can be audited afterwards from that account alone:

- `oracle_gate`: a result code (table below);
- `oracle_publish_time`: the publish time of the price the gate examined, once the account had been confirmed as the bound feed. It is 0 if the gate stopped before that.
- `reference_price_set`: 1 if the price passed and was used, 0 otherwise;
- `reference_price`: the passing price, converted to the auction's units (below), or 0.

| Code | Recorded as | Meaning |
|---|---|---|
| 0 | not recorded | The auction crossed before this field existed (before 16 Sept) |
| 1 | passed | All eight conditions held |
| 2 | no feed configured | Condition 1: the auction has no feed |
| 3 | wrong owner | Condition 2 |
| 4 | not a price update | Condition 3 |
| 5 | not fully verified | Condition 4 |
| 6 | wrong feed | Condition 5 |
| 7 | bad price | Condition 6, or the fields could not be read |
| 8 | stale | Condition 7 |
| 9 | confidence too wide | Condition 8 |
| 10 | multiplier unreadable | The price passed, but the mint's multiplier could not be read to convert it, so it was not used |

The app shows the latest recorded verdict on each ticker's page as **Last check**.

## Converting the price to the auction's units

Pyth quotes a price **per share**. Limit prices in the program are quoted **per raw token**, and under the scaled-UI-amount extension one raw token is worth *m* shares ([Raw amounts and splits](/tokens/raw-amounts/)). So a passing price is multiplied by the mint's **effective** multiplier before it is compared with any limit. That is the scheduled new multiplier once its effective time has passed, and the current one before. The result is stored as `reference_price`, in the same units as `clearing_price`.

## Bugs this caught before any mainnet use

Each of these would have been silent:

- The first reader understood only the classic Pyth account format. On mainnet AAPL exists only as `PriceUpdateV2`, so every mainnet auction would have recorded no reference price.
- Exponent scaling was inverted: AAPL read as $3.30 instead of $329.95.
- Prices were compared per share against limits quoted per raw token.
- The specified confidence cap was never implemented, and no feed was bound to the auction.

## Tests

The passing path has not run on chain, because Pyth publishes no fresh price on devnet ([What Pyth is used for](/pyth/role/#what-actually-happens-on-devnet)). It is covered by unit tests built from the real mainnet AAPL account's bytes and the real AAPLx mint's bytes:

| Test | Checks |
|---|---|
| `reads_live_aapl_account` | parses the live account to $329.94998 |
| `scales_every_exponent_the_right_way` | exponent handling; this caught the 100× bug |
| `rejects_stale_price` | the 90-second window |
| `rejects_wrong_feed` | the feed binding |
| `rejects_wrong_owner` | the receiver-program check |
| `rejects_no_feed_configured` | an auction with no feed |
| `rejects_wide_confidence` | the 2% confidence cap |
| `converts_per_share_to_per_raw_token` | the unit conversion |
| `reads_live_aaplx_multiplier_either_side_of_its_scheduled_change` | the effective multiplier |
| `aapl_oracle_price_converts_to_aaplx_per_token_units` | the conversion on real bytes |
| `records_why_the_gate_refused` | the recorded verdict for every refusal path |
| `oracle_breaks_price_tie` | rule 3 in the clearing logic |

Run with `cargo test -p uncross` on 24 Sept 2026 against the program at commit `532dcb7`: 25 passed, 0 failed. That is the 24 tests in the program's source plus Anchor's generated program-ID test.

## Not read

Pyth's EMA price and previous publish time are in the account layout. The gate does not read them.

<p class="sources">Sources: <a href="https://github.com/Uncross-Org/uncross/blob/532dcb736e8aa2c811e8b4704a8f36ec0c0f0a73/uncross/programs/uncross/src/oracle.rs"><code>oracle.rs</code></a> (<code>check_price</code>, <code>GATE_*</code>, <code>effective_multiplier</code>, tests), <a href="https://github.com/Uncross-Org/uncross/blob/532dcb736e8aa2c811e8b4704a8f36ec0c0f0a73/uncross/programs/uncross/src/lib.rs#L214-L262"><code>lib.rs</code> compute_clearing</a>, <code>docs/pyth.md</code> §4–5, <code>docs/phase2.md</code>.</p>
