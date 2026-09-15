// Devnet end-to-end exercise of the Uncross call auction.
//
//   node scripts/devnet-e2e.mjs main        -- Phase 1 definition of done
//   node scripts/devnet-e2e.mjs pause       -- pausableConfig trap
//   node scripts/devnet-e2e.mjs multiplier  -- scaledUiAmountConfig trap
//
// The pause and multiplier tests need an authority action between steps (pause
// / resume / change multiplier with spl-token); each phase prints the command
// to run next.
import anchor from "@coral-xyz/anchor";
import {
  loadKeypair,
  loadFixture,
  getProgram,
  auctionPda,
  orderPda,
  vaultTickerAta,
  vaultQuoteAta,
  tickerAta,
  fetchAuction,
  sendV0,
  tokenAmount,
  waitForSlot,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "./lib.mjs";

const { BN } = anchor;
const { PublicKey, SystemProgram } = anchor.web3;

const shares = (n) => new BN(Math.round(n * 1e8));
const usd = (n) => new BN(Math.round(n * 1e6));

const deploy = loadKeypair("deploy");
const wallet2 = loadKeypair("wallet2");
const fx = loadFixture();
// TICKER=ibmx runs against the IBMx fixture (scaled-UI multiplier 1.0153), so
// pause/multiplier tests can run without disturbing an AAPLx fixture run.
const TICKER = (process.env.TICKER ?? "aaplx").toLowerCase();
const TICKER_MINT = TICKER === "ibmx" ? fx.ibmxMint : fx.tickerMint;
const { program, connection } = getProgram(deploy);
const ID = program.programId;

const sigs = [];
const record = (label, r) => {
  sigs.push({ label, ...r });
  console.log(`  ${label}: ${r.sig}${r.cu !== undefined ? `  (${r.cu} CU)` : ""}`);
};

const atasOf = (owner) =>
  owner.publicKey.equals(deploy.publicKey)
    ? { ticker: tickerAta(deploy.publicKey, TICKER_MINT), quote: fx.deployQuoteAta }
    : { ticker: tickerAta(wallet2.publicKey, TICKER_MINT), quote: fx.wallet2QuoteAta };

const common = (auction) => ({
  auction,
  vaultTicker: vaultTickerAta(auction, TICKER_MINT),
  vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
  tickerMint: TICKER_MINT,
  quoteMint: fx.quoteMint,
  tickerTokenProgram: TICKER_PROGRAM,
  quoteTokenProgram: QUOTE_PROGRAM,
});

async function balances(tag) {
  const [dt, dq, wt, wq] = await Promise.all(
    [tickerAta(deploy.publicKey, TICKER_MINT), fx.deployQuoteAta, tickerAta(wallet2.publicKey, TICKER_MINT), fx.wallet2QuoteAta].map((a) => tokenAmount(connection, a)),
  );
  console.log(`  [${tag}] deploy ticker=${dt} quote=${dq} | wallet2 ticker=${wt} quote=${wq}`);
  return { dt, dq, wt, wq };
}

async function vaults(auction, tag) {
  const vt = await tokenAmount(connection, vaultTickerAta(auction, TICKER_MINT));
  const vq = await tokenAmount(connection, vaultQuoteAta(auction, fx.quoteMint));
  console.log(`  [${tag}] vault ticker=${vt} quote=${vq}`);
  return { vt, vq };
}

async function openAuction({ windowSlots, freezeSlots }) {
  const openSlot = await connection.getSlot("confirmed");
  const closeSlot = openSlot + windowSlots;
  const auction = auctionPda(ID, TICKER_MINT, openSlot);
  console.log(`\n== initialize_auction (open=${openSlot} close=${closeSlot} freeze=${freezeSlots}) ==`);
  const ix = await program.methods
    .initializeAuction(new BN(openSlot), new BN(closeSlot), new BN(freezeSlots), new BN(750), Array(32).fill(0))
    .accountsStrict({
      payer: deploy.publicKey,
      auction,
      tickerMint: TICKER_MINT,
      quoteMint: fx.quoteMint,
      vaultTicker: vaultTickerAta(auction, TICKER_MINT),
      vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  record("initialize_auction", await sendV0(connection, deploy, [], [ix]));
  console.log(`  auction: ${auction.toBase58()}`);
  return { auction, closeSlot, freezeSlots };
}

async function placeOrder(auction, owner, side, price, qty, label) {
  const index = (await fetchAuction(connection, auction)).orderCount;
  const atas = atasOf(owner);
  const ix = await program.methods
    .placeOrder(side === "buy" ? { buy: {} } : { sell: {} }, price, qty, index)
    .accountsStrict({
      owner: owner.publicKey,
      order: orderPda(ID, auction, index),
      ownerTickerAta: atas.ticker,
      ownerQuoteAta: atas.quote,
      systemProgram: SystemProgram.programId,
      ...common(auction),
    })
    .instruction();
  record(`place_order#${index} (${label})`, await sendV0(connection, deploy, [owner], [ix]));
  const a = await fetchAuction(connection, auction);
  console.log(`    indicative: price=${a.indicativePrice} volume=${a.indicativeVolume} (orders=${a.orderCount})`);
  return index;
}

async function cancelOrder(auction, owner, index, expectFailure = false) {
  const atas = atasOf(owner);
  const ix = await program.methods
    .cancelOrder()
    .accountsStrict({
      owner: owner.publicKey,
      order: orderPda(ID, auction, index),
      ownerTickerAta: atas.ticker,
      ownerQuoteAta: atas.quote,
      ...common(auction),
    })
    .instruction();
  try {
    const r = await sendV0(connection, deploy, [owner], [ix]);
    if (expectFailure) throw new Error(`EXPECTED cancel_order#${index} to be rejected: ${r.sig}`);
    record(`cancel_order#${index}`, r);
    const a = await fetchAuction(connection, auction);
    console.log(`    indicative after cancel: price=${a.indicativePrice} volume=${a.indicativeVolume}`);
  } catch (e) {
    if (!expectFailure) throw e;
    console.log(`  cancel_order#${index} correctly rejected: ${(e.logs ?? []).find((l) => l.includes("Error Code")) ?? e.message}`);
  }
}

async function computeClearing(auction) {
  console.log("\n== compute_clearing ==");
  const ix = await program.methods
    .computeClearing()
    .accountsStrict({ caller: deploy.publicKey, auction, tickerMint: TICKER_MINT, pythPriceFeed: SystemProgram.programId })
    .instruction();
  record("compute_clearing", await sendV0(connection, deploy, [], [ix], { cuLimit: 800_000 }));
  const a = await fetchAuction(connection, auction);
  console.log(`  clearing_price=${a.clearingPrice} executable_volume=${a.executableVolume} reference_price_set=${a.referencePriceSet}`);
  for (const o of a.orders) {
    console.log(`    order#${o.index} ${o.side.toUpperCase().padEnd(4)} limit=${o.limitPrice} qty=${o.quantity} filled=${o.filledQuantity} quote=${o.quoteAmount}${o.cancelled ? " (cancelled)" : ""}`);
  }
  return a;
}

async function settle(auction, indices, mode = "settle") {
  const remaining = [];
  for (const i of indices) {
    const order = await program.account.order.fetch(orderPda(ID, auction, i));
    const atas = order.owner.equals(deploy.publicKey)
      ? { ticker: tickerAta(deploy.publicKey, TICKER_MINT), quote: fx.deployQuoteAta }
      : { ticker: tickerAta(wallet2.publicKey, TICKER_MINT), quote: fx.wallet2QuoteAta };
    remaining.push(
      { pubkey: orderPda(ID, auction, i), isWritable: true, isSigner: false },
      { pubkey: atas.ticker, isWritable: true, isSigner: false },
      { pubkey: atas.quote, isWritable: true, isSigner: false },
    );
  }
  const m = mode === "settle" ? program.methods.settleBatch(indices) : program.methods.cancelAndRefund(indices);
  const ix = await m.accountsStrict({ caller: deploy.publicKey, ...common(auction) }).remainingAccounts(remaining).instruction();
  const r = await sendV0(connection, deploy, [], [ix], { cuLimit: 1_000_000 });
  record(`${mode === "settle" ? "settle_batch" : "cancel_and_refund"} [${indices.join(",")}]`, r);
  return r;
}

function describeFailure(e) {
  const logs = e.logs ?? [];
  return logs.filter((l) => /Error|paused|insufficient/i.test(l)).map((l) => `    log: ${l}`).join("\n") || `    ${e.message}`;
}

async function runMain() {
  console.log("### PHASE 1 DEFINITION OF DONE (devnet, zero-copy program) ###");
  await balances("start");
  const { auction, closeSlot, freezeSlots } = await openAuction({ windowSlots: 260, freezeSlots: 60 });

  console.log("\n== placing orders (indicative price recomputed each time) ==");
  await placeOrder(auction, deploy, "sell", usd(240), shares(10), "deploy SELL 10 @ 240");
  await placeOrder(auction, wallet2, "buy", usd(250), shares(10), "wallet2 BUY 10 @ 250");
  await placeOrder(auction, deploy, "sell", usd(245), shares(5), "deploy SELL 5 @ 245");
  await placeOrder(auction, wallet2, "buy", usd(243), shares(8), "wallet2 BUY 8 @ 243");

  console.log("\n== cancel before the freeze window (expect success) ==");
  const c = await placeOrder(auction, deploy, "sell", usd(300), shares(1), "deploy SELL 1 @ 300 (to cancel)");
  await cancelOrder(auction, deploy, c);

  console.log("\n== cancel inside the freeze window (expect rejection) ==");
  const f = await placeOrder(auction, deploy, "sell", usd(310), shares(1), "deploy SELL 1 @ 310 (freeze test)");
  await waitForSlot(connection, closeSlot - freezeSlots + 2, "freeze window start");
  await cancelOrder(auction, deploy, f, true);

  await waitForSlot(connection, closeSlot, "auction close");
  const cleared = await computeClearing(auction);
  console.log("\n== idempotency: compute_clearing again ==");
  await computeClearing(auction);

  console.log("\n== settle_batch ==");
  await vaults(auction, "pre-settle");
  await settle(auction, [...Array(cleared.orderCount).keys()]);
  await balances("after settle");
  const v = await vaults(auction, "post-settle");
  const a = await fetchAuction(connection, auction);
  console.log(`\n  auction status=${a.status} settled=${a.settledCount}/${a.orderCount} ${v.vt === 0n && v.vq === 0n ? "| VAULTS EMPTY" : "| !! VAULT REMAINDER"}`);
}

async function runPause() {
  console.log("### PAUSE TRAP (devnet fixture) -- setup ###");
  const { auction, closeSlot } = await openAuction({ windowSlots: 120, freezeSlots: 20 });
  await placeOrder(auction, deploy, "sell", usd(200), shares(4), "deploy SELL 4 @ 200");
  await placeOrder(auction, wallet2, "buy", usd(210), shares(4), "wallet2 BUY 4 @ 210");
  await vaults(auction, "escrowed");
  await waitForSlot(connection, closeSlot, "auction close");
  await computeClearing(auction);
  console.log(`\n  NEXT: spl-token pause ${TICKER_MINT.toBase58()} -u devnet`);
  console.log(`        node scripts/devnet-e2e.mjs pause-settle ${auction.toBase58()}`);
}

async function runPauseSettle(auctionStr) {
  const auction = new PublicKey(auctionStr);
  console.log("### PAUSE TRAP -- settlement while paused ###");
  await balances("before");
  await vaults(auction, "before");
  try {
    await settle(auction, [0, 1]);
    console.log("  !! settle_batch SUCCEEDED while paused");
  } catch (e) {
    console.log("  settle_batch failed as expected:\n" + describeFailure(e));
  }
  const a = await fetchAuction(connection, auction);
  console.log(`  auction still: status=${a.status} settled=${a.settledCount}/${a.orderCount} path=${a.settlePath}`);
  await balances("after failed settle");
  await vaults(auction, "after failed settle");

  console.log("\n== cancel_and_refund on the BUY order (quote mint is not paused) ==");
  await settle(auction, [1], "refund");
  await balances("after buy refund");
  await vaults(auction, "after buy refund");
  console.log(`\n  NEXT: spl-token resume ${TICKER_MINT.toBase58()} -u devnet`);
  console.log(`        node scripts/devnet-e2e.mjs pause-recover ${auction.toBase58()}`);
}

async function runPauseRecover(auctionStr) {
  const auction = new PublicKey(auctionStr);
  console.log("### PAUSE TRAP -- recovery after resume ###");
  console.log("\n-- settle_batch after refunds began (expect SettlementPathLocked) --");
  try {
    await settle(auction, [0]);
    console.log("  !! clear path allowed after refund path began");
  } catch (e) {
    console.log("  rejected:\n" + describeFailure(e));
  }
  await settle(auction, [0], "refund");
  await balances("after sell refund");
  const v = await vaults(auction, "final");
  const a = await fetchAuction(connection, auction);
  console.log(`  auction status=${a.status} settled=${a.settledCount}/${a.orderCount} path=${a.settlePath}`);
  console.log(v.vt === 0n && v.vq === 0n ? "  VAULTS EMPTY -- nothing stranded" : `  !! STRANDED: ticker=${v.vt} quote=${v.vq}`);
}

async function runMultiplier() {
  console.log("### MULTIPLIER TRAP (devnet fixture) -- setup ###");
  await balances("start");
  const { auction, closeSlot } = await openAuction({ windowSlots: 150, freezeSlots: 20 });
  await placeOrder(auction, deploy, "sell", usd(100), shares(6), "deploy SELL 6 @ 100");
  await placeOrder(auction, wallet2, "buy", usd(120), shares(6), "wallet2 BUY 6 @ 120");
  await vaults(auction, "escrowed (raw)");
  console.log(`\n  NEXT: spl-token update-ui-amount-multiplier ${TICKER_MINT.toBase58()} 2 --with-compute-unit-limit 400000 -u devnet`);
  console.log(`        node scripts/devnet-e2e.mjs multiplier-settle ${auction.toBase58()} ${closeSlot}`);
}

async function runMultiplierSettle(auctionStr, closeSlotStr) {
  const auction = new PublicKey(auctionStr);
  console.log("### MULTIPLIER TRAP -- clear + settle after multiplier change ###");
  await waitForSlot(connection, Number(closeSlotStr), "auction close");
  await computeClearing(auction);
  await balances("pre-settle (raw)");
  await settle(auction, [0, 1]);
  await balances("post-settle (raw)");
  const v = await vaults(auction, "final");
  console.log(v.vt === 0n && v.vq === 0n ? "  VAULTS EMPTY" : `  vault remainder: ticker=${v.vt} quote=${v.vq}`);
}

const [, , phase, arg1, arg2] = process.argv;
const run = {
  main: runMain,
  pause: runPause,
  "pause-settle": () => runPauseSettle(arg1),
  "pause-recover": () => runPauseRecover(arg1),
  multiplier: runMultiplier,
  "multiplier-settle": () => runMultiplierSettle(arg1, arg2),
}[phase];
if (!run) {
  console.error("usage: node scripts/devnet-e2e.mjs <main|pause|pause-settle|pause-recover|multiplier|multiplier-settle>");
  process.exit(1);
}
await run();
console.log("\n=== signatures ===");
for (const s of sigs) console.log(`${s.label}\t${s.sig}\t${s.cu ?? ""}`);
