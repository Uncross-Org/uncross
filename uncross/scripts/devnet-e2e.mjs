// Devnet end-to-end exercise of the Uncross call auction.
//
//   node scripts/devnet-e2e.mjs main        -- Phase 1 definition of done
//   node scripts/devnet-e2e.mjs pause       -- pausableConfig trap (phase0 Q1)
//   node scripts/devnet-e2e.mjs multiplier  -- scaledUiAmountConfig trap (phase0 Q1)
//
// Every signature is printed so it can be pasted into docs/phase1.md.
import anchor from "@coral-xyz/anchor";
import {
  loadKeypair,
  loadFixture,
  getProgram,
  auctionPda,
  orderPda,
  vaultTickerAta,
  vaultQuoteAta,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  sleep,
} from "./lib.mjs";

const { BN } = anchor;
const { PublicKey, SystemProgram } = anchor.web3;

const TICKER_DECIMALS = 8;
const QUOTE_DECIMALS = 6;
const shares = (n) => new BN(Math.round(n * 10 ** TICKER_DECIMALS));
const usd = (n) => new BN(Math.round(n * 10 ** QUOTE_DECIMALS));

const deploy = loadKeypair("deploy");
const wallet2 = loadKeypair("wallet2");
const fx = loadFixture();
const { program, connection } = getProgram(deploy);
const PROGRAM_ID = program.programId;

// No Pyth classic price account exists on devnet for a fixture mint, so we pass
// a junk account: oracle::read_fresh_price rejects it on the owner check and the
// auction proceeds with reference_price: None. Per phase0.md Q3 that is the
// normal case for this venue, not an error path.
const DUMMY_ORACLE = SystemProgram.programId;

const sigs = [];
function record(label, sig) {
  sigs.push({ label, sig });
  console.log(`  ${label}: ${sig}`);
}

async function currentSlot() {
  return connection.getSlot("confirmed");
}

async function waitForSlot(target, label) {
  process.stdout.write(`  waiting for slot ${target} (${label})`);
  for (;;) {
    const s = await currentSlot();
    if (s >= target) {
      console.log(` -- reached ${s}`);
      return s;
    }
    process.stdout.write(".");
    await sleep(2000);
  }
}

async function tokenAmount(ata) {
  try {
    const bal = await connection.getTokenAccountBalance(ata);
    return BigInt(bal.value.amount);
  } catch {
    return 0n;
  }
}

async function balances(tag) {
  const [dt, dq, w2t, w2q] = await Promise.all([
    tokenAmount(fx.deployTickerAta),
    tokenAmount(fx.deployQuoteAta),
    tokenAmount(fx.wallet2TickerAta),
    tokenAmount(fx.wallet2QuoteAta),
  ]);
  console.log(
    `  [${tag}] deploy ticker=${dt} quote=${dq} | wallet2 ticker=${w2t} quote=${w2q}`,
  );
  return { dt, dq, w2t, w2q };
}

async function vaultBalances(auction, tag) {
  const [vt, vq] = await Promise.all([
    tokenAmount(vaultTickerAta(auction, fx.tickerMint)),
    tokenAmount(vaultQuoteAta(auction, fx.quoteMint)),
  ]);
  console.log(`  [${tag}] vault ticker=${vt} quote=${vq}`);
  return { vt, vq };
}

function commonAccounts(auction) {
  return {
    auction,
    vaultTicker: vaultTickerAta(auction, fx.tickerMint),
    vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
    tickerMint: fx.tickerMint,
    quoteMint: fx.quoteMint,
    tickerTokenProgram: TICKER_PROGRAM,
    quoteTokenProgram: QUOTE_PROGRAM,
  };
}

function ownerAtas(owner) {
  return owner.publicKey.equals(deploy.publicKey)
    ? { ticker: fx.deployTickerAta, quote: fx.deployQuoteAta }
    : { ticker: fx.wallet2TickerAta, quote: fx.wallet2QuoteAta };
}

