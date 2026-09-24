# Where every number on the dashboard comes from

Every figure the dashboard shows, with its source, how it is computed and how
often it refreshes. The rule the dashboard follows: never show a value whose
meaning can't be explained in one sentence. Written 24 Sept 2026 against the
code at the commit that adds this file.

Two sources feed the top of a ticker's page, and the page keeps them apart:

- **This auction** is produced by Uncross, from the orders in the book, on
  devnet.
- **External reference** is Pyth. It is the only number that comes from outside
  Uncross.

## This auction

| Shown as | Source | How it is computed | Refresh |
|---|---|---|---|
| **Would clear at** (before the cross) | `indicative_price` on the auction account | Written by the program on every `place_order` and `cancel_order`: the clearing rule (below) run over the live orders with no oracle price | The auction account: a websocket subscription, plus a poll every 8s (every 4s where the endpoint has no websocket) |
| **N shares would trade if the auction crossed now** | `indicative_volume` on the auction account | The volume at that price: min(demand, supply). Converted from raw units to shares with the mint's scaled-UI multiplier | As above |
| **Cleared at**, **N shares traded** (after the cross) | `clearing_price`, `executable_volume` | Written once by `compute_clearing`, the same rule run with the Pyth price passed in | As above |
| **Best bid** | The auction account's per-order records | In the browser: the highest limit among live buy orders (active, not cancelled) | As above |
| **Best ask** | The auction account's per-order records | In the browser: the lowest limit among live sell orders | As above |
| **Crosses in** | `close_slot` and `freeze_slots` on the auction account; the current slot | (close slot − current slot) × measured slot time. The slot is read every 12s and counted forward between reads; the slot time comes from `getRecentPerformanceSamples` every 2 minutes (about 0.166s on devnet) | Every second, estimated |
| **Orders can be cancelled for …** | As above | (close slot − freeze slots − current slot) × slot time | Every second, estimated |

**The clearing rule** (`programs/uncross/src/clearing.rs`):
1. Over every live order's limit price, take the price that maximises the
   volume traded, min(demand, supply).
2. On a tie, take the price where demand and supply are closest.
3. If still tied and a fresh Pyth price passed the program's check, take the
   price nearest to Pyth.
4. Otherwise take the midpoint of the tied range.

Before the cross no oracle price is passed, so step 3 never applies to "would
clear at". If a tie survives step 2, the final price can differ from the last
"would clear at". On devnet the Pyth check usually fails as stale, so in
practice the two agree.

**Bid above ask.** In a continuous market that would be broken data. Here it is
the mechanism: nothing executes on arrival, so buyers and sellers overlap until
the cross, and the overlap is what trades. The page says so whenever it
happens.

## External reference

| Shown as | Source | How it is computed | Refresh |
|---|---|---|---|
| **Pyth · XXX/USD** | The ticker's Pyth `PriceUpdateV2` account on **Solana mainnet**, read through the site's `/api/rpc` proxy, with public endpoints as fallback | `price × 10^expo` | Every 12s |
| **Published Ns ago** | `publish_time` on that account | Now − publish time. Over 90s is **stale**, the same limit the program uses (`ORACLE_MAX_AGE_SECS`) | Every second |
| **Extended hours** | Pyth's market schedule for the feed (Hermes metadata) | The schedule says closed but the print is fresh | The schedule is read hourly |
| **Last check: stale, not used** | `oracle_gate` on the latest crossed auction of this ticker | The program's own eight-condition check, made at the cross against the **devnet** Pyth account the keeper passes in, and recorded on chain | With the auction list, every 30s |

The price shown is mainnet Pyth. The auction's own check reads devnet Pyth at
the cross, and uses it only to break a tie (step 3 above), never to set the
price. The devnet AAPL account is usually stale, so most auctions record
"stale".

## Sidebar

| Shown as | Source | How it is computed | Refresh |
|---|---|---|---|
| **Price** | The latest auction of the ticker that traded (`executable_volume > 0`), from `/api/venue` | Its clearing price; muted once more than an hour old. Hovering says when that auction's window closed | `/api/venue` is read every 15s; the server refreshes its own read every 10s |
| **open · crosses in Nm** / **frozen · crosses in Nm** | The ticker's newest auction, from `/api/venue` | Shown whenever that auction is taking orders; rounded up to the minute | As above |
| **last cross N ago** | As for the price | Time since *the window closed* of the last auction that traded: (current slot − its close slot) × slot time. Not the settlement time, which follows seconds later | As above |

