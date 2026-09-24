---
title: Transaction index
description: Every devnet transaction cited in these docs, grouped by the test or event it belongs to.
---

All transactions are on Solana **devnet**, and each link opens Solana Explorer. Before these docs were published, every signature below was checked against devnet ([how](#how-this-list-was-checked)).

## The MSTRx cross, 23 Sept: the auction with outside participants

Three orders from three wallets, two placed by people other than the builder. Walked through in [Verify a clearing price](/trust/verify/).

| Step | Signature |
|---|---|
| Cross (`compute_clearing`) | [`2SKcwefY…K75FpLAU`](https://explorer.solana.com/tx/2SKcwefYsGdpquxrgJP2yRdnn2VpyBEL7oV2GdmjBsTFGqqHvP6L58wxMcAsuU7DYnyvhmeJBMRrhMpFK75FpLAU?cluster=devnet) |
| Settlement | [`4ws2ByFq…hNGBKY8A`](https://explorer.solana.com/tx/4ws2ByFqvSJzCVG73iW1D7CRSP8eYNqKBoq2CybQk2a6mdkHK1byo8KpmEnRFBEVWfHtzpYZiJK3RFQahNGBKY8A?cluster=devnet) |

## The community auction, 24 Sept

Announced publicly ahead of time, run on devnet on the regular AAPLx and IBMx books. 11 wallets other than the test bot's placed orders across the two books, and every one got a fill. The bot's own orders were in both books ([Honest limitations](/trust/limitations/#what-the-devnet-results-do-and-do-not-show)). Both prices were set by volume alone, with no tie, so neither the oracle nor the midpoint rule played any part. `verify-auction.mjs` matches both.

**AAPLx.** 24 orders from 13 wallets, 10 of them not the bot. Cleared 53.16 shares at $336.97. Auction [`7uc3uXqH…YYMivcVn`](https://explorer.solana.com/address/7uc3uXqHFRx5eqAbuDV5BUdoimCVYLARQYDCYYMivcVn?cluster=devnet).

| Step | Signature |
|---|---|
| Opened, 12:42:42 UTC | [`5iDs9xEK…6NMMfAnW`](https://explorer.solana.com/tx/5iDs9xEKUt8DmSQ1gSerjfAk9zVasT9oLoRDNDD7NXqoeTWGZuCjc4L6s3YGQcS4k1LVmadHdV4nJz796NMMfAnW?cluster=devnet) |
| Cross, 13:02:06 UTC | [`439jNtYv…wqCHk2wC`](https://explorer.solana.com/tx/439jNtYvUnqosHwJpcgXarVmxSMixB11X43omAsq22pEtGJ8T971Jz6hHjKksnpSvcR7AwBYxwase2J8wqCHk2wC?cluster=devnet) |
| Settlement 1 of 4 | [`3GVouS2V…N9Bv9ckH`](https://explorer.solana.com/tx/3GVouS2VuyK4pYWRUGv6nX147uKjBcSEcy5os9AU9Ti2veBgadRSKcNob2JyqL5m4o9b9aQEw3GmwtQ4N9Bv9ckH?cluster=devnet) |
| Settlement 2 of 4 | [`44yyhpbt…JwDgfXc8`](https://explorer.solana.com/tx/44yyhpbtEMVzZueTxhZe8teC5bkaQsEqabMtENxLSV1cue8ycA2NrhuZhaxVNVZwSgkgLR4Rc69i797HJwDgfXc8?cluster=devnet) |
| Settlement 3 of 4 | [`3X5M32Ea…7irP2hJY`](https://explorer.solana.com/tx/3X5M32Ea33bM7cjUVsPWfdNERq8r7PMcJgxdUMK1PbCSPMTsrH3M34Duw1rEXjUCxj4uE5ejqpSQskUt7irP2hJY?cluster=devnet) |
| Settlement 4 of 4 | [`BWTFG3M8…4tB7Go2P`](https://explorer.solana.com/tx/BWTFG3M8qdGgWcLr4xLm3YdDL9vjSp9FANaVDuR1R1sgBC6h7gWHN65P7VKMt1ZotkiowLj25asMeCc4tB7Go2P?cluster=devnet) |

**IBMx.** 20 orders from 12 wallets, 9 of them not the bot. Cleared 28.97 shares at $207.27 a share. That is $210.44968 per token × 28.53 tokens on chain, at IBMx's multiplier of 1.0153. Auction [`JgkL8nLK…WBe6WnwD`](https://explorer.solana.com/address/JgkL8nLKuFA2rGRCjmFy2EC75mxpZXsXYumWBe6WnwD?cluster=devnet).

| Step | Signature |
|---|---|
| Cross, 12:58:33 UTC | [`2MvdyHfb…ymrSCk1K`](https://explorer.solana.com/tx/2MvdyHfbfVtnJ578cTWs1ZW9VXYUEHMxKNL7VLmzqc3Fd17kKiYqE1fNmfcDSQGrRgHNKXRDcg3LXkNxymrSCk1K?cluster=devnet) |
| Settlement 1 of 3 | [`5FffySLM…Fi6iuJew`](https://explorer.solana.com/tx/5FffySLMGViJLqi3yJw6MTyF86wmbpwb6zFv9rFNjDUoMpcuhCbqUF5tpm3g1fx5nT2KPnSELio4Y9XqFi6iuJew?cluster=devnet) |
| Settlement 2 of 3 | [`62e7BqRi…S5mgHLeD`](https://explorer.solana.com/tx/62e7BqRi7LtCr1iTqTGpnuRWg43VYe5LGScybkYVK4PnPisNubqAgwCV1huKZk3kDvhWKZ4JiMXWEvuqS5mgHLeD?cluster=devnet) |
| Settlement 3 of 3 | [`3xyXxwjR…gHQJxko4`](https://explorer.solana.com/tx/3xyXxwjRaayZULnJxoVdPMPBDG1MGEpKkMX3dEvTwRj7Majw9zpTAmkAcz7zdfr1kZ4a6DBooZgrhemHgHQJxko4?cluster=devnet) |

The Pyth check recorded "stale" for AAPLx and "wrong owner" for IBMx, which has no Pyth account ([What Pyth is used for](/pyth/role/#what-actually-happens-on-devnet)).

## A real browser wallet on the live site, 24 Sept

A wallet that had never existed, in a fresh browser, through Wallet Standard. It took a faucet grant and placed two orders through the page.

| Step | Signature |
|---|---|
| Cancel while open (accepted) | [`5xuRETXF…FJPT3eNg`](https://explorer.solana.com/tx/5xuRETXFQpt6DvstKBPnRZuh6NhyFk7TeoSsWXnwi49MgchrHs3sKmM9rDzhdcygT7L8NwFg4eTZk65kFJPT3eNg?cluster=devnet) |
| Cancel sent straight to the program once frozen (refused on chain, `PastFreezeWindow`) | [`wzwxgAAi…GyaZ3ikF`](https://explorer.solana.com/tx/wzwxgAAigSUqiMhgrABrjSiUuS8CT3phv7YpLbANdsoA46b1FwQhxwCAxxUWDjHP1kJU74d5cCqfKnTGyaZ3ikF?cluster=devnet) |
| Settlement of the second order, shown on its receipt | [`sf9HDGvT…6uQt4Lbf`](https://explorer.solana.com/tx/sf9HDGvT1VPE8PksBqjY4o89PATQkh8q2ZJarPSuqestVwKD1M54LgvqJmLB67DJ7eYmTBWZ92GQVLb6uQt4Lbf?cluster=devnet) |

The script that drives it is `uncross/scripts/order-path-browser.mjs`.

## The worked example: 247.50, on the upgraded program

Auction [`Dw4UdSGL…ttm8nt8U`](https://explorer.solana.com/address/Dw4UdSGL6fvCPu6QuC8s7RkLv6gLETHzbaaLttm8nt8U?cluster=devnet). See [The clearing rule](/mechanism/clearing-rule/#a-real-auction-worked-by-hand).

| Step | Signature |
|---|---|
| `initialize_auction` | [`3bkfFfn9…vRD4EZBJ`](https://explorer.solana.com/tx/3bkfFfn9jtoxL7pGE3oHh18jRfz6KrPqrEXMnmij4eU6b3QKRzcPnkp7Ukd2L77JzjTinYZmkm8hzxy2vRD4EZBJ?cluster=devnet) |
| `compute_clearing` | [`4xEomFan…85X3Ve1T`](https://explorer.solana.com/tx/4xEomFanmDX8fwhSdoXZ74jMNiDqw1bkYVDZzhx6reL2RdtspFN3yefP7Kn6kGCrgLMtqavPDt1iHNby85X3Ve1T?cluster=devnet) |
| `settle_batch` [0..5] | [`4bJG1KMZ…1BnU8jCv`](https://explorer.solana.com/tx/4bJG1KMZx3gvAEReQBeXxmHpAWE8L2rvDuiJdbqf5obBXr8sQRXun4jD8CGxJPimEKV6Z5UYyfghR5Mr1BnU8jCv?cluster=devnet) |
| Program upgrade to the zero-copy layout | [`2Q14KghF…MciKRmCW`](https://explorer.solana.com/tx/2Q14KghFp6tjjuAxXsT1BCtm5jPJmRoA7XFftsw56AJikPf73fvcGvdEgdrw2S826MSVo2Xm1w2kYNXKMciKRmCW?cluster=devnet) |

## The same book, first run (Phase 1)

Auction `Bddkdu6qTgVNiMecNLZrd1yYQdTEYuk5qft7B9Bt43U4`, on the original program. This account uses the earlier, smaller layout and does not decode with today's.

| Step | Signature |
|---|---|
| Program deploy | [`3gNrx6wH…pd3y1hcv`](https://explorer.solana.com/tx/3gNrx6wHiZtb64dq81kicJibnph1usbXmKVjvgdJvWe3Mts86jaRf3YD4JFRYhD5SKQpD7BHaAnghrV2pd3y1hcv?cluster=devnet) |
| `initialize_auction` | [`4LWcYzZD…kNpSCCJt`](https://explorer.solana.com/tx/4LWcYzZDXugUqRteR7ZxbJnZgjnPfxFgWnDRrizaVrRKkAcUx8N4BYi23ayv4DirGVjyncZtwAf7aAmMkNpSCCJt?cluster=devnet) |
| `place_order` #0 (sell 10 @ 240) | [`2HMSToea…DBDrwfQ1`](https://explorer.solana.com/tx/2HMSToeaLgmJkNVoUSZVXPLzNxTX5c4wMnQ1Ajy5wd9CY899CgLgQRwKMHhM3j3cZeB7GuFPRH85gGBkDBDrwfQ1?cluster=devnet) |
| `place_order` #1 (buy 10 @ 250) | [`2ZE9hmg1…oJH7U25g`](https://explorer.solana.com/tx/2ZE9hmg1uab7ZyFwPGCFJX5HEjeWpjpBeEVd32BughYY2dR1QwTUX3kaZZrc71gDpnbL4QwBhrN8HjHroJH7U25g?cluster=devnet) |
| `place_order` #2 (sell 5 @ 245) | [`32GZvbu4…iZB35AwG`](https://explorer.solana.com/tx/32GZvbu41fynTUgQgW4aQKARCxuvJQA5Ni9xMRgDhDKp3ULrwAt8ikjFgGjPyinapT847tqm8xkikzxGiZB35AwG?cluster=devnet) |
| `place_order` #3 (buy 8 @ 243) | [`4gNatvg7…ggoUVAjs`](https://explorer.solana.com/tx/4gNatvg7Dg2KrNFhHMqPPkkEk5ZWHP9XCJMsoLgEiPXg3vfgHgUG8j8LgwGTZYxXR2SLeaPM2GkiFX1aggoUVAjs?cluster=devnet) |
| `place_order` #4 (sell 1 @ 300) | [`3W7x1fub…v5tzYEQz`](https://explorer.solana.com/tx/3W7x1fubkjaYRGwDuvQ4qZ2va2RDGQntNY9xgSmQR6tW9YYK2E48yuJyjdutec5YaVzDKiJx9GSmmw89v5tzYEQz?cluster=devnet) |
| `cancel_order` #4 (before the freeze) | [`5Vk6fZ9J…G5daYvHC`](https://explorer.solana.com/tx/5Vk6fZ9J7LCNgfox1b1SShVNEJachSoGFFVNaGV9imm3pvWQP24J4K2Ck5zSHJif918mnAkzeB2CtsJ9G5daYvHC?cluster=devnet) |
| `place_order` #5 (sell 1 @ 310) | [`Kb2u57eG…qqh6beQ5`](https://explorer.solana.com/tx/Kb2u57eGwU7uLPr4yF84FA9LHqCc5djoDiHws8HTY9ikeSTFztZxzEgHWhSN8ie9976opJVBhLJicCVqqh6beQ5?cluster=devnet) |
| `cancel_order` #5 (in the freeze) | refused, `PastFreezeWindow`; no transaction landed |
| `compute_clearing` | [`324CU6VC…UPeyFL3P`](https://explorer.solana.com/tx/324CU6VC5pTuFzFTiXgj5iUkWofFqNocak41m4mDt39i5yEgnQNaeCzDcvYJCr2VAuk1VsVCjnT4pe5nUPeyFL3P?cluster=devnet) |
| `compute_clearing` again (no-op) | [`5QzRNSSQ…yYy4kv9c`](https://explorer.solana.com/tx/5QzRNSSQaLxCRTRgkXvr11prMjheVYgDLXSZXmezn7df9VF8fvJKsPefw1BXteRwQAvJGWaFM7yixAA2yYy4kv9c?cluster=devnet) |
| `settle_batch` [0..5] | [`2QkuCd6V…khqCifhF`](https://explorer.solana.com/tx/2QkuCd6VfKoRhk4yRZSWVBqmbsPocDLdrwAwhy3VSCGEr6uw4A1Z4GwJmC2PaKjL8pWdN7MNaAFkGQuqkhqCifhF?cluster=devnet) |

## Pause and split tests

Listed in full, with what each step showed, in [Test: pause mid-auction](/devnet/pause-test/#signatures) and [Test: split mid-auction](/devnet/split-test/#signatures).

## Settlement at scale

The 42-wallet stress run is listed in full in [Test: 42-wallet settlement](/devnet/settlement-at-scale/#signatures).

The earlier 38-order, 38-owner book was cranked to completion by the production keeper (auction `9uBAAY4gFtD9kG9EPYb8oU9wExRdkGRKmejqERk4r74V`, cleared at 100.37 × 190):

| Step | Signature |
|---|---|
| `compute_clearing` | [`3PqGDbUV…mxuubbVP`](https://explorer.solana.com/tx/3PqGDbUVEeTUrs1fmMDuRUjVun69A7pZJBi56rAvzbNHq2H7WNXaAoeaoA83YDqey8gjTYwojAJCMGy3mxuubbVP?cluster=devnet) |
| settle [0–6] | [`2zSMaAAc…6CxUtzWh`](https://explorer.solana.com/tx/2zSMaAAc5X5jzkKNUuAuLwbfQMR6j8JR1WYbf6xahGNGVZ53MtPsNRbgShPvBmQhbKv2Dmg6ymeGticY6CxUtzWh?cluster=devnet) |
| settle [7–13] | [`3gsdcCko…D1GxzbCC`](https://explorer.solana.com/tx/3gsdcCkovRwJo95xHomt4azqxhv8MBjAuAwfMa6hjSoaULHr5SDk4amXQedzcys9QwJ9zzj8dNTdakfwD1GxzbCC?cluster=devnet) |
| settle [14–20] | [`4GW28JuC…5WjqJ5BK`](https://explorer.solana.com/tx/4GW28JuCAnCqQiJycMEc1RvXHz4MGW5WNnqNBWp76HX7xvCu3w9wHxpMx3j2cVKm4gdYbKX5vmK49vAs5WjqJ5BK?cluster=devnet) |
| settle [21–27] | [`wHEm3NBs…CEbE2wGR`](https://explorer.solana.com/tx/wHEm3NBswDCHPtiaDeNfByPHaUCKtTV95jkzJebMHLYAAp6JNSKsuLqqsXEESiFZyYo7NGMbSCdcKowCEbE2wGR?cluster=devnet) |
| settle [28–34] | [`5rYzSPJ7…msTXVBor`](https://explorer.solana.com/tx/5rYzSPJ71eubroNSAmMWhnDQDJWiry6WUBm8xy1L2vW1Gsjmbo4PDzASAG7nYxDEJxBknc1oezEi8MLDmsTXVBor?cluster=devnet) |
| settle [35–37] | [`5jx9PE94…Bsv7fcn2`](https://explorer.solana.com/tx/5jx9PE94CGRm1tBLYFWnzM8JiTX1z754c7QNLRFGEjcsQLPNcTmGwSTBotM9biLLfsj94fouXNGLfpXiBsv7fcn2?cluster=devnet) |

## The web app's own transaction code

The functions the UI calls on click were driven end to end against devnet on the IBMx fixture, with local keypairs standing in for a browser wallet (`web/scripts/wallet-flow.ts`). Sell 3 @ $100, buy 3 @ $110, buy 1 @ $50 then cancelled. Cleared at $105.00 × 3 shares, both vaults zero.

| Step | Signature |
|---|---|
| sell 3 @ $100 | [`2uFQVk7B…GEKLApDV`](https://explorer.solana.com/tx/2uFQVk7BnJJkpPSwuGDuxUZZUtt5pXS8BcSfK7uGVVsBfTBhSzK3VqwehuPwFaxq9E29rXb6CfL9WSPjGEKLApDV?cluster=devnet) |
| buy 3 @ $110 | [`2KGpK3rD…Sgf4mSx2`](https://explorer.solana.com/tx/2KGpK3rDfFZeh2krRdAmahrw2geQMeEKxQVPRENtaU3u1eTSHm6jetXXXbq67D8jds6giDyzoy8zcY5SSgf4mSx2?cluster=devnet) |
| buy 1 @ $50 | [`2NAPv3cn…jfR5vgeZ`](https://explorer.solana.com/tx/2NAPv3cnPBg4xEyaGzR6MVttJ95ZtmcCipX18forw36o1gekguJ6tvRT1NBaiKwJ4fd1Ddatqp3h95Z6jfR5vgeZ?cluster=devnet) |
| cancel #2 | [`2voYdJUa…2B9hZaNY`](https://explorer.solana.com/tx/2voYdJUaiuUytMvajGKdFZ9iYtmGzyt4yUi5GzpYBeDKvbPjTfqVeRFkpJsCFtuAzYdxjSDJfBkaUNcZ2B9hZaNY?cluster=devnet) |
| `compute_clearing` | [`22AZrNnW…x2k1QUmA`](https://explorer.solana.com/tx/22AZrNnWM49asDum4YY5vbfkKw4RmEeuj9dM2jUXtBDmem66ydpzig8QJpQp7hP1mNiqF8C9cXc7EMtJx2k1QUmA?cluster=devnet) |
| settle | [`2jCyg2YV…3z28ZeM4`](https://explorer.solana.com/tx/2jCyg2YV9MYtB3kZNreGwHDcMz2Vk9oJJNSz5ENkMrb1KkLXb3Wdo3UTzuKkN1oxRuz6NT3n8z7aPdaw3z28ZeM4?cluster=devnet) |

## Rent recovery, 23 Sept

120 `close_auction` transactions, returning 2.1994 SOL: the 118 recovered stranded auctions plus two opened on dormant tickers during testing. Every one is listed, with the auction, the rent returned and who sent it, in [`docs/rent-recovery-2026-09-23.tsv`](https://github.com/Uncross-Org/uncross/blob/f7245ea33e019bbcfacfd17ccc6677a1d3bb5f5c/docs/rent-recovery-2026-09-23.tsv). See [Honest limitations](/trust/limitations/#stranded-auction-rent-found-and-mostly-recovered).

| | Signature |
|---|---|
| First close | [`5YdN7KdX…ChFUqsW3`](https://explorer.solana.com/tx/5YdN7KdXG3XEeWR38sV6VWvKWwG5tf6V5aHnsbGsncabU4FxdWTBafhcZA5ijXL8R2HfKRmjY3oCsspsChFUqsW3?cluster=devnet) |
| Last close | [`4r127fgH…LWxUbmCs`](https://explorer.solana.com/tx/4r127fgHpKCu9sBH1LvGNVHXrS2Xr4mA2FaL38NozDpFzTnBXKJR7RVPTAPFGctCNPemGvU2Qm11LCYuLWxUbmCs?cluster=devnet) |

## How this list was checked

The docs site's build check extracts every Explorer transaction link on every page. It asks a devnet RPC for each signature's status, with transaction history search on, and fails if any is not found. The cancel refused with `PastFreezeWindow` above is a transaction that landed and failed, which is how a refusal is recorded on chain. It is expected to show an error.

<p class="sources">Sources: <code>docs/submission-draft.md</code> (community auction, commit <code>70ca5d4</code>), checked against the auction accounts, their order accounts and transactions on devnet; <code>docs/phase1.md</code>, <code>docs/phase2.md</code>, <code>docs/submission-draft.md</code>, <code>README.md</code>, <code>docs/rent-recovery-2026-09-23.tsv</code>.</p>
