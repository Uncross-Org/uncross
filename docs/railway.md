# Running the venue off this machine

The keeper and the activity bot are what make the site's live sections live. Run
locally they only exist while one laptop is awake with a terminal open; judging
runs to 2 October, so they move to Railway.

Nothing here is deployed until a dedicated devnet RPC endpoint exists — the
public endpoint rate-limits `getProgramAccounts`, `getSignaturesForAddress` and
`getLatestBlockhash`, and that last one blocks sending transactions at all.

## Deployed, 17 September

Both services are live in the `uncross-venue` Railway project (`uncross-keeper`,
`uncross-activity`), root directory `uncross/`. Config is `.railway/railway.ts`
— Railway's config-as-code (`railway.json`) is deprecated in favour of this
declarative "infrastructure as code" file, applied with `railway config apply`.
The two committed JSON files this section used to describe are gone; this file
is now the only source of truth for what each service runs.

| Service | Start command |
|---|---|
| `uncross-keeper` | `node scripts/keeper.mjs --cluster devnet --cadence 7000 --freeze 700 --interval 20 --close-per-tick 12` |
| `uncross-activity` | `node scripts/devnet-activity.mjs --loop --tickers AAPLx,NVDAx,IBMx,TSLAx --orders 2-3` |

Both set `restartPolicyType: ALWAYS` with 10 retries, one replica, and
`sleepApplication: false` so Railway does not idle them out. One replica each is
deliberate: two keepers would race to open the same auction, and two bots would
double-seed. The repository root also holds the Anchor program's `Cargo.toml`,
and Railway's builder (Railpack) auto-detected the wrong language and shipped
an image with no `node` binary when left to guess — `build.nixpacksPlan.providers:
["node"]` in the IaC file forces it.

Secrets are declared with `preserve()`, not a literal value: the file states
that each service has an `RPC_URLS` and the relevant `KEYPAIR_*` variables,
without ever holding their contents, so `railway config apply` can change the
start command or restart policy without touching — or being able to delete —
what `railway variable set` put there. Applying a plan that *does* try to
change or delete a variable is refused without `--confirm-destructive`; seeing
that flag requested for a variable change is the signal something is wrong,
not something to pass routinely.

To redeploy either service after a code change: `railway service link
uncross-keeper` (or `-activity`), then `railway up -y -c --service
uncross-keeper`. To change start command, replicas or restart policy, edit
`.railway/railway.ts` and run `railway config plan` then `railway config
apply --yes` (add `--confirm-destructive` only if the plan's destructive
change is expected — it usually means a variable fell out of the file).

### A hang that cost the bot its first hour live

`devnet-activity.mjs` reads Pyth's mainnet AAPL price and, for tickers with no
Pyth feed, Jupiter's price — both over a bare `fetch` to a public endpoint,
with no timeout. On Railway that request to `api.mainnet-beta.solana.com`
never resolved or rejected; it just hung. Locally, and against the devnet
Helius endpoint, everything else worked — the difference only showed up on
that one outbound path, and a hang produces no error to log, so the service
looked deployed and healthy (`SUCCESS`, container running) while doing
nothing. `railway run --service uncross-activity -- node
scripts/devnet-activity.mjs` pulls the service's real env vars into a local
process — it ran to completion in seconds, which is what pointed at
Railway's network path rather than the code or the credentials.

Fixed: every mainnet call now goes through a `fetch` that aborts at 10s
(`AbortSignal.timeout`), retried through `withRetry` (which now also treats
an aborted request as retryable), rotating across two public endpoints
(`api.mainnet-beta.solana.com`, `solana-rpc.publicnode.com`) the way the
site's `MAINNET_READ_RPCS` already does. If both keep timing out from
Railway's network, the fix converts a silent, permanent hang into a logged,
retried failure — still worth a dedicated mainnet RPC key if it recurs.

## Environment variables

Set these on **both** services, in Railway's settings. None of them belong in
the repository.

| Variable | Purpose |
|---|---|
| `RPC_URLS` | Comma-separated endpoints, best first. The public devnet endpoint is appended automatically. Every connection the keeper and bot make goes through `failoverFetch` in `scripts/lib.mjs`: a network error, 429 or 5xx parks that endpoint for a minute and the same request goes to the next one. Logs show hostnames only, never the URL, because a dedicated URL carries its API key. |
| `KEYPAIR_DEPLOY` | Contents of `deploy.json` — the keeper's fee payer and the fixture mint authority. |
| `KEYPAIR_WALLET2` | Contents of `wallet2.json` — funds order owners. Activity service only. |
| `KEYPAIR_MB_OWNERS` | Contents of `mb-owners.json`, the 42 test order owners (~9.7 KB). Activity service only. |

A hosted runner has no `~/.config/solana`, so `readKeyMaterial()` in
`scripts/lib.mjs` reads these variables first and falls back to the local
keyring, which keeps local runs unchanged. The values are the same JSON arrays
the keypair files contain.

The endpoint URL carries an API key. It is set in Railway (and, for the site, in
Vercel as the server-only `DEVNET_RPC` — never `NEXT_PUBLIC_DEVNET_RPC`, which
would inline it into the browser bundle).

