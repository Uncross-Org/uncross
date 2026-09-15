// Multi-batch settlement on devnet: a 42-order book from 42 distinct owners,
// settled in 7-order crank batches submitted out of order, with a duplicate
// batch, an overlapping batch that straddles settled and unsettled orders, a
// mid-settlement compute_clearing, and an attempt to switch to the refund path
// after clear-settlement has begun.
//
//   node scripts/devnet-multibatch.mjs [batchSize=7]
import fs from "node:fs";
import anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
} from "@solana/spl-token";
import {
  loadKeypair,
  keypairPath,
  loadFixture,
  getProgram,
  auctionPda,
  orderPda,
  tickerAta,
  quoteAta,
  vaultTickerAta,
  vaultQuoteAta,
  fetchAuction,
  getAccountsBatched,
  tokenAmountOf,
  sendV0,
  waitForSlot,
  withRetry,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "./lib.mjs";

const { BN } = anchor;
const { Keypair, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const BATCH = Number(process.argv[2] ?? 7);
const N_ORDERS = 42;
const SHARE = 100_000_000n; // 8 decimals
const PRICE_HI = 100_370_000n; // 100.37 quote, 6 decimals
const PRICE_LO = 90_000_000n; // 90.00
const BUYER_QUOTE = 1_100_000_000n; // 1,100 USDC-equivalent, covers 10 @ 100.37

const deploy = loadKeypair("deploy"); // mint authority, crank, fee payer
const funder = loadKeypair("wallet2"); // pays owner SOL + ATA rent
const fx = loadFixture();
const { program, connection } = getProgram(deploy);
const ID = program.programId;

function loadOwners() {
  const p = keypairPath("mb-owners");
  if (fs.existsSync(p)) {
    return JSON.parse(fs.readFileSync(p, "utf8")).map((s) => Keypair.fromSecretKey(Uint8Array.from(s)));
  }
  const owners = Array.from({ length: N_ORDERS }, () => Keypair.generate());
  fs.writeFileSync(p, JSON.stringify(owners.map((k) => Array.from(k.secretKey))), { mode: 0o600 });
  return owners;
}

// Interleaved so the pro-rata BUY tier (all 22 buys at 100.37) is spread across
// every settlement batch: even indices < 40 and 40, 41 buy; odd indices sell.
function bookEntry(i) {
  if (i >= 40 || i % 2 === 0) return { side: "buy", price: PRICE_HI, qty: 10n * SHARE };
  const sellRank = (i - 1) / 2; // 0..19
  return { side: "sell", price: sellRank < 18 ? PRICE_LO : PRICE_HI, qty: 10n * SHARE };
}

const sigs = [];
const record = (label, r) => {
  sigs.push({ label, ...r });
  console.log(`  ${label}: ${r.sig}${r.cu !== undefined ? `  (${r.cu} CU, ${r.size} bytes)` : ""}`);
};

async function balancesOf(owners) {
  const keys = owners.flatMap((kp) => [tickerAta(kp.publicKey, fx.tickerMint), quoteAta(kp.publicKey, fx.quoteMint)]);
  const infos = await getAccountsBatched(connection, keys);
  return owners.map((_, i) => ({ ticker: tokenAmountOf(infos[2 * i]), quote: tokenAmountOf(infos[2 * i + 1]) }));
}

async function fund(owners) {
  console.log(`\n== funding ${owners.length} distinct owners ==`);
  const solInfos = await getAccountsBatched(connection, owners.map((k) => k.publicKey));
  const bals = await balancesOf(owners);
  const need = owners
    .map((_, i) => i)
    .filter((i) => {
      const e = bookEntry(i);
      const lamports = solInfos[i]?.lamports ?? 0;
      const have = e.side === "sell" ? bals[i].ticker : bals[i].quote;
      return lamports < 0.003 * LAMPORTS_PER_SOL || have < (e.side === "sell" ? e.qty : BUYER_QUOTE);
    });
  console.log(`  ${owners.length - need.length} already funded, ${need.length} to fund`);
  for (let k = 0; k < need.length; k += 3) {
    const ixs = [];
    for (const i of need.slice(k, k + 3)) {
      const o = owners[i].publicKey;
      const e = bookEntry(i);
      const tAta = tickerAta(o, fx.tickerMint);
      const qAta = quoteAta(o, fx.quoteMint);
      ixs.push(
        SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: o, lamports: 0.004 * LAMPORTS_PER_SOL }),
        createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, tAta, o, fx.tickerMint, TICKER_PROGRAM, ASSOCIATED_TOKEN_PROGRAM),
        createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, qAta, o, fx.quoteMint, QUOTE_PROGRAM, ASSOCIATED_TOKEN_PROGRAM),
        e.side === "sell"
          ? createMintToCheckedInstruction(fx.tickerMint, tAta, deploy.publicKey, e.qty, 8, [], TICKER_PROGRAM)
          : createMintToCheckedInstruction(fx.quoteMint, qAta, deploy.publicKey, BUYER_QUOTE, 6, [], QUOTE_PROGRAM),
      );
    }
    const r = await sendV0(connection, funder, [deploy], ixs, { cuLimit: 300_000 });
    console.log(`  funded owners ${need.slice(k, k + 3).join(",")}: ${r.sig}`);
  }
}

