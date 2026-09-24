---
title: Addresses
description: The program, the devnet fixture mints and their mainnet counterparts, Pyth accounts and feed IDs, and the other accounts these docs refer to.
---

## Program

| | Address |
|---|---|
| Uncross program (devnet) | `Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP` |
| Program data account | `7Kqq9XySMiYy7H9kucgaF2Vp6oeaE66B1tRYfGUTZv2` |
| Deploy wallet (also every fixture authority) | `68N5a3Nj5u7Kc5RPiyu4iH3qVLN1A7wu1fEWErNtqLJf` |
| Test dollar, USDC-shaped (devnet, legacy SPL Token, 6 decimals) | `22BrsoDTwXigFmNnMRxfTQ66ksS4SgP5k5k9UcdrRP87` |

## Tickers

The ten tickers the keeper runs on cadence. Each devnet mint is a fixture built to match the mainnet mint's extensions ([Why devnet](/devnet/why-devnet/)). "Starting multiplier" is the real mint's scaled-UI value that the fixture began at.

| Ticker | Devnet fixture mint | Mainnet xStocks mint | Starting multiplier |
|---|---|---|---|
| AAPLx | `BvgVkJawYWrWV2eu5ousJUvGWwbgDTUdyr9vBM27BYYG` | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | 1 |
| NVDAx | `3RxkqMiy9HfUy3o7BK8ddDAXMG657G8DwxmM5jPFjxDf` | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | 1.001701196801074 |
| TSLAx | `2jrNK6LZuYWvEHUDGCFMy9JXU4Jm6yeJyo5MQoBHaLq8` | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | 1 |
| GOOGLx | `7iMhoW3cyCqDZEf4igymXcTdTZssnu9TgJ7zRGBoxENH` | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | 1.0023772500603487 |
| MSTRx | `Ce75fFHggBEZUbX4wf22aqKmfT3CGQYRvCMcxgeK9Gjb` | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | 1 |
| HOODx | `HF6GmjQcLtRUbGqxeg5w9BLc4fM1HbwHBGchwqMQmxWa` | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | 1 |
| IBMx | `9aGoR5JbatqRYbc4SpQuT3pWVLPhZQJvDq26FFb23Jzp` | `XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr` | 1.015340763856885 |
| XOMx | `CqroxNgfVuwP3m3JCtsACjTjFhBCp81wGzhbrbwc3Xn3` | `XsaHND8sHyfMfsWPj6kSdd5VwvCayZvjYgKmmcNL5qh` | 1.017648970535191 |
| JPMx | `CnbwXPGAaf9EbtssepFPMZDFvkZj7F9VA4JAtUzV4h7g` | `XsMAqkcKsUewDrzVkait4e5u4y8REgtyS7jWgCpLV2C` | 1.0139174713894084 |
| ORCLx | `8PzDX9hBMwTc7VpkisVqvH26G6BXBtu6Y8QkSfLzWMpM` | `XsjFwUPiLofddX5cWFHW35GCbXcSu1BCUGfxoQAQjeL` | 1.009318667481834 |

The AAPLx fixture's multiplier starts at 1, not the real mint's value. The multiplier test needed a clean before and after.

## Pyth

| | Address or ID |
|---|---|
| Pyth receiver program (owner of every `PriceUpdateV2`) | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ` |
| Pyth push oracle program (the keeper finds devnet feed accounts under it) | `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT` |

Mainnet price accounts the app reads, and the feed each auction binds to:

| Ticker | Mainnet `PriceUpdateV2` account | Feed ID |
|---|---|---|
| AAPLx | `D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW` | `49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688` (`Equity.US.AAPL/USD`) |
| NVDAx | `5VETJ8h3p4JrESYrzhjTDAWPEjDjfcnduqe9CjxgqBNd` | `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593` |
| TSLAx | `FQB8c4zB8Emrp9W8bmyk6GanCLq4aRytHYPDAnaEpq9z` | `16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1` |
| GOOGLx | `7aUtbtC3o3GVwRWvaDp5fxKjBq53QL3UrVmDzDgeNo8M` | `5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6` |
| MSTRx | `KDQSrjsiur6YxyuY4veB7Gd13MKhwNoMZTQWvx1c93S` | `e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09` |
| HOODx | none on Solana | `306736a4035846ba15a3496eed57225b64cc19230a50d14f3ed20fd7219b7849` |
| IBMx | none on Solana | `cfd44471407f4da89d469242546bb56f5c626d5bef9bd8b9327783065b43c3ef` |
| XOMx | none on Solana | `4a1a12070192e8db9a89ac235bb032342a390dde39389b4ee1ba8e41e7eae5d8` |
| JPMx | none on Solana | `7f4f157e57bfcccd934c566df536f34933e74338fe241a5425ce561acdab164e` |
| ORCLx | none on Solana | `e47ff732eaeb6b4163902bdee61572659ddf326511917b1423bae93fcdf3153c` |

The AAPL feed's other variant, `Equity.Index.AAPL/USD` ("24/7"), is `aaba35e6f33fb973bb2201d48a79ae24795affa6ba8bd50a93dcaf7da0030f36`. Uncross does not use it.

## Auctions referred to in these docs

| Auction | What it is |
|---|---|
| [`6RmfQTeT…Npqxyhf7`](https://explorer.solana.com/address/6RmfQTeTvshtDLQTJLpqRv8iZDTWzphXhp2fNpqxyhf7?cluster=devnet) | The 23 Sept MSTRx cross with outside participants |
| [`Dw4UdSGL…ttm8nt8U`](https://explorer.solana.com/address/Dw4UdSGL6fvCPu6QuC8s7RkLv6gLETHzbaaLttm8nt8U?cluster=devnet) | The 247.50 worked example |
| [`C8pGy4va…SuMff3Mb`](https://explorer.solana.com/address/C8pGy4va4btnEQTMbbptnwiFNxnoH2d9md5tSuMff3Mb?cluster=devnet) | The 42-wallet stress test |

## Tokens that cannot be supported

| Token | Mint (mainnet) | Transfer fee |
|---|---|---|
| tOpenAI (Tessera) | `oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ` | 20 bps |
| tKalshi (Tessera) | `TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ` | 20 bps |
| tSpaceX (Tessera) | `TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v` | 20 bps |
| ANTHROPIC (PreStocks) | `Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw` | 100 bps (was 50) |
| OPENAI (PreStocks) | `PreweJYECqtQwBtpxHL171nL2K6umo692gTm7Q3rpgF` | 100 bps (was 50) |
| SPACEX (PreStocks) | `PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh` | 100 bps (was 50) |

<p class="sources">Sources: <code>uncross/scripts/tickers.json</code>, <code>uncross/scripts/devnet-fixture.json</code>, <code>docs/devnet-fixture.md</code>, <code>docs/phase1.md</code>, <code>docs/pyth.md</code>, <code>docs/phase2.md</code>, <code>uncross/scripts/keeper.mjs</code>, <code>web/src/config.ts</code>.</p>