async function openAuction({ windowSlots, freezeSlots, cadenceSlots }) {
  const openSlot = await currentSlot();
  const closeSlot = openSlot + windowSlots;
  const auction = auctionPda(PROGRAM_ID, fx.tickerMint, openSlot);
  console.log(
    `\n== initialize_auction (open=${openSlot} close=${closeSlot} freeze=${freezeSlots}) ==`,
  );
  const sig = await program.methods
    .initializeAuction(
      new BN(openSlot),
      new BN(closeSlot),
      new BN(freezeSlots),
      new BN(cadenceSlots),
    )
    .accounts({
      payer: deploy.publicKey,
      auction,
      tickerMint: fx.tickerMint,
      quoteMint: fx.quoteMint,
      vaultTicker: vaultTickerAta(auction, fx.tickerMint),
      vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
      associatedTokenProgram: new PublicKey(
        "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
      ),
      systemProgram: SystemProgram.programId,
    })
    .signers([deploy])
    .rpc();
  record("initialize_auction", sig);
  console.log(`  auction: ${auction.toBase58()}`);
  return { auction, openSlot, closeSlot, freezeSlots };
}

async function placeOrder(auction, owner, side, price, qty, label) {
  const state = await program.account.auction.fetch(auction);
  const index = state.orderCount;
  const order = orderPda(PROGRAM_ID, auction, index);
  const atas = ownerAtas(owner);
  const sig = await program.methods
    .placeOrder(side === "buy" ? { buy: {} } : { sell: {} }, price, qty)
    .accounts({
      owner: owner.publicKey,
      order,
      ownerTickerAta: atas.ticker,
      ownerQuoteAta: atas.quote,
      systemProgram: SystemProgram.programId,
      ...commonAccounts(auction),
    })
    .signers([owner])
    .rpc();
  record(`place_order#${index} (${label})`, sig);
  const after = await program.account.auction.fetch(auction);
  console.log(
    `    indicative: price=${after.indicativePrice.toString()} volume=${after.indicativeVolume.toString()} (orders=${after.orderCount})`,
  );
  return { index, order };
}

async function cancelOrder(auction, owner, index, expectFailure = false) {
  const order = orderPda(PROGRAM_ID, auction, index);
  const atas = ownerAtas(owner);
  try {
    const sig = await program.methods
      .cancelOrder()
      .accounts({
        owner: owner.publicKey,
        order,
        ownerTickerAta: atas.ticker,
        ownerQuoteAta: atas.quote,
        ...commonAccounts(auction),
      })
      .signers([owner])
      .rpc();
    if (expectFailure) {
      throw new Error(
        `EXPECTED cancel_order#${index} to be rejected, but it succeeded: ${sig}`,
      );
    }
    record(`cancel_order#${index}`, sig);
    const after = await program.account.auction.fetch(auction);
    console.log(
      `    indicative after cancel: price=${after.indicativePrice.toString()} volume=${after.indicativeVolume.toString()}`,
    );
    return sig;
  } catch (e) {
    if (!expectFailure) throw e;
    const msg = e.error?.errorCode?.code ?? e.message;
    console.log(`  cancel_order#${index} correctly rejected: ${msg}`);
    return null;
  }
}

async function computeClearing(auction) {
  console.log("\n== compute_clearing ==");
  const sig = await program.methods
    .computeClearing()
    .accounts({
      caller: deploy.publicKey,
      auction,
      pythPriceFeed: DUMMY_ORACLE,
    })
    .signers([deploy])
    .rpc();
  record("compute_clearing", sig);
  const state = await program.account.auction.fetch(auction);
  console.log(
    `  clearing_price=${state.clearingPrice.toString()} executable_volume=${state.executableVolume.toString()} reference_price_set=${state.referencePriceSet}`,
  );
  for (let i = 0; i < state.orderCount; i++) {
    const o = state.orders[i];
    console.log(
      `    order#${i} ${o.side.buy ? "BUY " : "SELL"} limit=${o.limitPrice.toString()} qty=${o.quantity.toString()} filled=${o.filledQuantity.toString()}${o.cancelled ? " (cancelled)" : ""}`,
    );
  }
  return state;
}

