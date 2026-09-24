---
title: "After the close: a retraction"
description: We said the reference price disappears after the 4pm ET close. We measured it, and it does not. The claim is retracted.
---

## What we claimed

Our early research said Pyth's equity feeds stop moving at the 4pm ET close. We pitched Uncross partly on that: "no reference price when Wall Street is closed". The idea was that overnight, a call auction would be the only price there was.

**That claim is retracted.** We measured it, and the measurement disproves it.

## What we measured

We read the mainnet AAPL price account every five minutes, from **4:11 PM ET on Tuesday 15 September to 2:49 AM ET on Wednesday 16 September**. That is 10 hours 38 minutes, 80 checks.

| | |
|---|---|
| Checks | 80, five minutes apart |
| Age of the latest print at each check | 2 s to 14 s |
| Price range | $331.53 to $331.86 |
| Pyth's published schedule for the feed | 09:30–16:00 ET, so closed for the whole window |

At every check the latest print was at most 14 seconds old, and the price kept moving. Pyth's own schedule called the market closed the entire time.

The feed polled was `Equity.US.AAPL/USD` (`49f6b65c…`), the one the program and the app bind to. It was not the `Equity.Index.AAPL/USD` feed, which is described as 24/7 and would be expected to keep publishing. The feed was checked from the account's bytes ([What Pyth is used for](/pyth/role/#which-feed)).

The raw log is committed as `docs/data/pyth-aapl-watch-2026-09-15.log`.

## Limits of the measurement

- Checks were five minutes apart. This shows no gap was visible at any check, not that there was never a gap between them.
- **Weekends were not measured.**
- One feed, one night.

Earlier versions of this project said the watch had 82 samples. The log has 80. Two lines of the 82-line output were not samples.

## What holds instead

The reference keeps printing, but **nothing on chain says whether a print reflects a liquid regular session or a thin overnight one.** Pyth's documentation says only prices with status `Trading` should be used. On Solana, that status is not available where a program can read it:

- **On chain,** a `PriceUpdateV2` account has no status field. Its fields are the feed ID, price, confidence, exponent, publish time, previous publish time and EMA values. Freshness is the only on-chain signal of a live price.
- **Off chain,** Pyth's Hermes metadata endpoint carries a market-hours object and schedule, but no status. Queried at about 4 AM ET on 16 Sept, both AAPL feeds reported `is_open: false` while the on-chain print was seconds old.

So the literal gate "status is Trading" cannot be built on Solana. A program can check that a print is fresh, tight and from the right feed. It cannot check which market session the print came from. A program reading the account at 3 AM gets a fresh, tight price with no way to tell it from 11 AM.

Restricting the gate to regular hours would mean hard-coding the NYSE calendar, daylight saving and holidays into the program. That was judged fragile and not done. The program therefore **will** use an extended-hours print as a tie-break if it is fresh and tight.

## Why it still argues for a book

The narrower, true finding is still an argument for pricing thin names from a book. A reference that looks identical at 3 AM and at 11 AM cannot tell you whether anyone could trade at it. An auction's clearing price is a price people did trade at.

The README, the site and the code comments were corrected when the measurement came in.

<p class="sources">Sources: <code>docs/pyth.md</code> §2–3, <code>docs/data/pyth-aapl-watch-2026-09-15.log</code>, <code>docs/phase2.md</code> (Pyth keeps publishing after the close), <code>uncross/programs/uncross/src/oracle.rs</code> (comment on <code>check_price</code>).</p>