async function settleIx(auction, indices, owners, mode) {
  const remaining = indices.flatMap((i) => [
    { pubkey: orderPda(ID, auction, i), isWritable: true, isSigner: false },
    { pubkey: tickerAta(owners[i].publicKey, fx.tickerMint), isWritable: true, isSigner: false },
    { pubkey: quoteAta(owners[i].publicKey, fx.quoteMint), isWritable: true, isSigner: false },
  ]);
  const m = mode === "refund" ? program.methods.cancelAndRefund(indices) : program.methods.settleBatch(indices);
  return m
    .accountsStrict({
      caller: deploy.publicKey,
      auction,
      vaultTicker: vaultTickerAta(auction, fx.tickerMint),
      vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
      tickerMint: fx.tickerMint,
      quoteMint: fx.quoteMint,
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
    })
    .remainingAccounts(remaining)
    .instruction();
}

async function settle(label, auction, indices, owners) {
  record(label, await sendV0(connection, deploy, [], [await settleIx(auction, indices, owners)], { cuLimit: 1_000_000 }));
}

async function vaults(auction, tag) {
  const infos = await getAccountsBatched(connection, [vaultTickerAta(auction, fx.tickerMint), vaultQuoteAta(auction, fx.quoteMint)]);
  const v = { vt: tokenAmountOf(infos[0]), vq: tokenAmountOf(infos[1]) };
  console.log(`  [${tag}] vault ticker=${v.vt} quote=${v.vq}`);
  return v;
}

async function state(auction, tag) {
  const a = await fetchAuction(connection, auction);
  console.log(`  [${tag}] status=${a.status} settled=${a.settledCount}/${a.orderCount} path=${a.settlePath}`);
  return a;
}

