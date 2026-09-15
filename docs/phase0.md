# Phase 0 findings — Uncross (Stocklana hackathon)

Research only. No program code, no frontend, no scaffolding written. All on-chain claims below were read live from Solana mainnet (`https://api.mainnet-beta.solana.com`) on 2026-09-15; everything else is cited to its source URL. Where a claim could not be independently verified in the available time, that is stated explicitly rather than filled in.

---

## Q1 — KILL QUESTION: token program, extensions, PDA custody

### Method
Queried `getAccountInfo` (`jsonParsed` encoding) directly against mint accounts on mainnet — not docs, not aggregator sites. Then built and ran `simulateTransaction` (real mainnet state, `sigVerify:false` so no funded keypair was needed) for the actual instruction a program would issue: `AssociatedTokenAccount.Create` for a PDA-owned account, and `Token2022.TransferChecked`.

### Per-mint findings (read live from mint accounts)

| Ticker | Mint | Program | freezeAuthority | defaultAccountState | permanentDelegate | transferHook | confidentialTransferMint | transferFee |
|---|---|---|---|---|---|---|---|---|
| AAPLx (xStocks) | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | spl-token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`) | `JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs` | **initialized** (not frozen-by-default) | **set**: `5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq` | present, **programId: null** (no hook wired) | present (opt-in, doesn't block normal transfers) | not present |
| TSLAx (xStocks) | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | spl-token-2022 | same authority | initialized | set (same delegate) | present, programId null | present | not present |
| NVDAx (xStocks) | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | spl-token-2022 | same authority | initialized | set (same delegate) | present, programId null | present | not present |
| SPYx (xStocks) | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | spl-token-2022 | same authority | initialized | set (same delegate) | present, programId null | present | not present |
| FLWS (Backpack Securities, via Sunrise) | `FLWSojG1gB5VStYR3Sb4nQFRt43UBYkqih1j2CpVLqgd` | spl-token-2022 | `2cVYpagTt7ZGc3mmTXBa7fAznUtx5DUu6aCq8uVDaf4a` | initialized | set (same authority) | present, programId null | present | not present |

All five also carry `metadataPointer`, `tokenMetadata`, `scaledUiAmountConfig` (a rebasing/index multiplier — relevant to settlement math, not custody), and `pausableConfig` (issuer can halt all transfers mint-wide; currently `paused:false` on every mint checked).

**Not yet located on Solana mainnet with a real mint address:** Sunrise-native tokens (Sunrise is currently observed as a *distribution partner* for Backpack Securities, not a separate mint issuer), Superstate equities (Superstate's on-chain Solana products found were tokenized treasuries/credit funds — `USTB` `CCz3SGVziFeLYk2xfEstkiqJfYkjaSWb2GCABYsVcjo2`, `USCC` `BTRR3sj1Bn2ZjuemgbeQ6SCtf84iXS81CS7UDTSxUCaK` — not equities; see [Superstate smart contracts docs](https://docs.superstate.com/investors/smart-contracts)), Securitize (public tokenization activity found concentrated on Ethereum/Avalanche, not Solana mainnet), Ondo Global Markets (announced for Solana in early 2026, e.g. `NVDAon` mint `gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo` exists but shows near-zero liquidity — see Q2). Do not generalize the AAPLx/TSLAx/NVDAx/SPYx/FLWS pattern onto these without checking each mint directly when/if they launch.

### Operational test: can a program-owned PDA receive and hold these tokens without issuer action?

**Yes — empirically confirmed, not inferred.** Derived a real off-curve PDA (`PublicKey.findProgramAddressSync`, confirmed `isOnCurve = false`), computed its Token-2022 associated-token-account address for AAPLx and FLWS, and submitted the actual `CreateAssociatedTokenAccount` instruction to `simulateTransaction` against live mainnet state (fee payer stood in as an existing funded mainnet account since `sigVerify:false` skips signature checks — no funds were moved, this is a real runtime dry-run, not a mock).

Result for both mints: **`err: null`**, i.e. success. Program log trail:
```
Program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL invoke [1]  (Associated Token Program)
Program log: Create
Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb invoke [2]   (Token-2022)
Program log: Instruction: InitializeImmutableOwner  -> success
Program log: Instruction: InitializeAccount3
Program log: Warning: Mint has a permanent delegate, so tokens in this account may be seized at any time
-> success
```

Because `defaultAccountState = initialized` on every mint checked (not `frozen`), the PDA's ATA comes up immediately usable — no issuer thaw step required. This directly answers the kill question: **a program-owned PDA can hold xStocks and Backpack Securities tokens today, with zero issuer involvement.** The only caveat surfaced by the runtime itself is the `permanentDelegate` warning — the issuer's delegate key can move tokens out of *any* account for this mint, PDA-owned or not, at any time, no signature from the account owner required. That's a standing compliance backstop (regulatory seizure/clawback), not a blocker to normal auction operation, but it means the PDA vault is not fully adversary-proof against the issuer itself — worth stating plainly in any docs/marketing, not hidden.

The `transferHook` extension is present but `programId: null` on every mint checked, i.e. no hook logic executes on transfer today. Because the hook *authority* is set (same key as permanentDelegate), the issuer could wire up a hook later, which would add required accounts to every transfer and change the settlement compute/account math computed in Q6. Not a current blocker; a live risk to monitor.

**Fallback (approve/delegate) was not needed** since PDA custody works directly. Not tested further, since Q1 requires "if it cannot" and it can.

Sources: mint accounts read live via mainnet RPC `getAccountInfo`/`simulateTransaction` (raw JSON captured above); [xStocks case study, Solana](https://solana.com/news/case-study-xstocks); [1-800-Flowers on Backpack Securities via Sunrise](https://solanacompass.com/news/1-800-flowers-flws-lists-on-solana-via-backpack-securities-posts-22m-on-day-one).

---

## Q2 — Candidate universe

Pulled live from Jupiter Token API v2 (`lite-api.jup.ag/tokens/v2/search`) on 2026-09-15, cross-checked mint addresses against on-chain reads where noted. Jupiter/DexScreener/Solscan report volume, TVL, and swap price-impact — **none publish a quoted bid-ask spread** (no CLOB exists for these pools), so "spread" below is a live Jupiter swap-quote price-impact proxy where queried, flagged where not.

| Ticker | Issuer | Mint | 24h volume (USD) | Liquidity/TVL (USD) | Spread proxy |
|---|---|---|---|---|---|
| SPYx | xStocks | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | $28,447,647 | $4,404,138 | ~0% price impact on $1k quote |
| SPCX | Backpack Securities (SpaceX, via Sunrise) | `SPCXxcqXj6e5dJDVNovHN8744zkbhM2bYudU45BimGb` | $11,820,478 | $690,722 | high churn, ~77k buys+sells/24h |
| NVDAx | xStocks | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | $10,401,883 | $1,810,629 | vol/TVL ~5.7x |
| CRCLx | xStocks | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | $8,507,297 | $1,978,670 | vol/TVL ~4.3x |
| MCDx | xStocks | `XsqE9cRRpzxcGKDXj1BJ7Xmg4GRhZoyY1KpmGSxAWT2` | $4,965,335 | $457,645 | vol/TVL ~10.9x, thin pool despite volume |
| GLDx | xStocks | `Xsv9hRk1z5ystj9MhnA7Lq4vjSsLwzL2nxrwmwtD3re` | $3,284,798 | $415,140 | not queried |
| QQQx | xStocks | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | $2,467,779 | $1,675,434 | not queried |
| TSLAx | xStocks | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | $2,354,667 | $1,208,859 | not queried |
| GOOGLx | xStocks | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | $2,082,606 | $415,299 | not queried |
| AAPLx | xStocks | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | $1,615,151 | $675,526 | not queried |
| MSTRx | xStocks | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | $1,339,167 | $761,730 | not queried |
| HOODx | xStocks | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | $1,078,783 | $410,077 | not queried |
| PLTRx | xStocks | `XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4` | $815,924 | $195,963 | not queried |
| GMEx | xStocks | `Xsf9mBktVB9BSU5kf4nHxPq5hCBJ2j2ui3ecFGxPRGc` | $549,334 | $240,424 | not queried |
| **XOMx** | xStocks | `XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh` | **$6,007** | **$18,947** | vol/TVL <1x — near-dead |
| **IBMx** | xStocks | `XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr` | **$511** | **$1,403** | **0.58% price impact on a $1 quote** — dead pool |
| **ORCLx** | xStocks | `XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL` | **$2,443** | **$3,545** | not queried, trivial TVL |
| **UNHx** | xStocks | `XszvaiXGPwvk2nwb3o9C1CX4K6zH8sez11E6uyup6fe` | **$675** | **$8,422** | not queried |
| **JPMx** | xStocks | `XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C` | **$94** | **$1,239** | essentially no trading |
| **NVDAon** | Ondo Global Markets | `gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo` | **$3,768** | **$492** | Jupiter `organicScore=0`, 98.5% top-holder concentration |

**Call-auction-pointless (already AMM-liquid):** SPYx, SPCX, and to a lesser extent NVDAx/CRCLx/MCDx — real volume, real depth, tight price impact on real size.

**Best call-auction candidates (thin but real):** JPMx, IBMx, ORCLx, UNHx, XOMx (all xStocks with live but functionally dead pools — sub-$20k TVL, single-to-low-hundreds-dollar daily volume) and NVDAon (Ondo Global Markets — despite the NVIDIA ticker, only $492 on-chain liquidity, demonstrating issuer brand does not correlate with on-chain depth).

Caveat carried over from research: headline "volume" on Jupiter includes non-organic flow on some of the mid-tier names (AAPLx etc. show materially lower `buyOrganicVolume` than total volume) — worth a second pass before final candidate selection, not a blocker to this list's conclusion about which names are thin.

Sources: [Jupiter Token API v2](https://lite-api.jup.ag/tokens/v2/search), [Jupiter swap quote API](https://lite-api.jup.ag/swap/v1/quote), [Superstate smart contracts](https://docs.superstate.com/investors/smart-contracts), [Solscan](https://solscan.io).

---

## Q3 — Reference price / oracle coverage

**Pyth covers the space broadly on paper.** Hermes (`https://hermes.pyth.network/v2/price_feeds?asset_type=equity`, queried live) returns **1,251 equity feeds** across multiple exchanges — symbol coverage extends well past mega-caps. AAPL feed ID: `49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` (`Equity.US.AAPL/USD`). A second, distinct feed exists, `Equity.Index.AAPL/USD` (`aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36`), described as a "24/7" synthetic index variant — methodology not documented in what was pulled; worth a closer look before relying on it.

