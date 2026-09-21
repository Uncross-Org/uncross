# The community auction

Two scheduled crosses, back to back, filled by real people instead of the test
bot. Everything else on this venue demonstrates the mechanism with our own
orders; this is the one event where the books belong to strangers.

- **When** Monday 21 September 2026 — two auctions, back to back
  - **AAPLx** 14:30–14:50 UTC (8:00pm IST). Apple has a live Pyth price, so
    there is a reference to judge the cross against.
  - **IBMx** 14:50–15:10 UTC. IBM has no Pyth price on Solana at all; the only
    price is the one the book makes. This is the reason the venue exists.
- **Cancellations** close for the last 2 minutes of each window
- **Where** https://uncross.0xo.in/app?ticker=AAPLx then `?ticker=IBMx`
- **One grant of test tokens covers both books** — verified on chain

## For participants

Copy this as-is. It is the whole path, and it has been tested from a wallet
that had never existed, in a fresh browser, with nobody helping.

> **Trade a tokenized stock at a fair price — Uncross, 8pm IST tonight**
>
> Uncross runs a call auction: instead of each person trading alone against a
> thin pool, everyone who wants to trade gathers in the same few minutes and
> fills at **one price**. Tonight there are two books, back to back: **AAPLx at
> 8:00pm IST, then IBMx at 8:20pm**. One set of test tokens covers both.
>
> You need a Solana wallet (Phantom, Solflare, Backpack) **switched to
> devnet**. Everything is test tokens — nothing here is worth money, and you
> cannot lose anything.
>
> 1. Switch your wallet to **devnet**. Phantom: Settings → Developer Settings →
>    Testnet Mode → Devnet. Solflare: the network dropdown → Devnet.
> 2. Open **https://uncross.0xo.in/app?ticker=AAPLx**
> 3. Click **Select Wallet**, connect.
> 4. Click **Get test tokens**. You get devnet SOL for fees, shares of **both**
>    tickers to sell, and test dollars to buy with. Takes a few seconds, and you
>    only need to do it once for the whole evening.
> 5. Choose **Buy** or **Sell**, set a price (tap the highlighted suggestion),
>    enter a number of shares, and place the order.
> 6. Watch the countdown. When the window closes, everyone who crosses fills at
>    the same price — whatever they each asked for.
> 7. **The second auction opens the moment the first crosses.** Same wallet,
>    same tokens, nothing to claim again — switch to IBMx and trade again.
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

To fund someone by hand, with both event tickers and their address. Run it
exactly as written — the address is read from `process.argv[1]`, which is the
first argument only under `node -e`; saving this to a file and running that
file shifts the argument and it fails on a bad address:

```sh
cd uncross
RPC_URLS="$HELIUS_DEVNET" node -e '
const pub = process.argv[1];
import("./scripts/lib.mjs").then(async (L) => {
  const a = (await import("@coral-xyz/anchor")).default;
  const spl = await import("@solana/spl-token");
  const { PublicKey, SystemProgram, LAMPORTS_PER_SOL } = a.web3;
  const conn = L.makeConnection(), fx = L.loadFixture();
  // deploy pays: wallet2 funds the bot and runs down with it.
  const deploy = L.loadKeypair("deploy"), funder = deploy;
  const quote = new PublicKey(fx.quoteMint);
  const o = new PublicKey(pub);
  const ixs = [
    SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: o, lamports: 0.02 * LAMPORTS_PER_SOL }),
    spl.createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, L.quoteAta(o, quote), o, quote, L.QUOTE_PROGRAM, L.ASSOCIATED_TOKEN_PROGRAM),
    spl.createMintToCheckedInstruction(quote, L.quoteAta(o, quote), deploy.publicKey, 6000n * 1000000n, 6, [], L.QUOTE_PROGRAM),
  ];
  // Both event tickers, exactly as the faucet does: whoever this rescues must
  // be able to sell in the second auction too, not just the one running.
  for (const sym of ["AAPLx", "IBMx"]) {
    const mint = new PublicKey(L.loadTickers().tickers.find(t => t.symbol === sym).devnetMint);
    ixs.push(
      spl.createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, L.tickerAta(o, mint), o, mint, L.TICKER_PROGRAM, L.ASSOCIATED_TOKEN_PROGRAM),
      spl.createMintToCheckedInstruction(mint, L.tickerAta(o, mint), deploy.publicKey, 12n * 100000000n, 8, [], L.TICKER_PROGRAM),
    );
  }
  console.log((await L.sendV0(conn, funder, [deploy], ixs, { cuLimit: 400000 })).sig);
});' <THEIR_WALLET_ADDRESS>
```

