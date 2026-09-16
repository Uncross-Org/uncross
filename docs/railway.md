# Running the venue off this machine

The keeper and the activity bot are what make the site's live sections live. Run
locally they only exist while one laptop is awake with a terminal open; judging
runs to 2 October, so they move to Railway.

Nothing here is deployed until a dedicated devnet RPC endpoint exists — the
public endpoint rate-limits `getProgramAccounts`, `getSignaturesForAddress` and
`getLatestBlockhash`, and that last one blocks sending transactions at all.

## The two services

Both run from this repository with the root directory set to `uncross/`, and
differ only in start command. Config is committed:

| Service | Config file | Start command |
|---|---|---|
| `uncross-keeper` | `railway.keeper.json` | `node scripts/keeper.mjs --cluster devnet --cadence 3000 --freeze 300 --interval 20` |
| `uncross-activity` | `railway.activity.json` | `node scripts/devnet-activity.mjs --loop` |

Both set `restartPolicyType: ALWAYS` with 10 retries, one replica, and
`sleepApplication: false` so Railway does not idle them out. One replica each is
deliberate: two keepers would race to open the same auction, and two bots would
double-seed.

## Environment variables

Set these on **both** services, in Railway's settings. None of them belong in
the repository.

| Variable | Purpose |
|---|---|
| `RPC_URLS` | Comma-separated endpoints, best first. The public devnet endpoint is appended automatically as a fallback, so losing the dedicated one degrades the venue rather than stopping it. |
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
   running. A local keeper racing the hosted one opens duplicate auctions.
2. Confirm exactly one of each is live on Railway.
3. Restart the services and confirm both come back unattended and the book
   resumes, without anyone intervening.