**Depth/update-quality for thin names is unverified**, not confirmed absent — Pyth's own marketing materials only showcase megacap coverage (TSLA, COIN, PLTR, NVDA, AAPL). This is a real gap in this research pass, flagged rather than papered over.

**Update behaviour after close — this is the important finding.** Standard equity feeds do **not** keep moving after 4pm ET / weekends by default. Each feed carries `status` (`Trading | Halted | Auction | Unknown`) and `market_hours` (`is_open`, `next_open`, `next_close`, per-symbol trading-hours string). Per [Pyth's Market Hours docs](https://docs.pyth.network/price-feeds/core/market-hours): "Only prices with `status=trading` should be used. If status is `Halted`, `Auction`, or `Unknown`, the price can be an arbitrary value." Per [Pyth Best Practices](https://docs.pyth.network/price-feeds/core/best-practices): "Market hours...can cause price feeds to freeze while trading remains active... integrators should avoid accidentally using a stale price." This directly confirms the phase0.md hypothesis (thesis point: 63% of tokenized-equity volume happens outside US hours while the reference price is frozen) — **this is the mechanism-design opening**, not a blocker.

24/7 continuous equity pricing exists as a **paid product**: Pyth Pro advertises "24/5 pricing for 50+ U.S. equities" — a commercial add-on, not the free on-chain pull oracle. See [Pyth "Overnight Equities Explained"](https://www.pyth.network/blog/overnight-equities-explained).

**On-chain fields available for a freshness/status gate:** `price`, `conf` (confidence interval), `expo`, `publish_time`, `prev_publish_time`, `status` enum (`pyth_sdk_solana::PriceStatus` — [source](https://github.com/pyth-network/pyth-sdk-rs/blob/main/pyth-sdk-solana/src/state.rs)). Recommended gate: `status == Trading` AND `now - publish_time < threshold` AND `conf/price` ratio below a cap.

**Operational caveat found (new, not previously known):** as of 26 Aug 2026, Pyth's Hermes pull-update endpoint now requires an API key (confirmed live: 401 `unauthorized` on both an equity and a crypto feed pull during this research pass) — see [Pyth upgrade docs](https://docs.pyth.network/price-feeds/core/upgrade/preparing), [CryptoSlate coverage](https://cryptoslate.com/pyth-networks-api-overhaul-threatens-to-freeze-unpatched-smart-contracts-across-300-defi-protocols/). This affects the off-chain "push a fresh update" step our crank/keeper would need to run — plan for a registered Pyth API key as a build dependency. It should not affect reading an already-posted on-chain price account.

**Not reached this pass:** Switchboard, RedStone, Chainlink-on-Solana equity coverage; no live Solana `getAccountInfo` was pulled against a derived Pyth price account (time-boxed to web research/API pulls, which were live-tested).

---

## Q4 — Field check

**Verdict: collision risk LOW on the core mechanism, MEDIUM on positioning/naming.**

`github.com/martymedia/after-hours` (live at `after-hour.net`) is real and active (created 2026-09-13, commits through 2026-09-15 14:09 UTC) but is **not a trading venue or auction**: it's a dashboard + non-custodial swap frontend — shows onchain-vs-last-close drift, flags staleness (>1hr), estimates trade cost via Jupiter Quote/Swap API (user signs, nothing custodied), plus wallet tracking, Jupiter Trigger limit orders, and a Meteora DBC-launch monitor ("Curves"). All execution routes through Jupiter's existing continuous AMM liquidity. **No call-auction, no order book, no clearing-price computation.** No overlap with the core mechanism.

Broader search (`hackathons.solana.com/hackathons/stocklana` — confirmed live, deadline Fri 18 Sept 2026 4pm ET / 20:00 UTC, ~500+ registered, submission count climbing through the day; showcase/full-list page 404'd, so this is a partial census via GitHub topic search) surfaced ~20 "stocklana"-tagged repos: index baskets, a unit/decimals inspector, a corporate-actions oracle, a yield-bearing wrapper, a DCA+portfolio tool, a perp whale tracker, a terminal trading TUI, agentic-payments tooling, and one notable near-collision on **naming/positioning**: `khalydmaina/fairfill` — "Buy tokenized US stocks on Solana at the best price... even when NASDAQ is closed." Per its own README, it's a best-execution/reference-price tool (token registry + price recorder done; "fair price engine," API, web app not built, appears stalled since 2026-09-13) — not a call auction, but the name is close enough to our "fair fills" framing to be worth noting.

**No project found anywhere in this search implements a periodic call auction / batch clearing mechanism for tokenized equities on Solana.** Everything trading-adjacent routes through Jupiter's continuous liquidity or bonding curves.

Caveat: the hackathon's own showcase page 404'd and GitHub search only catches repos with "stocklana" in name/description — this is not a complete census; worth a manual re-check nearer the deadline.

Sources: [github.com/martymedia/after-hours](https://github.com/martymedia/after-hours), [after-hour.net](https://after-hour.net), [hackathons.solana.com/hackathons/stocklana](https://hackathons.solana.com/hackathons/stocklana), [github.com/khalydmaina/fairfill](https://github.com/khalydmaina/fairfill).

---

## Q5 — Bounty feasibility (30 min each)

**(a) Meteora DBC — Recommendation: IN** (with an unverified assumption flagged). Meteora's Dynamic Bonding Curve is config-driven: partners set a `PoolConfig` with `quoteMint`, curve shape, fees, `migrationQuoteThreshold`; docs state "launch partners can have different configurations...including customizable quote tokens (SOL/USDC/JUP/etc)" and the config has a `tokenType` field (0=SPL, 1=Token-2022) ([docs.meteora.ag](https://docs.meteora.ag/developer-guide/guides/dbc/bonding-curve-configs), [github.com/MeteoraAg/dynamic-bonding-curve](https://github.com/MeteoraAg/dynamic-bonding-curve)). All public examples use SOL/USDC/JUP as quote only — **whether an arbitrary equity mint is accepted as quote token on-chain is unverified**, not confirmed either way; would need an actual on-chain config test, not done in this timebox. "Tuned for equity-like assets" = a custom curve shaped for low volatility/slow discovery, a flat/low `baseFee` schedule instead of aggressive early-trade fees, a `migrationQuoteThreshold` set for equity-scale market cap, and a 0.25–0.3% post-graduation fee tier.

**(b) PreStocks — Recommendation: IN**, with verification caveats. `prestocks.com/api/prestocks` returns ~8 pre-IPO tokens (name, symbol, mint, mark price, supply, market cap) — real, live mints backed 1:1 by SPV exposure to private companies (SpaceX, OpenAI, Anthropic, Anduril), launched 7 Aug 2025, $544M+ cumulative volume ([solanalevelup.substack.com](https://solanalevelup.substack.com/p/prestocks-on-solana-guide), [solanafloor.com](https://solanafloor.com/news/pre-stocks-success-on-solana)). Example mints surfaced (pulled via API, **not independently cross-checked against Solscan in this pass — re-verify before depending on them**): ANDURIL `PresTj4Yc2bAR197Er7wz4UUKSfqt6FryBEdAriBoQB`, ANTHROPIC `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw`, SPACEX `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh`. No public documentation found mentioning Token-2022 or any of the Q1 extensions for PreStocks — informative by absence but not a direct on-chain check; **verify with a live mint read the same way Q1 did before relying on this.**

**(c) Clawpump — Recommendation: OUT.** "Clawpump" (clawpump.tech, github.com/Clawpump) turns out to be an unrelated project — a gas-free launch layer for pump.fun tokens for autonomous AI agents (CLAW token), with no mention of stock-paired pools anywhere in its site or docs. The actual "stock-paired pool" feature in the ecosystem is **pump.fun's "Custom Pairs"** (announced 9 Sept 2026 — [thedefiant.io](https://thedefiant.io/news/defi/pump-fun-lets-creators-launch-coins-priced-in-tokenized-stocks)), letting creators price memecoins against tokenized stocks/BTC/ETH/metals instead of SOL/USDC. Cost/fee specifics for that feature were not retrievable in the timebox (source X post returned HTTP 402). This bounty as literally named is a dead end; if the intent was pump.fun Custom Pairs, that deserves its own separate 30-minute pass.

---

## Q6 — Settlement shape

### Method
Built the real instructions (`ComputeBudget.setComputeUnitLimit` + N × `Token2022.TransferChecked` against the live AAPLx mint) and measured actual serialized transaction size and `simulateTransaction` compute-unit consumption on mainnet, rather than estimating from spec docs.

### Findings

**Compute is not the binding constraint.** A batch of 50 self-transfers (same source/dest account, isolating per-instruction CU cost) consumed **176,557 CU total** — roughly **3,400–3,700 CU per `TransferChecked`** — nowhere near the 1.4M CU ceiling obtainable via `ComputeBudget.setComputeUnitLimit`. Even 100+ transfers would fit the compute budget easily.

**Transaction wire size (1232 bytes) is the binding constraint**, and it's driven by account count, not instruction count. With one distinct counterparty account per order (the realistic case — every order settles to a different user's ATA) plus the shared mint, PDA-vault source, and fee payer:

- N=19 distinct-counterparty transfers → 24 total accounts → **1,203 bytes (fits, under the 1232-byte limit)**
- N=20 → 25 accounts → **1,252 bytes (exceeds the limit, rejected)**

So on a plain (no address-lookup-table) transaction, **max N ≈ 18–19 orders settled per transaction** for a mint with today's extension set (no active transfer hook — every hooked mint would need 4–5 extra accounts per transfer for the hook program + extra-account-metas, roughly halving this to ~8–10 orders/tx if a hook is ever wired up on these mints, per Q1's finding that the hook authority is live but unset).

**Design implication, measured not estimated:** an auction clearing more than ~18 orders needs either (a) an **address lookup table** (ALT) — since ALT compresses a repeated/pre-registered account reference from 32 bytes to 1 byte, this could plausibly push practical N well into the dozens-to-~100+ range within the same 1232-byte limit (not executed in this pass — ALT creation/warmup needs an on-chain write and slot delay, out of scope for Phase 0's read-only constraint, but this is the concrete next test for Phase 1), or (b) a **batched/crank-driven settlement**: one clearing computation, N/18 settlement transactions submitted by a crank/keeper, each pulling its slice of matched orders. Given (a) is unverified and (b) is guaranteed to work with what's measured today, **default the Phase 1 design to crank-driven batched settlement**, with ALT as a size-optimization to prototype early since it directly changes the target batch size.

---

## Q7 — Environment

**No devnet/testnet deployment exists for any candidate issuer.** xStocks (Backed Finance) launched directly on mainnet 30 June 2025 as real custodied assets; the same holds for Backpack Securities, Sunrise, Ondo GM, Superstate, Securitize, PreStocks — no public devnet mint or sandbox found for any of them, and given these are regulated, custodied real-asset products, a devnet mirror is unlikely to ever exist. **Build and test against mainnet from day one, with small real positions.**

**Acquisition route:** buy SOL/USDC on a KYC'd exchange (Coinbase/Kraken/Bybit — Kraken and Bybit also list xStocks directly), move to a self-custody wallet, swap USDC→target ticker via Jupiter (jup.ag), which shows live price-impact/slippage before signing. KYC is required only at the fiat on/off-ramp; the on-chain swap itself is permissionless. For genuinely thin names (the Q2 candidates — JPMx, IBMx, etc.), expect real price impact on even a $5–10 buy given sub-$20k pool TVL; check the Jupiter quote live before executing.

**Cost:** SOL ≈ $100–105 at time of writing (CoinMarketCap/Coinbase/CoinGecko, cross-checked live). Program deploy rent-exempt cost scales with binary size (~0.00000348 SOL/byte-year); a modest Anchor program (~200–400KB) typically needs **~2–4 SOL** for the deploy buffer, plus negligible rent for a handful of small PDAs/token accounts. These deployment-cost figures are rule-of-thumb from public write-ups, **not independently confirmed against a live `solana program deploy --dry-run`/`solana rent` call in this pass** — do that check on day 1 before finalizing a budget.

**Recommended budget before Phase 1:** **~5 SOL (~$500–550)** — 3–4 SOL for deploy + 2–3 redeploy iterations, remainder for account rent — plus **~$20–30 in USDC** to acquire small positions in two thin xStocks tickers via Jupiter, with buffer for price impact on illiquid pools.

Sources: [Backed Finance xStocks launch](https://backed.fi/news-updates/xstocks-are-going-live-tokenized-stocks-for-the-defi-era), [QuickNode xStocks writeup](https://blog.quicknode.com/xstocks-solana-tokenized-stocks-2025/), [Jupiter/xStocks partnership](https://thecurrencyanalytics.com/altcoins/jupiter-and-xstocks-partner-to-bring-real-world-assets-to-solana-defi-ecosystem-184331), [Solana rent calc explainer](https://medium.com/@onchana01/how-to-calculate-rent-sol-for-solana-mainnet-program-deployment-2bf8130f1b9a).

---

## Summary / go-no-go signal

- **Q1 (kill question) does not kill the project.** PDA custody works today, empirically confirmed on mainnet, for both xStocks and Backpack Securities mints, with zero issuer action needed. The one live risk (permanent delegate seizure rights) is a compliance backstop to disclose, not an operational blocker.
- **Q2** gives real thin-name candidates (JPMx, IBMx, ORCLx, UNHx, XOMx, NVDAon) distinct from the liquid names (SPYx, SPCX) — the thesis's target market exists and is identifiable today.
- **Q3** confirms the core mechanism-design opening directly: Pyth equity feeds freeze (non-`Trading` status) outside market hours by default on the free tier, which is exactly the gap a periodic call auction with a defensible last-trusted-price + freshness gate is built to serve. Depth of coverage on thin names specifically is an open question worth a follow-up check before Phase 1 lock-in.
- **Q4** shows low collision risk on the actual mechanism; one naming-proximity concern (`fairfill`) worth being aware of, not avoiding.
- **Q5**: Meteora DBC and PreStocks worth pursuing further (both IN, both with a specific unverified assumption flagged to close first); Clawpump as named is a dead end (OUT).
- **Q6** gives a measured, not guessed, design constraint: ~18 orders per plain settlement transaction, crank/batched settlement required beyond that, ALT as the concrete lever to test first in Phase 1.
- **Q7**: mainnet-only from day one, budget ~5 SOL + $30 USDC before starting the build.