async function settle(auction, indices, mode = "settle") {
  const remaining = [];
  for (const i of indices) {
    const order = orderPda(PROGRAM_ID, auction, i);
    const state = await program.account.order.fetch(order);
    const atas = state.owner.equals(deploy.publicKey)
      ? { ticker: fx.deployTickerAta, quote: fx.deployQuoteAta }
      : { ticker: fx.wallet2TickerAta, quote: fx.wallet2QuoteAta };
    remaining.push(
      { pubkey: order, isWritable: true, isSigner: false },
      { pubkey: atas.ticker, isWritable: true, isSigner: false },
      { pubkey: atas.quote, isWritable: true, isSigner: false },
    );
  }
  const builder =
    mode === "settle"
      ? program.methods.settleBatch(indices)
      : program.methods.cancelAndRefund(indices);
  const sig = await builder
    .accounts({ caller: deploy.publicKey, ...commonAccounts(auction) })
    .remainingAccounts(remaining)
    .signers([deploy])
    .rpc();
  record(`${mode === "settle" ? "settle_batch" : "cancel_and_refund"} [${indices.join(",")}]`, sig);
  return sig;
}

async function runMain() {
  console.log("### PHASE 1 DEFINITION OF DONE (devnet) ###");
  await balances("start");

  const { auction, closeSlot, freezeSlots } = await openAuction({
    windowSlots: 260,
    freezeSlots: 60,
    cadenceSlots: 750,
  });

  console.log("\n== placing orders (indicative price recomputed each time) ==");
  await placeOrder(auction, deploy, "sell", usd(240), shares(10), "deploy SELL 10 @ 240");
  await placeOrder(auction, wallet2, "buy", usd(250), shares(10), "wallet2 BUY 10 @ 250");
  await placeOrder(auction, deploy, "sell", usd(245), shares(5), "deploy SELL 5 @ 245");
  await placeOrder(auction, wallet2, "buy", usd(243), shares(8), "wallet2 BUY 8 @ 243");

  console.log("\n== cancel before the freeze window (expect success) ==");
  const c = await placeOrder(auction, deploy, "sell", usd(300), shares(1), "deploy SELL 1 @ 300 (to cancel)");
  await balances("after 5 orders");
  await cancelOrder(auction, deploy, c.index);
  await balances("after cancel");

  console.log("\n== cancel inside the freeze window (expect rejection) ==");
  const f = await placeOrder(auction, deploy, "sell", usd(310), shares(1), "deploy SELL 1 @ 310 (freeze test)");
  await waitForSlot(closeSlot - freezeSlots + 2, "freeze window start");
  await cancelOrder(auction, deploy, f.index, true);

  await waitForSlot(closeSlot, "auction close");
  const cleared = await computeClearing(auction);

  console.log("\n== idempotency: compute_clearing again (expect no-op) ==");
  await computeClearing(auction);

  console.log("\n== settle_batch ==");
  await vaultBalances(auction, "pre-settle");
  const all = [...Array(cleared.orderCount).keys()];
  await settle(auction, all);
  await balances("after settle");
  await vaultBalances(auction, "post-settle");

  const final = await program.account.auction.fetch(auction);
  console.log(
    `\n  auction status: ${JSON.stringify(final.status)} settled=${final.settledCount}/${final.orderCount}`,
  );
  return auction;
}

async function runPause() {
  console.log("### PAUSE TRAP TEST (devnet fixture) ###");
  const { auction, closeSlot } = await openAuction({
    windowSlots: 120,
    freezeSlots: 20,
    cadenceSlots: 750,
  });
  await placeOrder(auction, deploy, "sell", usd(200), shares(4), "deploy SELL 4 @ 200");
  await placeOrder(auction, wallet2, "buy", usd(210), shares(4), "wallet2 BUY 4 @ 210");
  await vaultBalances(auction, "escrowed");
  await waitForSlot(closeSlot, "auction close");
  await computeClearing(auction);
  console.log(
    "\n  >>> now pause the ticker mint externally, then re-run with 'pause-settle <auction>'",
  );
  console.log(`  AUCTION=${auction.toBase58()}`);
  return auction;
}