**What "traded X ago" measured, and why it changed.** It was the time since the
window closed on the last auction that traded, as above. It also took
precedence over the live state, so a ticker taking orders right now could read
"traded 3h ago". The row now leads with what the book is doing, and says "last
cross" rather than "traded".

The sidebar reads the site's cached venue feed, while the ticker page reads the
auction account directly. The sidebar can therefore lag the page by up to about
25 seconds.

## Why tickers show different timing and state

There is no shared schedule. The keeper runs a loop every 20s on Railway. For
each of the ten tickers, whenever that ticker has no auction taking orders, it
opens one at the slot it happens to reach: open slot = now, close slot = open
slot + 7,000 (about 19.3 minutes).

Each ticker's clock therefore starts wherever its last auction ended. Its
windows drift from the others' with every keeper restart, slow RPC response,
and auction whose settlement takes several ticks, as the busier bot tickers'
do. Read at the same moment on 24 Sept, AAPLx crossed in 5 minutes, NVDAx in 6,
TSLAx in 4 and GOOGLx in 16.

Between one ticker's cross and its next open there are a few seconds when that
ticker has no running auction. The sidebar says "between auctions" then.

## Past crosses

| Shown as | Source |
|---|---|
| **Last cross $X · N shares · window closed ≈ time** | The latest traded auction of the ticker. It moved here from beside the order form: it is history, not a quote |
| Table: **Clearing price, Volume, Orders, Pyth anchor, Status** | Each auction account. "Pyth anchor: Yes" means a fresh Pyth price was passed and recorded at that cross (`reference_price_set`) |
| Candles | One per auction. Open and close are clearing prices; high and low are the range of *limit prices placed*, not trades, because one price trades per auction |

## Your orders, the receipt, Orders and Portfolio

These start from the wallet, not from the ticker's newest auction. The site's
`/api/orders` finds every order account the wallet owns (order accounts are
never closed). For each order it returns the auction account, and the
transactions that placed and settled it, with the wallet's token movements in
them. The dashboard reads it every 10s. A settled order's transactions are
cached on the server, because they cannot change.

| Shown as | Source |
|---|---|
| **Filled / Partially filled / Unfilled** | The auction's per-order `filled_quantity` against the order's `quantity`. Once the auction is closed, the order account's own `filled_quantity` |
| **Clearing price** | `clearing_price` on the auction. Once closed, rebuilt: what was paid ÷ what filled |
| **You paid / You received** | The auction's per-order `quote_amount`, written at the cross. Once closed, rebuilt from the settlement transaction |
| **Delivered, Returned to you** | The wallet's token movements in the settlement transaction. Never the order's `refunded` flag, which the program sets only on the failure path (`cancel_and_refund`); an unfilled order whose escrow came back in full reads `false` |
| **Settlement** | The settlement transaction's signature and block time |
| **Refunded** | The auction settled on the failure path, so every order got back its full escrow |
| **Cancelled** | `cancelled` on the order account |
| **Open / Frozen** | The order's auction has not crossed; Frozen once inside its freeze window |

A receipt or row rebuilt from a settlement transaction, because its auction has
been closed and its rent returned, says so. Live and rebuilt figures are never
mixed. The keeper no longer closes an auction with an order from anyone but the
activity bot, so a participant's auction keeps its full on-chain record.

**Portfolio.**
- **In wallet:** every token account the wallet owns, from
  `getParsedTokenAccountsByOwner`, read every 20s.
- **Locked:** the escrow of every order that is neither settled nor cancelled.
  For a buy that is dollars, for a sell shares, each listed with its order and
  when it crosses.
- **Value:** total shares × the ticker's mainnet Pyth price, read every 30s, and
  marked stale when older than 90s.
- **Not valued:** a ticker with no Pyth feed, and SOL.

## Units

Prices on chain are quote atomic units (6 decimals) per whole raw ticker token
(10⁸ raw units). xStocks carry Token-2022's scaled-UI multiplier, where one
token is `m` shares. Every price and quantity on the dashboard is converted to
dollars per share and shares, and a ticker whose multiplier is not 1 says so
under "This auction".
