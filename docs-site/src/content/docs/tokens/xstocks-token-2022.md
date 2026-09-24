---
title: xStocks and Token-2022
description: The eight Token-2022 extensions every xStock mint carries, and what each one means for shares held in an Uncross escrow.
---

**xStocks** are tokenized US equities issued by Backed Finance, such as AAPLx and IBMx. Each is a token on Solana backed by the underlying share. All of them are **Token-2022** mints: Solana's newer token program, whose mints can carry **extensions**, built-in features that every holder is subject to.

## The same eight extensions on every mint

The AAPLx mint on mainnet (`XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp`) was read directly from chain, not from documentation. It has 8 decimals and eight extensions. On 23 Sept all **1,026** xStocks mints on Solana were checked. Every one carries the identical set, under one authority:

| Extension | What it does | What it means for your escrowed shares |
|---|---|---|
| **Permanent delegate** | The issuer's delegate key can move or burn tokens in *any* account, without the holder's signature. | Applies to shares waiting in an Uncross vault exactly as it does to your wallet. |
| **Pausable** | The issuer can halt every transfer of the token, mint-wide. | While paused, escrowed shares cannot move: not to settle, not to refund. Dollar refunds still work. |
| **Scaled UI amount** | A multiplier between the raw token amount and the displayed amount. Issuers use it for stock splits. | None. Uncross holds and settles raw amounts only ([Raw amounts and splits](/tokens/raw-amounts/)). |
| **Transfer hook** | Lets the issuer attach a program that runs on every transfer. Present on every mint, but set to no program (`programId: null`). | None today. See below. |
| **Default account state** | New token accounts start `initialized`, not frozen. | The auction's vaults work immediately, with no issuer action. |
| **Confidential transfer** | Optional encrypted balances, opt-in (`autoApproveNewAccounts: false`). | None. Ordinary transfers are unaffected. |
| **Metadata pointer** | Points to where the token's name and symbol live (the mint itself). | None. |
| **Token metadata** | The name, symbol and URI. | None. Nothing on chain reads it. |

Every mint also has a **freeze authority**, and none has a **transfer fee**. The fee matters: tokens with transfer fees cannot work in this escrow ([Tokens we cannot support](/tokens/unsupported/)).

## Can a program hold these tokens at all?

Yes, and this was the first thing checked, because the project depended on it. A token account owned by a program-derived address was created against live mainnet state in a simulation, for AAPLx and for a Backpack Securities token. It succeeded with no issuer involvement. The runtime itself printed one warning: *"Mint has a permanent delegate, so tokens in this account may be seized at any time."*

## What the issuer can do to your escrow

Uncross holds your shares and dollars between placing an order and settlement. That escrow sits under the token issuer's rules, not only the program's.

**The issuer can pause the token.** While it is paused, nothing can move those shares. Uncross fails safely. Settlement fails atomically, with nothing half-settled. The auction can be wound down on the refund path. Dollar refunds go out even while the token is paused, because the test dollar is a different mint. Share refunds go out as soon as the pause lifts. This was tested for real on devnet ([Test: pause mid-auction](/devnet/pause-test/)). What Uncross **cannot** do is give you your shares back during a pause.

**The issuer can take tokens from any account, including escrow.** The permanent delegate is a regulatory control, and it applies to shares in an Uncross vault just as it does to shares in your wallet.

**The issuer could switch on a transfer hook.** The hook authority is live and the hook program is merely unset today. Setting one would add accounts to every transfer. Settlement batches would then fit fewer orders per transaction, roughly half as many by the Phase 0 measurement.

None of this is specific to Uncross. It is how these assets work everywhere on Solana.

<p class="sources">Sources: <code>docs/phase0.md</code> Q1 (mint reads, PDA custody simulation), <code>docs/devnet-fixture.md</code>, <code>README.md</code> (What this doesn't solve), <code>docs/submission-draft.md</code> (1,026 mints, identical extension set), <code>docs/phase1.md</code> (pause test).</p>
