# The community auction

One scheduled cross, on one ticker, filled by real people instead of the test
bot. Everything else on this venue demonstrates the mechanism with our own
orders; this is the one event where the book belongs to strangers.

- **When** Monday 21 September 2026, 14:30 UTC (8:00pm IST, 10:30am ET)
- **Ticker** IBMx — the one Jupiter quotes at $247.14 and will not route at any
  size, which is the reason this venue exists
- **Window** 22 minutes of open orders, cancellations close for the last 2
- **Where** https://uncross.0xo.in/app?ticker=IBMx

## For participants

Copy this as-is. It is the whole path, and it has been tested from a wallet
that had never existed, in a fresh browser, with nobody helping.

> **Trade a tokenized stock at a fair price — Uncross, 8pm IST tonight**
>
> Uncross runs a call auction: instead of each person trading alone against a
> thin pool, everyone who wants to trade gathers in the same few minutes and
> fills at **one price**. Tonight's book is IBMx.
>
> You need a Solana wallet (Phantom, Solflare, Backpack) **switched to
> devnet**. Everything is test tokens — nothing here is worth money, and you
> cannot lose anything.
>
> 1. Switch your wallet to **devnet**. Phantom: Settings → Developer Settings →
>    Testnet Mode → Devnet. Solflare: the network dropdown → Devnet.
> 2. Open **https://uncross.0xo.in/app?ticker=IBMx**
> 3. Click **Select Wallet**, connect.
> 4. Click **Get test tokens**. You get devnet SOL for fees, IBMx shares to
>    sell and test dollars to buy with. Takes a few seconds.
> 5. Choose **Buy** or **Sell**, set a price (tap a suggested one), enter a
>    number of shares, and place the order.
> 6. Watch the countdown. When the window closes, everyone who crosses fills at
>    the same price — whatever they each asked for.
>
> Your order is not executed on arrival. It waits. You may see a best bid
> *above* the best ask: in a normal market that is impossible, here it just
> means buyers and sellers overlap and that overlap is what trades.

## Reachability

Participants call the faucet at `uncross.0xo.in/api/faucet`, not at its
Railway hostname. Some networks block `*.up.railway.app` — the machine this
was built on does — and a participant on such a network would find the one
action they need silently broken, with no error worth reading. The rewrite
lives in `site/next.config.ts`.

One consequence, measured: through that rewrite the faucet sees a Vercel edge
address rather than the participant, so the per-IP limit cannot identify
anyone and is set loose (500/hour) to avoid refusing real people. What bounds
the damage is the per-wallet cooldown and the global caps.

## If the faucet fails for someone

It is rate-limited: one grant per wallet every three hours, a per-IP hourly
cap, and a hard global cap. The message it returns says which. Post this:

> If **Get test tokens** says the faucet is rate-limited or at its cap, send me
> your wallet address and I will fund you directly — takes about ten seconds.

To fund someone by hand, with the event ticker and their address:

```sh
cd uncross
RPC_URLS="$HELIUS_DEVNET" node -e '
const pub = process.argv[1];
import("./scripts/lib.mjs").then(async (L) => {
  const a = (await import("@coral-xyz/anchor")).default;
  const spl = await import("@solana/spl-token");
  const { PublicKey, SystemProgram, LAMPORTS_PER_SOL } = a.web3;
  const conn = L.makeConnection(), fx = L.loadFixture();
  const deploy = L.loadKeypair("deploy"), funder = L.loadKeypair("wallet2");
  const tk = L.loadTickers().tickers.find(t => t.symbol === "IBMx");
  const mint = new PublicKey(tk.devnetMint), quote = new PublicKey(fx.quoteMint);
  const o = new PublicKey(pub);
  const ixs = [
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: o, lamports: 0.02 * LAMPORTS_PER_SOL }),
    spl.createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, L.tickerAta(o, mint), o, mint, L.TICKER_PROGRAM, L.ASSOCIATED_TOKEN_PROGRAM),
    spl.createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, L.quoteAta(o, quote), o, quote, L.QUOTE_PROGRAM, L.ASSOCIATED_TOKEN_PROGRAM),
    spl.createMintToCheckedInstruction(mint, L.tickerAta(o, mint), deploy.publicKey, 12n * 100000000n, 8, [], L.TICKER_PROGRAM),
    spl.createMintToCheckedInstruction(quote, L.quoteAta(o, quote), deploy.publicKey, 6000n * 1000000n, 6, [], L.QUOTE_PROGRAM),
  ];
  console.log((await L.sendV0(conn, funder, [deploy], ixs, { cuLimit: 250000 })).sig);
});' <THEIR_WALLET_ADDRESS>
```

## Running it

Times are UTC.

**14:25 — open the auction.** Check the maths first, then send it:

```sh
cd uncross
RPC_URLS="$HELIUS_DEVNET" node scripts/event-auction.mjs --ticker IBMx --window-mins 22 --freeze-mins 2 --dry-run
RPC_URLS="$HELIUS_DEVNET" node scripts/event-auction.mjs --ticker IBMx --window-mins 22 --freeze-mins 2
```

It prints `EVENT_AUCTION=<address>`. The window is converted from minutes using
the slot rate measured seconds beforehand, because devnet slot time drifts —
the dry run prints the close time it computed, so check that before sending.

**14:26 — keep the bot and the reclaimer off it.** Two Railway variables, both
taking the address just printed:

```sh
railway variable set "SKIP_AUCTIONS=<address>" --service uncross-activity
railway variable set "NEVER_CLOSE=<address>" --service uncross-keeper
```

`SKIP_AUCTIONS` is what makes "real people filled this book" a true statement;
without it the bot seeds the event auction within a minute. `NEVER_CLOSE` stops
the keeper reclaiming its rent once settled, which would delete the account and
break every link pointing at it.

The keeper needs no other change: it sees a live auction for IBMx and will not
open a competing one, and it runs the cross when the window closes.

**14:30 — post the link.** The countdown on the site and in the app switches to
"open" by itself.

**~14:52 — it crosses.** The keeper clears and settles it. Capture, in this
order: the book just before the close, the clearing price, the settlement, and
the distinct-wallet count.

**Afterwards — verify the claim before making it:**

```sh
RPC_URLS="$HELIUS_DEVNET" node scripts/event-report.mjs --auction <address>
```

It reports total orders, distinct wallets, and how many of those wallets are
among the 42 test owners. If that last number is not zero, do not claim the
book was filled by real people — say what actually happened.

## If it has to be postponed

Cheap and quick, in this order:

1. Edit `uncross/scripts/event.json`: set `startsAt` to the new time, or set
   `"live": false` to remove the banner entirely.
2. `sh site/scripts/build-app.sh && vercel deploy --cwd site --prod --yes`
3. Post the new time. Suggested fallback slot: **Tuesday 22 September, 14:30
   UTC** — same hour, one day later, so nobody has to recalculate a timezone.

Do not open the auction if the entry path is failing. An empty book that people
could not join is worse than a date change.
