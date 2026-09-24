// The refund path's guard, tested on devnet against the deployed program.
//
//   RPC_URLS=<devnet rpc> node scripts/refund-guard-test.mjs [legit|adversarial|all]
//
// cancel_and_refund returns every order's full escrow. It exists because a
// paused mint blocks settlement. Before the guard, anyone could send it first
// after a cross and void every trade. It is now allowed only when the ticker
// mint is paused, or once an earlier batch has already taken the refund path.
//
// "legit" runs the case the path exists for, and runs first: pause the mint,
// settlement fails, the buyer's quote comes back while paused, and the seller's
// shares after resume. Every balance ends where it started. If that fails the
// guard is too strict and must not ship.
//
// "adversarial" then checks every refusal, each sent with preflight skipped so
// it lands on chain as a failed transaction with a signature:
//   - a stranger, on a crossed and unsettled auction;
//   - a participant in that auction, the same;
//   - mid-window, before the cross;
//   - partly settled: after one order has settled on the clear path.
//
// It runs on a dormant fixture ticker (CRCLx by default), so pausing its mint
// touches nothing live. The keeper cranks every auction, these included; each
// check is built to hold whichever of the two gets to an auction first.

import fs from "node:fs";
import anchor from "@coral-xyz/anchor";
import { createAssociatedTokenAccountIdempotentInstruction, createMintToCheckedInstruction, createPauseInstruction, createResumeInstruction } from "@solana/spl-token";
import { loadKeypair, loadFixture, getProgram, auctionPda, orderPda, vaultTickerAta, vaultQuoteAta, tickerAta, quoteAta, fetchAuction, sendV0, tokenAmount, waitForSlot, TICKER_PROGRAM, QUOTE_PROGRAM, ASSOCIATED_TOKEN_PROGRAM } from "./lib.mjs";

const { BN } = anchor;
const { PublicKey, Keypair, SystemProgram, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = anchor.web3;

const MODE = process.argv[2] ?? "all";
const SYMBOL = process.env.REFUND_TEST_TICKER ?? "CRCLx";
const fixture = fs.readFileSync(new URL("./universe-fixtures.jsonl", import.meta.url), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((t) => t.symbol === SYMBOL);
if (!fixture) throw new Error(`${SYMBOL} is not a universe fixture`);
const MINT = new PublicKey(fixture.devnetMint);
const deploy = loadKeypair("deploy");
const wallet2 = loadKeypair("wallet2");
const fx = loadFixture();
const QUOTE = fx.quoteMint;
const stranger = Keypair.generate();
const { program, connection } = getProgram(deploy);
const ID = program.programId;
const shares = (n) => new BN(Math.round(n * 1e8));
const usd = (n) => new BN(Math.round(n * 1e6));
const results = [];
const out = (ok, name, detail) => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    console.log(`\nREFUND GUARD: FAIL at "${name}". Do not ship; revert the program.`);
    process.exit(1);
  }
};

const common = (auction) => ({
  auction,
  vaultTicker: vaultTickerAta(auction, MINT),
  vaultQuote: vaultQuoteAta(auction, QUOTE),
  tickerMint: MINT,
  quoteMint: QUOTE,
  tickerTokenProgram: TICKER_PROGRAM,
  quoteTokenProgram: QUOTE_PROGRAM,
});
const atas = (owner) => ({ ticker: tickerAta(owner, MINT), quote: quoteAta(owner, QUOTE) });

async function balances() {
  const [dt, dq, wt, wq] = await Promise.all([atas(deploy.publicKey).ticker, atas(deploy.publicKey).quote, atas(wallet2.publicKey).ticker, atas(wallet2.publicKey).quote].map((a) => tokenAmount(connection, a)));
  return { dt, dq, wt, wq };
}
const vaults = async (auction) => ({ vt: await tokenAmount(connection, vaultTickerAta(auction, MINT)), vq: await tokenAmount(connection, vaultQuoteAta(auction, QUOTE)) });

/** Send and expect success; returns the signature. */
async function ok(ixs, signers = []) {
  return (await sendV0(connection, deploy, signers, ixs, { cuLimit: 1_000_000 })).sig;
}
/** Send with preflight skipped, so a refusal lands on chain. Returns { sig, err, code }. */
async function landed(ixs, signers = []) {
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: deploy.publicKey, recentBlockhash: blockhash, instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 }), ...ixs] }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  const required = msg.staticAccountKeys.slice(0, msg.header.numRequiredSignatures);
  tx.sign([deploy, ...signers].filter((s, i, all) => required.some((k) => k.equals(s.publicKey)) && all.findIndex((x) => x.publicKey.equals(s.publicKey)) === i));
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction(sig, "confirmed").catch(() => {});
  let t = null;
  for (let i = 0; i < 10 && !t; i++) {
    t = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!t) await new Promise((r) => setTimeout(r, 1500));
  }
  const code = (t?.meta?.logMessages ?? []).map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean) ?? null;
  return { sig, err: t?.meta?.err ?? null, code, logs: t?.meta?.logMessages ?? [] };
}

