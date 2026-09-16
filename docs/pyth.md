# Uncross and Pyth

Uncross is a periodic call auction for thin tokenized stocks on Solana. Orders
collect for a few minutes and then all fill at one price, the price at which
the most shares change hands. Pyth has a narrow, deliberate role in that: it can
break a tie between clearing prices the book already supports, and only when
its price passes an on-chain gate. It never sets the price.

This document covers what we measured about Pyth's equity feeds on Solana, how
the gate works, what the auction does when the gate fails, a claim we made and
then retracted, and why a reference price and an executable price are not the
same thing.

## 1. Which feed, verified on-chain

Pyth publishes two AAPL feeds that are easy to confuse:

| Feed | ID | Described as |
|---|---|---|
| `Equity.US.AAPL/USD` | `49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` | Apple Inc / US dollar |
| `Equity.Index.AAPL/USD` | `aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36` | "Pyth price in USD for AAPL 24/7" |

On Solana mainnet, AAPL exists only as a push-oracle `PriceUpdateV2` account
owned by the Pyth receiver program (`rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`).
There is no classic price account. The live one is shard 1,
`D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW`; shard 0 was a month stale.

We did not assume which feed that account carries. We read the account and
took bytes 41–72, the feed ID field in the `PriceUpdateV2` layout:

```
feed_id @41  49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688
```

That is `Equity.US.AAPL/USD`, the regular equity feed, not the 24/7 index
variant. It matters for section 3: continuous publishing from the index variant
would be expected; from the equity feed it was not.

The same feed is bound everywhere: the program stores it per auction, the
keeper passes it when opening auctions, the site reads that account, and the
site's mainnet proxy allows reads of that one account and nothing else.

**IBM has no Pyth price account on Solana**, on any shard. For IBMx the auction
book is the only on-chain price there is.

## 2. `market_hours` is published; a trading status is not

Pyth's documentation says only prices with `status = Trading` should be used.
On Solana that status is not available where a program can read it.

- **On-chain:** `PriceUpdateV2` has no status field. The fields are the feed ID,
  price, confidence, exponent, publish time, previous publish time and EMA
  values. Freshness is the only on-chain signal of a live price.
- **Hermes metadata** (`/v2/price_feeds`, which needs no API key): both AAPL
  feeds carry a `market_hours` object and a schedule string, but no `status`.
  Queried at about 4 AM ET on 16 September, both reported `is_open: false`,
  while the on-chain account's latest print was seconds old.
- **Hermes price endpoints** now return 401 without an API key. The sponsored
  on-chain account needs no key to read.

So the literal gate "status is Trading" cannot be built on Solana. A program
can check that a print is fresh, tight and from the right feed. It cannot
check which market session the print came from.

## 3. The measurement, and a retraction

Our early research said equity feeds stop moving at the 4pm ET close, and we
pitched Uncross partly on "no reference price when Wall Street is closed". We
then measured it.

We read the AAPL account every five minutes from 4:11 PM ET on Tuesday
15 September to 2:49 AM ET on Wednesday 16 September: 10 hours 38 minutes,
80 checks. The raw log is [`data/pyth-aapl-watch-2026-09-15.log`](data/pyth-aapl-watch-2026-09-15.log).

| | |
|---|---|
| Checks | 80, five minutes apart |
| Age of the latest print at each check | 2 s to 14 s |
| Price range | $331.53 to $331.86 |
| Pyth's published schedule for the feed | 09:30–16:00 ET, so closed for the whole window |

At every check the latest print was at most 14 seconds old, and the price kept
moving. Checks were five minutes apart, so this does not prove there was never
a gap between them, only that none was visible at any check. Weekends were not
measured.

**Retracted:** "no reference price overnight." The measurement disproves it,
and the README, the site and the code comments now say so. Earlier versions of
this project said the watch had 82 samples; the log has 80 (two lines of the
82-line output were not samples).

**What holds instead:** the reference keeps printing, but nothing on-chain says
whether a print reflects a liquid regular session or a thin overnight one. A
program reading it at 3 AM gets a fresh, tight price with no way to tell it
from 11 AM.

## 4. The on-chain gate

`read_fresh_price` in [`programs/uncross/src/oracle.rs`](../uncross/programs/uncross/src/oracle.rs)
returns a price only if every one of these holds:

1. The auction was created with a feed ID. An all-zero ID means "no oracle".
2. The account is owned by the Pyth receiver program.
3. The first eight bytes are the `PriceUpdateV2` discriminator,
   `sha256("account:PriceUpdateV2")[..8]`.
4. The verification level is `Full`. `Partial` is rejected, both because only
   fully Wormhole-verified prices should count and because it encodes with an
   extra byte that shifts every later offset.
5. The feed ID in the account equals the feed ID stored in the auction when it
   was created. `compute_clearing` is permissionless, so without this binding
   any caller could pass another asset's price to steer the tie-break.
