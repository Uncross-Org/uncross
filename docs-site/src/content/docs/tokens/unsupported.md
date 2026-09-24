---
title: Tokens we cannot support
description: Tokens with an active transfer fee break escrow balance. PreStocks (100 bps, raised from 50) and Tessera (20 bps) are out for that reason.
---

## Why a transfer fee breaks escrow

Token-2022 lets an issuer charge a **transfer fee**: a percentage withheld from every transfer. The escrow design assumes the vault receives exactly what the order escrows.

With a fee, a seller escrowing 10 tokens delivers less than 10 to the vault, while the program records 10. Every outbound transfer at settlement withholds the fee again. The ticker side of settlement goes short, and the last payouts fail. The program was deliberately not extended to handle fees.

Custody is not the problem. A program-owned token account for these mints simulates fine. The fee is the problem.

## PreStocks: 100 bps

PreStocks tokens give exposure to private companies (for example SpaceX, OpenAI and Anthropic). All 8 mints listed by PreStocks' own API were read live on mainnet.

- **Fee on 24 Sept 2026 (epoch 1041): 100 bps, uncapped, and being withheld.**
- **It was 50 bps earlier.** The first reading, during Phase 2, found 50 bps. The fee was **raised from 50 bps to 100 bps at epoch 1039**.

Everything else about the mints would work: Token-2022, 9 decimals, ten extensions, the transfer hook disabled, new accounts initialized, not paused, and a PDA-owned token account simulates fine.

## Tessera: 20 bps

The three verified Tessera mints are tOpenAI (`oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ`), tKalshi (`TKLSidmLVt3cqGaaodG8tyRzoANfQwoh67AccjmubeZ`) and tSpaceX (`TSPXcLV76s6V2zDiZQ18kBfcbnjaE2ZzNT3ga2Pd99v`). They are identified by Jupiter's `tessera` tag, issuer tessera.pe. They are Token-2022 with only a transfer fee and metadata.

- **Fee: 20 bps**, uncapped, active since epochs 918–987.
- 9 decimals; a PDA-owned token account simulates fine.

## A second change they would need

Both use **9 decimals**. The dashboard's unit conversion assumes xStocks' 8. Supporting them would take that change as well as fee-aware escrow.

## What would support them

Fee-aware escrow: recording what the vault actually received rather than what was sent, and grossing up or netting down every settlement transfer. That is a program change. It was not made for this hackathon.

<p class="sources">Sources: <code>docs/phase2.md</code> (Task 2, first reading at 50 bps; and "Re-verified 24 Sept 2026: PreStocks and Tessera, both still out"), <code>uncross/scripts/read-mints.mjs</code>.</p>
