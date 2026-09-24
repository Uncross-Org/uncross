// Writes a placeholder page for every sidebar entry not yet written, each
// stating what the page will cover and which sources back it. Run once for
// the structure proposal; never overwrites a page that already exists.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = join(dirname(new URL(import.meta.url).pathname), '../src/content/docs');

const pages = {
	index: ['What Uncross is', 'A periodic call auction for tokenized stocks on Solana.', [
		'The mechanism in one paragraph: orders collect for about 19 minutes, cancelling closes for the last ~2, then everything clears at one price.',
		'Why it exists: of 1,026 xStocks on Solana, 55 have any DEX pool and 971 have none (read 23 Sept 2026).',
		'Where it runs: devnet, program Gk9ZUMqP…YGP, ten tickers on a keeper cadence, live at uncross.0xo.in.',
		'Two reading paths: "I know markets, not Solana" and "I know Solana, not markets".',
	], ['README.md', 'docs/submission-draft.md']],
	'start/quickstart': ['Quickstart: your first order', 'From an empty wallet to a settled order in five steps.', [
		'Switch a wallet to devnet, open the app, connect.',
		'Get test tokens (one click), place a buy or sell, watch the countdown.',
		'Read the receipt after the cross. Links to the full app pages.',
	], ['docs/community-auction.md (participant path)', 'web/src/components/GetTestTokens.tsx', 'OrderForm.tsx', 'Receipt.tsx']],
	'start/glossary': ['Glossary', 'Every term the product uses, for readers new to markets or new to Solana.', [
		'Market terms: call auction, limit price, clearing price, executable volume, imbalance, bid/ask, pro rata, price priority, reference price.',
		'Solana terms: wallet, devnet, slot, transaction signature, program, account, PDA, rent, mint, token account (ATA), Token-2022, keeper/crank.',
		'Uncross terms: window, freeze, cross, indicative price, escrow, settle path, batch, gate.',
	], ['program source', 'docs/numbers.md']],
	'mechanism/why-call-auctions': ['Why a call auction', 'Thin markets, and why one price at a set time helps them.', [
		'Continuous pools make each trader cross the spread alone; an auction gathers traders into the same minutes.',
		'The universe table: pool TVL buckets for 1,026 xStocks (23 Sept 2026), 971 with no pool.',
		'IBMx: a published price but no route (16 Sept), 84.09% impact on $10,000 (23 Sept 17:32 UTC). Dated readings only.',
		'A reference price is not an executable price.',
	], ['docs/submission-draft.md', 'docs/pyth.md §6', 'site/lib/liquidity-capture.json']],
	'mechanism/lifecycle': ['Auction lifecycle', 'Open, orders and escrow, the freeze, the cross, settlement, refunds and rent reclaim.', [
		'Timeline: open_slot → close_slot − freeze_slots → close_slot; keeper cadence 7,000 slots, freeze 700.',
		'Table: what you can and cannot do at each stage (place until close; cancel until the freeze; cross and settle permissionless).',
		'Batched settlement (7 orders per transaction with distinct owners), idempotent batches, one settle path per auction.',
		'Failure path (cancel_and_refund), close_auction rent reclaim and its refusals.',
	], ['uncross/programs/uncross/src/lib.rs', 'docs/phase2.md', 'docs/railway.md', 'uncross/scripts/keeper.mjs']],
	'mechanism/order-statuses': ['Order statuses', 'What each status means and where the money is.', [
		'Open, Frozen, Filled, Partially filled, Unfilled, Cancelled, Refunded: the seven statuses the app uses (web/src/lib/settlement.ts).',
		'For each: what happened, where the escrow is, what came back.',
		'"Failed" is not a status in the code. Awaiting a decision (see report).',
	], ['web/src/lib/settlement.ts', 'docs/numbers.md']],
	'mechanism/costs': ['Costs and rent', 'What an order costs in SOL, and what comes back.', [
		'Order account rent 0.00121412 SOL, paid by the trader, never returned by design.',
		'Auction and vault rent returned by close_auction; ~0.00002 SOL net per auction after reclaim.',
		'No protocol fee: protocol_fee_bps exists and is always 0.',
	], ['README.md', 'state.rs', 'lib.rs', 'docs/submission-draft.md']],
	'app/wallet': ['Connect a wallet', 'Switching a Solana wallet to devnet and connecting.', [
		'Phantom, Solflare, Backpack via Wallet Standard; the devnet switch in each.',
		'Nothing on devnet is worth money.',
	], ['docs/community-auction.md', 'docs/submission-draft.md (browser-wallet run, 24 Sept)']],
	'app/test-tokens': ['Get test tokens', 'The one-click faucet grant.', [
		'What a grant contains: 0.02 SOL, 12 shares of the ticker you are viewing (and any event tickers), 6,000 test USDC.',
		'Limits: one grant per wallet every three hours; a global cap; the refusal messages.',
	], ['uncross/scripts/faucet.mjs', 'GetTestTokens.tsx', 'docs/submission-draft.md']],
	'app/placing-an-order': ['Place an order', 'The order form, escrow, and what happens on submit.', [
		'Price per share, shares, what is escrowed (buy: shares × limit, rounded up; sell: the shares).',
		'Orders can still be placed during the freeze; only cancelling stops.',
		'Bid above ask is normal here. Cancelling before the freeze.',
	], ['OrderForm.tsx', 'lib.rs place_order / cancel_order', 'docs/numbers.md']],
	'app/ticker-page': ['Read a ticker page', 'Every number on the dashboard and where it comes from.', [
		'This auction: would clear at, shares that would trade, best bid/ask, crosses in, cancel-until.',
		'External reference: Pyth price, age, extended hours, last gate result.',
		'Sidebar, past crosses table, candles (high/low are limit prices placed, not trades), depth chart.',
	], ['docs/numbers.md']],
	'app/receipt': ['Your receipt', 'What your order came to after the cross.', [
		'Each field: status, filled of asked, limit, clearing price, paid/received, delivered, returned, settlement signature.',
		'Live vs rebuilt receipts (auction closed and its rent returned).',
	], ['web/src/components/Receipt.tsx', 'web/src/lib/settlement.ts', 'docs/numbers.md']],
	'app/orders': ['Orders page', 'Every order a wallet has placed, on any ticker.', [
		'Tabs: Open, History, Fills, Cancelled / unfilled, All.',
		'Read from the wallet\'s order accounts via /api/orders, refreshed every 10s.',
	], ['OrdersPage.tsx', 'docs/numbers.md']],
	'app/portfolio': ['Portfolio page', 'What the wallet holds, and what is locked in orders.', [
		'In wallet, locked (per order, with time to cross), value at the mainnet Pyth price, what is not valued.',
	], ['PortfolioPage.tsx', 'docs/numbers.md']],
	'app/open-and-crank': ['Open an auction, run the cross', 'Starting an auction on a quiet ticker, and finishing one yourself.', [
		'Listed tickers with nothing running: one click opens an auction; the faucet service pays its rent and gets it back at close.',
		'The permissionless crank: anyone can run compute_clearing and settle_batch once a window closes.',
	], ['OpenAuction.tsx', 'CrankPanel.tsx', 'faucet.mjs', 'lib.rs']],
	'pyth/role': ['What Pyth is used for', 'A tie-break between prices the book already supports, and nothing more.', [
		'Pyth never sets the price: rule 3 of 4, only after volume and imbalance tie.',
		'Which feed: Equity.US.AAPL/USD, verified from the account bytes; IBM has no feed on Solana.',
		'On devnet the gate fails as stale on every auction; the passing path is unit-tested only.',
		'The price the app shows is mainnet Pyth, read-only.',
	], ['docs/pyth.md §1, §4, §5']],
	'pyth/gate': ['The on-chain gate', 'Eight conditions a Pyth price must meet before the auction may use it.', [
		'The eight conditions, each with why it exists.',
		'What happens on failure: the auction clears from the book alone; a stale price is never substituted.',
		'Recorded per auction: oracle_gate code and oracle_publish_time. The full code table (0–10).',
		'Per-share to per-raw-token conversion with the mint\'s effective multiplier.',
	], ['uncross/programs/uncross/src/oracle.rs', 'docs/pyth.md §4']],
	'pyth/after-hours': ['After the close: a retraction', 'We said the reference price disappears after 4pm ET. We measured it, and it does not.', [
		'80 checks over 10h38m from 4:11 PM ET, 15 Sept, through 2:49 AM ET: latest print never older than 14 s.',
		'The retracted claim, stated plainly, and what holds instead: no session marker on chain.',
		'What was not measured (weekends; gaps between checks).',
	], ['docs/pyth.md §2–3', 'docs/data/pyth-aapl-watch-2026-09-15.log']],
	'tokens/xstocks-token-2022': ['xStocks and Token-2022', 'The eight extensions every xStock mint carries, and what each means for your escrowed shares.', [
		'The eight: metadata pointer, token metadata, permanent delegate, default account state, scaled-UI amount, pausable, confidential transfer, transfer hook.',
		'Permanent delegate: the issuer can move or burn tokens in any account, escrow included.',
		'Pausable: while paused, escrowed shares cannot move; dollar refunds still can.',
		'Transfer hook present but unset; what switching it on would change.',
	], ['docs/phase0.md Q1', 'docs/devnet-fixture.md', 'README.md']],
	'tokens/raw-amounts': ['Raw amounts and splits', 'Why the program stores raw token amounts, never display amounts.', [
		'Scaled-UI multiplier: one raw token is m shares; issuers use it for splits (SPACEX 5×, OPENAI 1.486× scheduled).',
		'Limits are per raw token; the app converts to per share. Effective multiplier and its scheduled change.',
	], ['docs/phase2.md', 'oracle.rs effective_multiplier', 'web/src/lib/units.ts']],
	'tokens/unsupported': ['Tokens we cannot support', 'Tokens with active transfer fees break escrow balance.', [
		'PreStocks: 100 bps transfer fee (raised from 50 bps at epoch 1039), all 8 mints, re-verified 24 Sept.',
		'Tessera: 20 bps, three verified mints.',
		'Why a fee breaks escrow: the vault receives less than the program records.',
	], ['docs/phase2.md (re-verified 24 Sept)']],
	'devnet/why-devnet': ['Why devnet', 'Fixture mints that mirror the real xStocks extension for extension.', [
		'The mainnet AAPLx mint read live; the fixture built to match; the extension diff table.',
		'The four fields deliberately not reproduced, and why.',
		'What the fixture made testable that mainnet cannot: pause and split mid-auction.',
	], ['README.md', 'docs/devnet-fixture.md']],
	'devnet/pause-test': ['Test: pause mid-auction', 'The issuer pauses the token after the cross. Every balance is recoverable.', [
		'Settlement fails atomically; dollar refund while paused; share refund after resume; both vaults zero.',
		'Every signature, run on the upgraded program.',
	], ['docs/phase1.md Step 3', 'docs/phase2.md']],
	'devnet/split-test': ['Test: split mid-auction', 'The multiplier doubles between order entry and the cross. Nothing moves.', [
		'Predicted raw outcomes written down first; all matched; the display doubled, the accounting did not.',
		'Every signature.',
	], ['docs/phase1.md Step 3', 'docs/phase2.md']],
	'devnet/settlement-at-scale': ['Test: 42-wallet settlement', '42 orders from 42 owners, settled out of order, with a duplicate batch.', [
		'Pro-rata tier spanning every batch; duplicate is a no-op; wrong-path refund refused; every owner\'s delta matches to the unit.',
		'The three accounting bugs this found and fixed.',
	], ['docs/phase2.md Task 1']],
	'trust/verify': ['Verify a clearing price', 'Check any cross yourself from chain.', [
		'Read the auction account, decode the order summaries, rerun the rule by hand.',
		'Worked on the 23 Sept MSTRx cross (three wallets, two not ours): 158.01 / 164.24 tie, gate stale, midpoint 161.125.',
		'Check the gate code and publish time; check settlement transfers; rebuild a closed auction from order accounts.',
		'A small script, and the byte offsets.',
	], ['state.rs layout', 'docs/submission-draft.md', 'devnet reads made 24 Sept']],
	'trust/guarantees': ['What the program guarantees', 'The properties the program enforces, and what it cannot.', [
		'Escrow in auction-owned vaults; settle path lock; idempotent batches; close_auction refusals; feed binding.',
		'What it cannot: issuer pause and seizure. Nothing audited.',
	], ['lib.rs', 'state.rs', 'docs/phase2.md', 'README.md']],
	'trust/limitations': ['Honest limitations', 'What this does not show, and what went wrong.', [
		'Most devnet orders come from a test bot priced around Pyth: a clearing price near Pyth shows the bot followed instructions.',
		'The oracle tie-break path is unit-tested only.',
		'Stranded auctions: 119 stranded by the keeper\'s cache, 118 recovered, 1 permanently locked; 202 pre-upgrade auctions with no payer.',
		'Order accounts never closed, by design, at 0.00121412 SOL each.',
		'Tessera and PreStocks unsupported; issuer pause and seizure; no open public auction yet; not audited.',
	], ['docs/submission-draft.md', 'README.md', 'docs/pyth.md', 'docs/rent-recovery-2026-09-23.tsv']],
	'trust/transactions': ['Transaction index', 'Every signature cited in these docs, by test.', [
		'Phase 1 and Phase 2 runs, pause and split tests, the 42-order stress test, the MSTRx cross, the browser order path, rent recovery.',
	], ['docs/phase1.md', 'docs/phase2.md', 'docs/submission-draft.md', 'docs/rent-recovery-2026-09-23.tsv']],
	'reference/instructions': ['Program instructions', 'All seven instructions: who may call, when, and what each checks.', [
		'initialize_auction, place_order, cancel_order, compute_clearing, settle_batch, cancel_and_refund, close_auction.',
	], ['uncross/programs/uncross/src/lib.rs']],
	'reference/accounts': ['Accounts and layout', 'The Auction and Order accounts, field by field, with byte offsets.', [
		'Auction (zero-copy, 2,880 bytes, 63 order slots) and Order (Borsh, 111 bytes). PDA seeds.',
	], ['state.rs']],
	'reference/errors': ['Error codes', 'Every error the program can return, and what triggers it.', [
		'The 24 UncrossError variants with their messages and codes.',
	], ['errors.rs']],
	'reference/addresses': ['Addresses', 'Program, fixture mints, mainnet mints, Pyth accounts and feed IDs.', [], ['README.md', 'docs/devnet-fixture.md', 'docs/pyth.md', 'uncross/scripts/tickers.json']],
	'reference/units': ['Units and decimals', 'Raw units, program price units, and how the app converts them.', [
		'Ticker 8 decimals, test USDC 6; price = quote atomic per whole raw token; the multiplier.',
	], ['docs/numbers.md §Units', 'web/src/lib/units.ts']],
	'reference/faq': ['FAQ', 'Short answers, each linking to the page with the full one.', [], ['all of the above']],
	'reference/sources': ['Sources', 'Which file in the repository backs which claim.', [], ['the repository']],
};

let wrote = 0;
for (const [slug, [title, description, covers, sources]] of Object.entries(pages)) {
	const file = join(root, `${slug}.md`);
	if (existsSync(file) || existsSync(file + 'x')) continue;
	mkdirSync(dirname(file), { recursive: true });
	const body = [
		'---',
		`title: ${JSON.stringify(title)}`,
		`description: ${JSON.stringify(description)}`,
		'---',
		'',
		':::note[Planned page]',
		'This page is part of the proposed structure and has not been written yet.',
		':::',
		'',
		covers.length ? '**Will cover**\n\n' + covers.map((c) => `- ${c}`).join('\n') + '\n' : '',
		`**Sources:** ${sources.join(' · ')}`,
		'',
	].join('\n');
	writeFileSync(file, body);
	wrote++;
}
console.log(`wrote ${wrote} placeholder pages`);