async function runPauseSettle(auctionStr) {
  const auction = new PublicKey(auctionStr);
  console.log("### PAUSE TRAP: settlement attempt while mint is paused ###");
  await balances("before");
  await vaultBalances(auction, "before");
  try {
    await settle(auction, [0, 1]);
    console.log("  !! settle_batch SUCCEEDED -- expected failure while paused");
  } catch (e) {
    console.log(`  settle_batch failed as expected: ${e.error?.errorCode?.code ?? e.message?.split("\n")[0]}`);
    const logs = e.logs ?? e.simulationResponse?.logs ?? [];
    for (const l of logs.filter((l) => /error|fail|paused|Paused/i.test(l))) {
      console.log(`    log: ${l}`);
    }
  }
  const state = await program.account.auction.fetch(auction);
  console.log(
    `  auction still: status=${JSON.stringify(state.status)} settled=${state.settledCount}/${state.orderCount}`,
  );
  await balances("after failed settle");
  await vaultBalances(auction, "after failed settle");

  console.log("\n== cancel_and_refund on the BUY order (quote mint is not paused) ==");
  try {
    await settle(auction, [1], "refund");
    console.log("  buy-side refund succeeded while ticker mint paused");
  } catch (e) {
    console.log(`  buy-side refund failed: ${e.error?.errorCode?.code ?? e.message?.split("\n")[0]}`);
  }
  await balances("after buy refund");
  await vaultBalances(auction, "after buy refund");
  console.log(
    "\n  >>> now resume the mint, then re-run with 'pause-recover <auction>'",
  );
}

async function runPauseRecover(auctionStr) {
  const auction = new PublicKey(auctionStr);
  console.log("### PAUSE TRAP: recovery after resume ###");
  await settle(auction, [0], "refund");
  await balances("after sell refund");
  const v = await vaultBalances(auction, "final");
  const state = await program.account.auction.fetch(auction);
  console.log(
    `  auction status=${JSON.stringify(state.status)} settled=${state.settledCount}/${state.orderCount}`,
  );
  console.log(
    v.vt === 0n && v.vq === 0n
      ? "  VAULTS EMPTY -- nothing stranded"
      : `  !! STRANDED: ticker=${v.vt} quote=${v.vq}`,
  );
}

async function runMultiplier() {
  console.log("### MULTIPLIER TRAP TEST (devnet fixture) ###");
  const before = await balances("start");
  const { auction, closeSlot } = await openAuction({
    windowSlots: 150,
    freezeSlots: 20,
    cadenceSlots: 750,
  });
  await placeOrder(auction, deploy, "sell", usd(100), shares(6), "deploy SELL 6 @ 100");
  await placeOrder(auction, wallet2, "buy", usd(120), shares(6), "wallet2 BUY 6 @ 120");
  const escrow = await vaultBalances(auction, "escrowed (raw)");
  console.log(
    `\n  >>> now change the fixture mint's UI multiplier externally, then re-run with 'multiplier-settle ${auction.toBase58()} ${closeSlot}'`,
  );
  console.log(`  AUCTION=${auction.toBase58()} CLOSE=${closeSlot}`);
  console.log(
    `  EXPECT after settle: raw fill 600000000 ticker to wallet2, ${escrow.vq} raw quote split to deploy`,
  );
}

async function runMultiplierSettle(auctionStr, closeSlotStr) {
  const auction = new PublicKey(auctionStr);
  console.log("### MULTIPLIER TRAP: clear + settle after multiplier change ###");
  await waitForSlot(Number(closeSlotStr), "auction close");
  await computeClearing(auction);
  await balances("pre-settle (raw)");
  await settle(auction, [0, 1]);
  await balances("post-settle (raw)");
  const v = await vaultBalances(auction, "final");
  console.log(
    v.vt === 0n && v.vq === 0n
      ? "  VAULTS EMPTY"
      : `  vault remainder: ticker=${v.vt} quote=${v.vq}`,
  );
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
  console.error(
    "usage: node scripts/devnet-e2e.mjs <main|pause|pause-settle|pause-recover|multiplier|multiplier-settle>",
  );
  process.exit(1);
}

await run();
console.log("\n=== signatures ===");
for (const { label, sig } of sigs) console.log(`${label}\t${sig}`);
