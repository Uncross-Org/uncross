---
title: Sources
description: Which file in the repository backs which part of these docs, and how the docs were checked.
---

Every claim in these docs comes from the program's source, the app's source, a committed research or test log, or a direct read of devnet made while writing. Nothing is inferred beyond those. Every page ends with the sources it rests on.

Source links point to commit [`f7245ea`](https://github.com/Uncross-Org/uncross/tree/f7245ea33e019bbcfacfd17ccc6677a1d3bb5f5c) of [github.com/Uncross-Org/uncross](https://github.com/Uncross-Org/uncross), so they keep pointing at the code these docs describe.

## Code

| Path | What it backs |
|---|---|
| `uncross/programs/uncross/src/lib.rs` | every instruction, its checks, who may call it |
| `uncross/programs/uncross/src/clearing.rs` | the clearing rule, fills, escrow and money legs, and their tests |
| `uncross/programs/uncross/src/oracle.rs` | the Pyth gate, verdict codes, multiplier conversion, and their tests |
| `uncross/programs/uncross/src/state.rs` | account layouts, `MAX_ORDERS`, why order accounts are never closed |
| `uncross/programs/uncross/src/errors.rs` | error codes and messages |
| `uncross/scripts/keeper.mjs` | how auctions are opened, crossed, settled and closed |
| `uncross/scripts/faucet.mjs` | test-token grants, auction opening on demand, their limits |
| `uncross/scripts/tickers.json` | tickers, mints, multipliers, Pyth accounts and feed IDs |
| `web/src/` | the dashboard: order statuses (`lib/settlement.ts`), receipts, Orders and Portfolio pages, unit conversion (`lib/units.ts`) |

## Research and test logs

| Path | What it backs |
|---|---|
| `README.md` | overview, the fixture comparison, what the project does not solve |
| `docs/phase0.md` | mint reads, PDA custody, the original transaction-size measurement |
| `docs/phase1.md` | first devnet runs: the 247.50 book, pause and multiplier tests |
| `docs/phase2.md` | accounting bugs found and fixed, batch size, 38- and 42-order runs, oracle bugs, PreStocks and Tessera |
| `docs/pyth.md` | the feed, the gate, the after-hours measurement and retraction |
| `docs/numbers.md` | every figure on the dashboard, its source and refresh |
| `docs/devnet-fixture.md` | the fixture mints and their diff against mainnet |
| `docs/railway.md` | the keeper's and bot's production settings |
| `docs/community-auction.md` | the participant path, faucet reachability |
| `docs/submission-draft.md` | the xStocks universe, IBMx readings, the MSTRx cross, rent recovery, the browser-wallet run |
| `docs/rent-recovery-2026-09-23.tsv` | every close signature from the rent recovery |
| `docs/data/pyth-aapl-watch-2026-09-15.log` | the raw after-hours Pyth log |
| `docs/data/xstocks-universe-2026-09-23.json` | the 1,026-mint universe read |

## Read from devnet while writing, 24 Sept 2026

- The MSTRx auction account, its settlement transaction, and one participant's order account ([Verify a clearing price](/trust/verify/)).
- The 247.50 auction account ([The clearing rule](/mechanism/clearing-rule/)).
- The clearing rule replayed over 40 other auctions: all 39 that had crossed matched.
- The MSTRx fixture mint's extensions and multiplier.
- The program's 25 unit tests, run with `cargo test`: all passed.

## How the site itself is checked

Before each publish, `npm run verify` in `docs-site/`:

- resolves every internal link and anchor;
- loads every page at 1440 and 390 px in both themes and fails on any sideways scroll, or any table too wide for its column;
- checks that a first visit is light whatever the OS prefers;
- runs a real search query;
- checks every Explorer link's label against its URL;
- checks every cited transaction signature against devnet.

## Changes to these docs

If a figure here disagrees with the code or a committed log, the code and the log win. Please open an issue on the repository.