async function main() {
  console.log(`### MULTI-BATCH SETTLEMENT (devnet, batch=${BATCH}) ###`);
  const owners = loadOwners();
  await fund(owners);
  const before = await balancesOf(owners);

  const openSlot = await withRetry(() => connection.getSlot("confirmed"));
  const closeSlot = openSlot + 700;
  const auction = auctionPda(ID, fx.tickerMint, openSlot);
  console.log(`\n== initialize_auction (open=${openSlot} close=${closeSlot}) ==`);
  const initIx = await program.methods
    .initializeAuction(new BN(openSlot), new BN(closeSlot), new BN(30), new BN(750), Array(32).fill(0))
    .accountsStrict({
      payer: deploy.publicKey,
      auction,
      tickerMint: fx.tickerMint,
      quoteMint: fx.quoteMint,
      vaultTicker: vaultTickerAta(auction, fx.tickerMint),
      vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  record("initialize_auction", await sendV0(connection, deploy, [], [initIx]));
  console.log(`  auction: ${auction.toBase58()}`);

  console.log(`\n== placing ${N_ORDERS} orders from ${N_ORDERS} distinct owners ==`);
  const indicative = [];
  for (let i = 0; i < N_ORDERS; i++) {
    const e = bookEntry(i);
    const owner = owners[i];
    const ix = await program.methods
      .placeOrder(e.side === "buy" ? { buy: {} } : { sell: {} }, new BN(e.price.toString()), new BN(e.qty.toString()), i)
      .accountsStrict({
        owner: owner.publicKey,
        auction,
        order: orderPda(ID, auction, i),
        vaultTicker: vaultTickerAta(auction, fx.tickerMint),
        vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
        ownerTickerAta: tickerAta(owner.publicKey, fx.tickerMint),
        ownerQuoteAta: quoteAta(owner.publicKey, fx.quoteMint),
        tickerMint: fx.tickerMint,
        quoteMint: fx.quoteMint,
        tickerTokenProgram: TICKER_PROGRAM,
        quoteTokenProgram: QUOTE_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    const r = await sendV0(connection, deploy, [owner], [ix]);
    const a = await fetchAuction(connection, auction);
    indicative.push({ i, price: a.indicativePrice.toString(), volume: a.indicativeVolume.toString() });
    record(`place_order#${i} ${e.side} ${Number(e.qty / SHARE)} @ ${Number(e.price) / 1e6} -> indicative ${Number(a.indicativePrice) / 1e6} / ${Number(a.indicativeVolume) / 1e8}`, r);
  }

  await vaults(auction, "escrowed");
  await waitForSlot(connection, closeSlot, "auction close");

  console.log("\n== compute_clearing ==");
  const clearIx = await program.methods
    .computeClearing()
    .accountsStrict({ caller: deploy.publicKey, auction, tickerMint: fx.tickerMint, pythPriceFeed: SystemProgram.programId })
    .instruction();
  record("compute_clearing", await sendV0(connection, deploy, [], [clearIx], { cuLimit: 800_000 }));
  const cleared = await fetchAuction(connection, auction);
  console.log(`  clearing_price=${cleared.clearingPrice} executable_volume=${cleared.executableVolume}`);
  const buys = cleared.orders.filter((o) => o.side === "buy");
  const sells = cleared.orders.filter((o) => o.side === "sell");
  const sum = (xs, f) => xs.reduce((s, o) => s + f(o), 0n);
  console.log(`  fills  buy=${sum(buys, (o) => o.filledQuantity)} sell=${sum(sells, (o) => o.filledQuantity)}`);
  console.log(`  quote  buyers charged=${sum(buys, (o) => o.quoteAmount)} sellers paid=${sum(sells, (o) => o.quoteAmount)}`);
  console.log(`  buy fills by index: ${buys.map((o) => `#${o.index}:${o.filledQuantity}`).join(" ")}`);
  console.log(`  buy charges by index: ${buys.map((o) => `#${o.index}:${o.quoteAmount}`).join(" ")}`);

  const batch = (k) => Array.from({ length: BATCH }, (_, j) => k * BATCH + j).filter((i) => i < N_ORDERS);
  const nBatches = Math.ceil(N_ORDERS / BATCH);
  const first = Math.floor(nBatches / 2);

  console.log(`\n== settlement: ${nBatches} batches of ${BATCH}, starting in the middle ==`);
  await settle(`settle_batch #${first} [${batch(first)}]`, auction, batch(first), owners);
  const afterFirst = await state(auction, "after first batch");
  const vFirst = await vaults(auction, "after first batch");

  console.log("\n-- same batch submitted again (expect no-op) --");
  await settle(`settle_batch #${first} again`, auction, batch(first), owners);
  const afterDup = await state(auction, "after duplicate");
  const vDup = await vaults(auction, "after duplicate");
  console.log(
    afterDup.settledCount === afterFirst.settledCount && vDup.vt === vFirst.vt && vDup.vq === vFirst.vq
      ? "  duplicate batch was a no-op: settled count and both vaults unchanged"
      : "  !! duplicate batch changed state",
  );

  console.log("\n-- compute_clearing mid-settlement (expect no-op) --");
  record("compute_clearing mid-settlement", await sendV0(connection, deploy, [], [clearIx], { cuLimit: 800_000 }));
  const mid = await fetchAuction(connection, auction);
  const fillsSame = mid.orders.every((o, i) => o.filledQuantity === cleared.orders[i].filledQuantity && o.quoteAmount === cleared.orders[i].quoteAmount);
  console.log(mid.clearingPrice === cleared.clearingPrice && fillsSame && mid.settledCount === afterDup.settledCount
    ? "  clearing, fills and quote amounts unchanged; settlement progress intact"
    : "  !! mid-settlement clearing changed state");

  console.log("\n-- cancel_and_refund after clear-settlement began (expect SettlementPathLocked) --");
  try {
    await sendV0(connection, deploy, [], [await settleIx(auction, batch(0), owners, "refund")], { cuLimit: 1_000_000 });
    console.log("  !! refund path was allowed");
  } catch (e) {
    console.log(`  rejected: ${(e.logs ?? []).find((l) => l.includes("Error Code")) ?? e.message}`);
  }

  const overlap = [...batch(first).slice(-3), ...batch(first + 1).slice(0, 4)];
  console.log(`\n-- overlapping batch [${overlap}]: 3 already settled + 4 not (expect exactly 4 newly settled) --`);
  await settle(`settle_batch overlap [${overlap}]`, auction, overlap, owners);
  const afterOverlap = await state(auction, "after overlap");
  console.log(afterOverlap.settledCount === afterDup.settledCount + 4 ? "  overlap settled exactly the 4 unsettled orders" : "  !! overlap settled count wrong");

  const rest = [...Array(nBatches).keys()].filter((k) => k !== first).reverse();
  for (const k of rest) {
    await settle(`settle_batch #${k} [${batch(k)}]`, auction, batch(k), owners);
    await state(auction, `after batch #${k}`);
  }

  console.log("\n== final verification ==");
  const final = await state(auction, "final");
  const v = await vaults(auction, "final");
  const after = await balancesOf(owners);
  let mismatches = 0;
  for (const o of final.orders) {
    const d = { ticker: after[o.index].ticker - before[o.index].ticker, quote: after[o.index].quote - before[o.index].quote };
    const want = o.side === "buy"
      ? { ticker: o.filledQuantity, quote: -o.quoteAmount }
      : { ticker: -o.filledQuantity, quote: o.quoteAmount };
    if (d.ticker !== want.ticker || d.quote !== want.quote) {
      mismatches++;
      console.log(`  !! owner #${o.index}: got ticker ${d.ticker} quote ${d.quote}, want ticker ${want.ticker} quote ${want.quote}`);
    }
  }
  console.log(`  per-owner balance deltas: ${N_ORDERS - mismatches}/${N_ORDERS} exactly match fill and quote amount`);
  console.log(v.vt === 0n && v.vq === 0n ? "  BOTH VAULTS EXACTLY ZERO" : `  !! vault remainder ticker=${v.vt} quote=${v.vq}`);

  const settles = sigs.filter((s) => s.label.startsWith("settle_batch") && s.cu);
  console.log(`\n  settle_batch CU: ${settles.map((s) => s.cu).join(", ")} | max size ${Math.max(...settles.map((s) => s.size))} bytes`);
  console.log("\n=== signatures ===");
  for (const s of sigs) console.log(`${s.label}\t${s.sig}\t${s.cu ?? ""}\t${s.size ?? ""}`);
  fs.writeFileSync(new URL("./.multibatch-result.json", import.meta.url), JSON.stringify({
    auction: auction.toBase58(), batch: BATCH, openSlot, closeSlot, indicative, sigs,
  }, null, 2));
}

await main();