> **Correction.** An earlier version of this document said losing the dedicated
> endpoint would degrade the venue rather than stop it. As first committed that
> was not true: nothing ever used any entry after the first, and the keeper
> ignored `RPC_URLS` altogether, reading `DEVNET_RPC` instead. Both are fixed;
> failover was tested with a dead primary (one request, one failover, the next
> request skipping the parked endpoint).

## What it costs to run, measured

Every auction the keeper opens creates accounts that are never closed — the
program has no close instruction, which the README discloses. So the cost is
rent, and it scales directly with how many auctions are opened.

Measured on 16 September:

| Quantity | Measured value |
|---|---|
| Auctions opened | 136 over 12.68 h = **10.7/hour, 257/day** |
| Cost of `InitializeAuction` | **0.018334 SOL** |
| Cost of `ComputeClearing` | 0.000005 SOL |
| Cost of `SettleBatch` | 0.000005 SOL |
| Keeper burn | **~4.7 SOL/day** |
| Activity bot burn (wallet2) | 45 tx/h at 0.000005 = **~0.005 SOL/day** |

The bot is not the constraint; the keeper's account rent is all of it.

At the time of writing the keeper payer
(`68N5a3Nj5u7Kc5RPiyu4iH3qVLN1A7wu1fEWErNtqLJf`) held **0.8163 SOL** — about
four hours. Reaching 2 October at this cadence needs roughly **75 SOL**, and the
public faucet refused a 2 SOL airdrop outright ("Internal error"), so topping up
to that level is not realistic.

Cadence is the lever, because cost is per auction opened:

| Cadence | Auctions/day | Keeper burn | ~16 days |
|---|---|---|---|
| 3000 slots (~20 min, current) | 257 | 4.7 SOL/day | ~75 SOL |
| 9000 slots (~1 hour) | 48 | 0.88 SOL/day | ~14 SOL |
| 18000 slots (~2 hours) | 24 | 0.44 SOL/day | ~7 SOL |
| 45000 slots (~5 hours) | 9.7 | 0.18 SOL/day | ~2.8 SOL |

An auction accepts orders for its whole window, so a longer cadence still leaves
a live book with orders arriving and a populated recent-crosses list. What it
costs is the chance of a visitor watching a cross land during a short visit.

### After close_auction

The figures above describe the program before `close_auction`. With it, the
keeper returns an auction's rent and both vaults' rent once the auction is fully
settled and its vaults are empty, so rent stops accumulating and the running
cost falls towards transaction fees. The keeper closes empty auctions at once
and keeps the newest six traded auctions per ticker, because the site's
recent-crosses list and hero read them from chain.

The measured per-auction net cost on devnet is reported once the upgrade is
deployed. Deploying needs a temporary 2.2515 SOL buffer deposit, refunded when
the upgrade completes.

### What is actually available

Every devnet wallet this project controls, totalled:

| Wallet | Balance |
|---|---|
| `deploy` (keeper payer) | 0.8163 SOL |
| `wallet2` (bot funder) | 1.8074 SOL |
| 42 order owners | 0.2965 SOL |
| **Total** | **~2.92 SOL** |

Sweeping the owners back is not worth doing: the bot funds them from `wallet2`
so they can pay their own order fees, so draining them moves SOL in a circle
and stops the order flow it is meant to pay for. The bot itself needs very
little — about 0.005 SOL/day, roughly 0.08 SOL across the whole run.

That leaves about **2.84 SOL for the keeper over 16 days: 0.177 SOL/day**,
which is 9.7 auctions/day across both tickers, or one auction per ticker every
five hours. `--cadence 45000` is therefore the fastest the venue can run to
2 October without more funding.

The public faucet cannot close the gap: `requestAirdrop` was refused for 2 SOL,
1 SOL and 0.5 SOL in succession with "You've either reached your airdrop limit
today or the faucet has run dry". An automated top-up is not available, so
either the cadence drops to ~5 hours or devnet SOL is supplied from elsewhere
(a funded wallet, or faucet.solana.com, which needs interactive browser auth).

## After deploying

1. Shut the local processes down explicitly — `pkill -f keeper.mjs` and
   `pkill -f devnet-activity.mjs` — and confirm with `pgrep` that neither is
   running. A local keeper racing the hosted one opens duplicate auctions; this
   is exactly what happened on first deploy here — the local keeper was
   stopped right away, but the local activity bot was missed for about ten
   minutes and kept seeding in a race with the (at that point, hung) Railway
   copy before it was caught and stopped.
2. Confirm exactly one of each is live on Railway — `railway logs --service
   uncross-keeper` and `--service uncross-activity` should each show one
   `Starting Container` for the current deployment and ongoing activity, not
   silence. Silence for more than a couple of minutes is not proof of health;
   confirm against chain state (order counts on the newest open auctions) or
   reproduce the exact command with `railway run --service NAME -- node ...`
   before trusting it.
3. Restart the services and confirm both come back unattended and the book
   resumes, without anyone intervening.