async function open(windowSlots, freezeSlots) {
  const openSlot = await connection.getSlot("confirmed");
  const auction = auctionPda(ID, MINT, openSlot);
  const ix = await program.methods
    .initializeAuction(new BN(openSlot), new BN(openSlot + windowSlots), new BN(freezeSlots), new BN(windowSlots), Array(32).fill(0))
    .accountsStrict({ payer: deploy.publicKey, auction, tickerMint: MINT, quoteMint: QUOTE, vaultTicker: vaultTickerAta(auction, MINT), vaultQuote: vaultQuoteAta(auction, QUOTE), tickerTokenProgram: TICKER_PROGRAM, quoteTokenProgram: QUOTE_PROGRAM, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM, systemProgram: SystemProgram.programId })
    .instruction();
  const sig = await ok([ix]);
  return { auction, closeSlot: openSlot + windowSlots, sig };
}
async function placeIx(auction, owner, side, price, qty) {
  const index = (await fetchAuction(connection, auction)).orderCount;
  const a = atas(owner.publicKey);
  const ix = await program.methods
    .placeOrder(side === "buy" ? { buy: {} } : { sell: {} }, price, qty, index)
    .accountsStrict({ owner: owner.publicKey, order: orderPda(ID, auction, index), ownerTickerAta: a.ticker, ownerQuoteAta: a.quote, systemProgram: SystemProgram.programId, ...common(auction) })
    .instruction();
  return ok([ix], [owner]);
}
const crossIx = (auction) =>
  program.methods.computeClearing().accountsStrict({ caller: deploy.publicKey, auction, tickerMint: MINT, pythPriceFeed: SystemProgram.programId }).instruction();
async function batchIx(auction, indices, mode, caller) {
  const remaining = [];
  for (const i of indices) {
    const o = await program.account.order.fetch(orderPda(ID, auction, i));
    const a = atas(o.owner);
    remaining.push({ pubkey: orderPda(ID, auction, i), isWritable: true, isSigner: false }, { pubkey: a.ticker, isWritable: true, isSigner: false }, { pubkey: a.quote, isWritable: true, isSigner: false });
  }
  const m = mode === "settle" ? program.methods.settleBatch(indices) : program.methods.cancelAndRefund(indices);
  return m.accountsStrict({ caller: caller.publicKey, ...common(auction) }).remainingAccounts(remaining).instruction();
}
const pauseIx = () => createPauseInstruction(MINT, deploy.publicKey, [], TICKER_PROGRAM);
const resumeIx = () => createResumeInstruction(MINT, deploy.publicKey, [], TICKER_PROGRAM);

// ------------------------------------------------------------ setup
console.log(`fixture ${SYMBOL} ${MINT.toBase58()}; stranger ${stranger.publicKey.toBase58()} (never funded; the deploy wallet pays its fees)`);
{
  const ixs = [deploy.publicKey, wallet2.publicKey].map((o) => createAssociatedTokenAccountIdempotentInstruction(deploy.publicKey, tickerAta(o, MINT), o, MINT, TICKER_PROGRAM, ASSOCIATED_TOKEN_PROGRAM));
  ixs.push(createMintToCheckedInstruction(MINT, tickerAta(deploy.publicKey, MINT), deploy.publicKey, 20n * 100_000_000n, 8, [], TICKER_PROGRAM));
  console.log(`setup: token accounts and 20 shares to the seller — ${await ok(ixs)}`);
}
const minted = (await connection.getParsedAccountInfo(MINT)).value.data.parsed.info.extensions.find((e) => e.extension === "pausableConfig").state;
if (minted.paused) throw new Error("fixture mint is paused; resume it first");