Verified on chain rather than read for correctness: run against a fresh wallet
in tx `3bhMVV4E…zpyV3FF`, which left it holding 0.02 SOL, 12 AAPLx, 12 IBMx and
6000 quote — enough to trade in both books.

## Running it

Times are UTC.

**14:00 — take the bot off both event tickers.** This comes first, before the
auctions exist:

```sh
railway variable set "SKIP_TICKERS=AAPLx,IBMx" --service uncross-activity
railway logs --service uncross-activity   # expect: leaving AAPLx,IBMx to real participants
```

Doing it by ticker rather than by auction address is the whole point of the
ordering. `SKIP_AUCTIONS` cannot be set until the auction exists and its
address is known, which leaves a minute or two after opening in which the bot
can seed the event book — and it seeds a new book within a minute. A ticker
needs no address, so this can be set half an hour early and nothing the bot
does can reach either book, whatever the timing. Confirm the log line before
moving on; an exclusion you have not seen take effect is not an exclusion.

The cost is that AAPLx and IBMx sit quiet for the half hour before the event.
That is the right trade: an empty book for thirty minutes is recoverable, a bot
order in the community book is not.

**14:25 — open both auctions.** Check the maths first, then send it:

```sh
cd uncross
RPC_URLS="$HELIUS_DEVNET" node scripts/event-auction.mjs --sequence AAPLx:20,IBMx:20 --freeze-mins 2 --dry-run
RPC_URLS="$HELIUS_DEVNET" node scripts/event-auction.mjs --sequence AAPLx:20,IBMx:20 --freeze-mins 2
```

Both are opened now, not one at a time: the second's open slot is set to the
first's close slot, so IBMx begins the instant AAPLx crosses with nobody
touching anything, and `place_order` refuses orders outside a window anyway.
Windows are converted from minutes using the slot rate measured seconds
beforehand, because devnet slot time drifts — the dry run prints every start
and close time it computed, so check those before sending. It prints
`SKIP_AUCTIONS=` and `NEVER_CLOSE=` lines holding both addresses, ready to paste.

**14:26 — the backstop, and the reclaimer.** Two Railway variables, both taking
the addresses just printed. `SKIP_AUCTIONS` is now belt-and-braces behind the
14:00 ticker exclusion, not the only thing standing between the bot and the
book:

```sh
railway variable set "SKIP_AUCTIONS=<both addresses>" --service uncross-activity
railway variable set "NEVER_CLOSE=<both addresses>" --service uncross-keeper
```

`NEVER_CLOSE` stops the keeper reclaiming its rent once settled, which would
delete the account and break every link pointing at it.

The keeper needs no other change: it sees a live auction for each event ticker
and will not open a competing one, and it runs each cross when that window
closes. Because both auctions are already open, AAPLx crossing and IBMx opening
happen in the same slot with no instruction from anyone.

**14:30 — post the link.** The countdown on the site and in the app switches to
"open" by itself.

**14:50 — AAPLx crosses and IBMx opens, in the same slot.** No action. Record
continuously across both windows rather than stopping between them.

**~15:10 — IBMx crosses.** Capture, for each auction in turn: the book just
before the close, the clearing price, the settlement, and the distinct-wallet
count.

**Afterwards — verify the claim before making it:**

```sh
RPC_URLS="$HELIUS_DEVNET" node scripts/event-report.mjs --auction <AAPLx address>
RPC_URLS="$HELIUS_DEVNET" node scripts/event-report.mjs --auction <IBMx address>
```

Run it once per auction and report the two separately: total orders, distinct
wallets, and how many of those wallets are among the 42 test owners. If that
last number is not zero for either book, do not claim it was filled by real
people — say what actually happened. Comparing the two participant lists also
answers whether the same wallets came back for the second auction, which is
worth reporting either way.

## If it has to be postponed

Cheap and quick, in this order:

1. Edit `uncross/scripts/event.json`: set `startsAt` to the new time, or set
   `"live": false` to remove the banner entirely.
2. `sh site/scripts/build-app.sh && vercel deploy --cwd site --prod --yes`
3. Post the new time. Suggested fallback slot: **Tuesday 22 September, 14:30
   UTC** — same hour, one day later, so nobody has to recalculate a timezone.

Do not open the auction if the entry path is failing. An empty book that people
could not join is worse than a date change.
