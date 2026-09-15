Context. New project. Solana mainnet. Entry for the Stocklana hackathon (Solana Foundation), submissions close Friday 18 September 2026, 4:00pm ET. Solo build, ~3.5 days. This project is intended to continue past the deadline as a Colosseum Crypto World's Fair entry, so treat it as a product, not a demo.

Thesis. A periodic call-auction venue for thinly traded tokenized equities on Solana. Continuous AMM pricing is bad for thin books: a retail-sized order moves the price against itself. A call auction gathers all orders arriving in a window and fills them at a single clearing price. Framed for the user as fair fills when the market is thin and Wall Street is closed — not as mechanism design. Context: 63% of tokenized-equity volume on Solana settles outside US market hours; holder count crossed 800k on 12 Sept.

Phase 0 only. Write no program code, no frontend, no scaffolding. Output docs/phase0.md with findings, each with the source (mint address, doc URL, RPC response) inline. Report and stop.

Q1 — KILL QUESTION. Token program and extensions. For every candidate stock mint (xStocks, Backpack Securities, Sunrise, Ondo, Securitize, Superstate), determine: SPL Token or Token-2022; and exactly which extensions are enabled. Specifically check DefaultAccountState (frozen-by-default), TransferHook, PermanentDelegate, NonTransferable, ConfidentialTransfer, TransferFee. Read this from the mint account on mainnet, not from docs.

Then answer the operational question directly: can a program-owned PDA receive and hold these tokens without issuer action? Test it — derive a PDA, attempt to create its associated token account for a real mint, report what happens. If it cannot, check whether approve/delegate works under the same extensions, since that's the fallback design (user retains custody, settlement pulls at clearing time). Report per-mint; do not generalise from one.

Q2 — Candidate universe. List ~20 tokenized equity mints with 24h on-chain volume, available liquidity, and observed spread. We want the thin names, not NVDAx. Report numbers, and flag which have enough of a market that a call auction is pointless.

Q3 — Reference price. What on-chain oracle coverage exists for tokenized equities (Pyth or otherwise)? Does it cover the thin names or only mega-caps? What's the update behaviour after the US close — does it go stale, hold last close, or keep moving? We need a defensible reference price and a freshness signal.

Q4 — Field check. Review what's already submitted. In particular github.com/martymedia/after-hours is live and covers after-hours drift plus Jupiter routing. Report what's taken so we don't collide.

Q5 — Bounty feasibility, timeboxed to 30 min each. (a) Meteora DBC: can a tokenized stock be the quote token? What would a curve or graduation rule tuned for equity-like assets concretely mean? Their docs MCP is at docs.meteora.ag/mcp. (b) PreStocks: prestocks.com/api/prestocks — what does it return, are the pre-IPO tokens transferable SPL/Token-2022 tokens, do Q1's answers apply to them? (c) Clawpump: what does launching a stock-paired pool actually cost in time and capital? Recommend in or out.

Q6 — Settlement shape. How many orders can be settled in one transaction, realistically, given compute budget and account limits? Report max N, and whether a larger auction needs a batched or crank-driven settlement. This number decides our design, so measure it, don't estimate it.

Q7 — Environment. Do any of these stock tokens exist on devnet? If not, we're on mainnet from the start — report the cost and route to acquire small amounts of two thin stock tokens plus deployment SOL.

Standing rules. Commits carry Jagadeesh B's name only — no co-author trailers, no generated-with lines, in commits or PRs. No git init until instructed.