// ------------------------------------------------------------ 1. legitimate
if (MODE === "legit" || MODE === "all") {
  console.log("\n## 1. Legitimate: the mint is paused after the cross, so settlement cannot run");
  const before = await balances();
  const { auction, closeSlot } = await open(160, 20);
  console.log(`auction ${auction.toBase58()}`);
  await placeIx(auction, deploy, "sell", usd(200), shares(4));
  await placeIx(auction, wallet2, "buy", usd(210), shares(4));
  await waitForSlot(connection, closeSlot, "close");
  // Pause and cross in one transaction, so nobody can settle in between.
  const paused = await ok([pauseIx(), await crossIx(auction)]);
  out(true, "mint paused and auction crossed", paused);
  const a = await fetchAuction(connection, auction);
  out(a.status !== "open" && a.executableVolume > 0n, "the cross traded", `${Number(a.executableVolume) / 1e8} shares at ${Number(a.clearingPrice) / 1e6}`);
  const s = await landed([await batchIx(auction, [0, 1], "settle", deploy)]);
  out(!!s.err && s.logs.some((l) => /paused/i.test(l)), "settlement fails while paused", `${s.sig} — ${s.logs.find((l) => /paused/i.test(l)) ?? JSON.stringify(s.err)}`);
  const r1 = await landed([await batchIx(auction, [1], "refund", stranger)], [stranger]);
  out(!r1.err, "the buyer's escrow is refunded while paused (sent by a stranger)", r1.sig);
  const resumed = await ok([resumeIx()]);
  out(true, "mint resumed", resumed);
  const r0 = await landed([await batchIx(auction, [0], "refund", deploy)]);
  out(!r0.err, "the seller's shares are refunded after resume (the path was already chosen)", r0.sig);
  const after = await balances();
  const v = await vaults(auction);
  const fin = await fetchAuction(connection, auction);
  out(after.dt === before.dt && after.dq === before.dq && after.wt === before.wt && after.wq === before.wq, "every balance is back where it started", JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, x]) => [k, String(x)]))));
  out(v.vt === 0n && v.vq === 0n && fin.status === "settled" && fin.settlePath === "refund", "both vaults empty, auction settled on the refund path", `status ${fin.status}, path ${fin.settlePath}`);
}

// ------------------------------------------------------------ 2. refusals
if (MODE === "adversarial" || MODE === "all") {
  console.log("\n## 2. Refusals");
  // Mid-window.
  const b = await open(200, 20);
  console.log(`auction ${b.auction.toBase58()}`);
  await placeIx(b.auction, deploy, "sell", usd(200), shares(2));
  await placeIx(b.auction, wallet2, "buy", usd(210), shares(2));
  const mid = await landed([await batchIx(b.auction, [0, 1], "refund", stranger)], [stranger]);
  out(!!mid.err && !!mid.code, "mid-window: refund refused", `${mid.sig} — ${mid.code}`);
  await waitForSlot(connection, b.closeSlot, "close");
  // Crossed and unsettled: the cross and the refund in one transaction, so the
  // refusal is tested on exactly that state, whoever else is cranking.
  const st = await landed([await crossIx(b.auction), await batchIx(b.auction, [0, 1], "refund", stranger)], [stranger]);
  out(!!st.err && st.code === "RefundNotAllowed", "crossed and unsettled, sent by a stranger: refused", `${st.sig} — ${st.code}`);
  const pt = await landed([await crossIx(b.auction), await batchIx(b.auction, [0, 1], "refund", wallet2)], [wallet2]);
  out(!!pt.err && pt.code === "RefundNotAllowed", "crossed and unsettled, sent by a participant: refused", `${pt.sig} — ${pt.code}`);
  // Partly settled: the cross, one order clear-settled, then a refund, together.
  const c = await open(160, 20);
  console.log(`auction ${c.auction.toBase58()}`);
  await placeIx(c.auction, deploy, "sell", usd(200), shares(2));
  await placeIx(c.auction, wallet2, "buy", usd(210), shares(2));
  await waitForSlot(connection, c.closeSlot, "close");
  const ps = await landed([await crossIx(c.auction), await batchIx(c.auction, [0], "settle", deploy), await batchIx(c.auction, [1], "refund", stranger)], [stranger]);
  out(!!ps.err && !!ps.code, "partly settled: refund refused", `${ps.sig} — ${ps.code}`);
  // Nothing was voided: the trades settle normally.
  for (const x of [b.auction, c.auction]) {
    const now = await fetchAuction(connection, x);
    if (now.status === "open") await ok([await crossIx(x)]);
    const pending = (await fetchAuction(connection, x)).settledCount < 2;
    if (pending) await ok([await batchIx(x, [0, 1], "settle", deploy)]).catch(() => {});
    const done = await fetchAuction(connection, x);
    out(done.status === "settled" && done.settlePath === "clear", `${x.toBase58().slice(0, 6)}… settled on the clear path; its trade stands`, `${Number(done.executableVolume) / 1e8} shares at ${Number(done.clearingPrice) / 1e6}`);
  }
}

console.log(`\nREFUND GUARD: PASS (${results.length} checks)`);
