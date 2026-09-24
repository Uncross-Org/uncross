---
title: Open an auction, run the cross
description: Starting an auction on a listed ticker with nothing running, and finishing an auction yourself when its window has closed.
---

Two actions that usually happen automatically can also be done by anyone. The program does not trust the keeper, and it does not depend on it.

## Opening an auction on a quiet ticker

The keeper runs auctions on a fixed cadence for ten tickers: AAPLx, NVDAx, TSLAx, GOOGLx, MSTRx, HOODx, IBMx, XOMx, JPMx and ORCLx. Other listed tickers have no auction running until someone opens one. The app shows these as **Listed**: "No auction is running for …".

Click **Open an auction for …**. The faucet service opens it for you:

- It takes orders for the next 7,000 slots, about 19 minutes at the measured devnet slot rate, with the same 700-slot freeze as every other auction.
- **The venue pays the rent**, about 0.018 SOL, and gets it back when the auction closes. Your test tokens stay yours to trade with.
- If an auction is already running for that ticker, you are shown that one instead.
- The keeper runs the cross and settlement when the window closes, as for any other auction.

Opening is refused for a ticker xStocks has marked trading-halted. It is also rate-limited: one open per wallet every 15 minutes, a per-IP hourly count, and a cap of 25 faucet-opened auctions live at once. The cap bounds how much rent is locked at any moment.

## Running the cross or settlement yourself

Every step after an auction's window closes is **permissionless**: `compute_clearing`, `settle_batch`, `cancel_and_refund` and `close_auction` accept any signer. No special key is involved, and the program checks everything itself.

If an auction's window has closed and the cross or settlement has not run yet, the app shows **An auction is waiting to be finished. Anyone can do it — no special keys. You only pay the network fee.** The button sends:

- the **cross** (`compute_clearing`), if the auction has not crossed;
- otherwise **settlement**, in batches of 7 orders, the measured transaction-size limit with distinct owners.

The app's cross button passes the Pyth account for the auction's own feed on devnet, found the way the keeper finds it, or none when the feed has no account there. So a cross run from the app records the same Pyth verdict the keeper's would. Until 25 Sept the button passed the ticker's mainnet address, which does not exist on devnet, so a cross run from the app recorded "wrong owner" where the keeper's recorded "stale". The price was the same either way.

Apart from that, the result is the same whoever sends these. The clearing price and every order's fill and money leg are computed by the program from the book. Settlement only moves numbers fixed at the cross. The one exception is that the sender of the cross chooses which Pyth account to pass. That cannot move the price outside what the book supports, and it lets nobody take funds ([Honest limitations](/trust/limitations/#what-whoever-sends-the-cross-can-influence)).

The refund path is not a choice the sender has. The program allows it only when the ticker mint is paused, or when the path has already been taken.

<p class="sources">Sources: <code>web/src/components/OpenAuction.tsx</code>, <code>web/src/components/CrankPanel.tsx</code>, <code>uncross/scripts/faucet.mjs</code> (open limits), <code>uncross/scripts/keeper.mjs</code>, <code>docs/railway.md</code>, <code>uncross/programs/uncross/src/lib.rs</code>.</p>