6. The price is positive.
7. It was published within 90 seconds of the current on-chain time.
8. The confidence interval is no wider than 2% of the price.

A passing price is then converted from per-share to per-raw-token. xStocks use
Token-2022's scaled-UI-amount extension, so one raw token is worth `m` shares,
while limit prices are quoted per raw token. The program reads the mint's
effective multiplier (the scheduled `new_multiplier` once its timestamp has
passed) and multiplies. The result is stored on the auction as
`reference_price`, with `reference_price_set` recording whether the gate
passed.

### What the price is used for

The clearing price is chosen by these rules, in order:

1. the price that trades the most shares;
2. among ties, the one where buying and selling interest is most balanced;
3. among remaining ties, the one nearest a gate-passing Pyth price;
4. otherwise, the midpoint of the tied range.

Pyth only ever picks between prices the book already supports equally well. It
cannot move the clearing price outside that set, add volume, or override the
book.

### What happens when the gate fails

Rule 3 is skipped and rule 4 decides. The auction still clears, at a price the
book supports, and `reference_price_set` is recorded as false. A stale, wide,
wrong-feed or unverified price never reaches the clearing logic.

## 5. What runs where

Uncross runs on Solana devnet, on mints built to be extension-identical to the
real xStocks. That is what let us test what only an issuer can do on mainnet:
pausing the token mid-auction, and changing its multiplier mid-auction.

Pyth's devnet AAPL account is a stale shard 0, more than two months old. So on
devnet the gate is exercised on its failure path on every auction: the keeper
passes the freshest devnet shard, the gate rejects it as stale, and the auction
clears by rule 4. The keeper logs this as `pyth anchor none`.

The passing path is covered by unit tests built from the real mainnet
account's bytes and the real AAPLx mint's bytes:

| Test | Checks |
|---|---|
| `reads_live_aapl_account` | parses the live account to $329.94998 |
| `scales_every_exponent_the_right_way` | exponent handling; this caught a 100× bug |
| `rejects_stale_price` | the 90-second window |
| `rejects_wrong_feed` | the feed binding |
| `rejects_wrong_owner` | the receiver-program check |
| `rejects_no_feed_configured` | an auction with no feed |
| `rejects_wide_confidence` | the 2% confidence cap |
| `converts_per_share_to_per_raw_token` | the unit conversion |
| `reads_live_aaplx_multiplier_either_side_of_its_scheduled_change` | the effective multiplier |
| `aapl_oracle_price_converts_to_aaplx_per_token_units` | the conversion on real bytes |
| `oracle_breaks_price_tie` | rule 3 in the clearing logic |

The site shows Pyth's live mainnet price, read directly from the account through
a same-origin proxy that allows reads of that one account only.

### Bugs this caught before any mainnet use

Each of these would have been silent:

- The first reader only understood the classic Pyth account format, so every
  mainnet auction would have recorded no reference price.
- Exponent scaling was inverted: AAPL read as $3.30 instead of $329.95.
- Prices were compared per share against limits quoted per raw token.
- The specified confidence cap was never implemented, and no feed was bound
  to the auction.

## 6. A reference price is not an executable price

A reference price tells you what an asset is worth. It does not tell you
whether you can trade there. We measured the gap on mainnet, buying with USDC
through Jupiter at 50 bps slippage, at 4:02 AM ET on 16 September. The
reference price in this table is Jupiter's.

| Token | Reference | Buy $100 | Buy $1,000 | Buy $10,000 |
|---|---|---|---|---|
| AAPLx | $330.77 | 0.19% impact | 0.33% | 0.41% |
| NVDAx | $213.53 | 0.09% | 0.15% | 0.24% |
| IBMx | $247.14 | **no route** | **no route** | **no route** |
| XOMx | $165.74 | 2.02% | 2.33% | **no route** |
| JPMx | $346.49 | 2.52% | **no route** | **no route** |

IBMx has a published price and a pool holding $1,666, and the aggregator found
no route at any size we tried, down to $1. "No route" means the aggregator
declined to route that size; a direct pool swap might still fill, at a worse
price. The full capture is committed as
[`site/lib/liquidity-capture.json`](../site/lib/liquidity-capture.json).

This is the case for a call auction. A continuous pool asks each trader to
cross a spread alone. An auction gathers the traders who want a thin name in
the same few minutes and lets them meet each other at one price. A good
reference can guard that price against manipulation, which is the role Pyth
plays here, but it cannot supply the liquidity.

## 7. Not done

- The passing path of the gate has not run on-chain. It needs a fresh Pyth
  price on devnet, which Pyth does not currently publish there.
- Weekend publishing behaviour was not measured.
- Pyth's EMA price and previous publish time are in the account layout; the
  gate does not read them.
