// close_auction: every refusal path first, then the one close that should work.
//
//   RPC_URL=http://127.0.0.1:8899 node scripts/close-auction-test.mjs   (local rehearsal)
//   RPC_URLS=<dedicated devnet endpoint> node scripts/close-auction-test.mjs
//
// The rule under test: rent may only be reclaimed from an auction that can no
// longer owe anyone anything. Fully settled, both vaults exactly zero, rent
// back to whoever paid it. Anything else must be refused, because stranding
// escrow to recover rent is strictly worse than leaking the rent.
//
// Exits non-zero if any refusal is accepted or the happy path fails.
import anchor from "@coral-xyz/anchor";
import { createTransferCheckedInstruction } from "@solana/spl-token";
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
  RPC_URL,
} from "./lib.mjs";

const { BN } = anchor;
const { PublicKey, SystemProgram } = anchor.web3;

const deploy = loadKeypair("deploy");
const wallet2 = loadKeypair("wallet2");
const fx = loadFixture();
const MINT = fx.tickerMint;
const { program, connection } = getProgram(deploy);
const ID = program.programId;

// A settled auction created before close_auction existed, so its payer bytes
// are zero. Only checked when present on the target cluster.
const LEGACY_SETTLED = process.env.LEGACY_AUCTION ?? "5b3m3zYQxB26pH7vyKkGpBTGy5DqBy83SG8vxmgEeMw";

const results = [];
const pass = (name, detail) => {
  results.push({ name, ok: true });
  console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`);
};
const fail = (name, detail) => {
  results.push({ name, ok: false });
  console.log(`  FAIL  ${name} — ${detail}`);
};

const errorCode = (e) => {
  const logs = e?.logs ?? e?.simulationResponse?.logs ?? [];
  const line = logs.find((l) => l.includes("Error Code:"));
  if (line) return line.match(/Error Code: (\w+)/)?.[1] ?? line;
  return String(e?.message ?? e).slice(0, 160);
};

const common = (auction) => ({
  auction,
  vaultTicker: vaultTickerAta(auction, MINT),
  vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
  tickerMint: MINT,
  quoteMint: fx.quoteMint,
  tickerTokenProgram: TICKER_PROGRAM,
  quoteTokenProgram: QUOTE_PROGRAM,
});

const atasOf = (owner) =>
  owner.publicKey.equals(deploy.publicKey)
    ? { ticker: tickerAta(deploy.publicKey, MINT), quote: fx.deployQuoteAta }
    : { ticker: tickerAta(wallet2.publicKey, MINT), quote: fx.wallet2QuoteAta };

async function openAuction(windowSlots, freezeSlots) {
  const openSlot = await connection.getSlot("confirmed");
  const auction = auctionPda(ID, MINT, openSlot);
  const ix = await program.methods
    .initializeAuction(new BN(openSlot), new BN(openSlot + windowSlots), new BN(freezeSlots), new BN(windowSlots), Array(32).fill(0))
    .accountsStrict({
      payer: deploy.publicKey,
      tickerMint: MINT,
      quoteMint: fx.quoteMint,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
      auction,
      vaultTicker: vaultTickerAta(auction, MINT),
      vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
    })
    .instruction();
  await sendV0(connection, deploy, [], [ix]);
  return { auction, closeSlot: openSlot + windowSlots };
}

async function placeOrder(auction, owner, side, usdPerToken, tokens) {
  const index = (await fetchAuction(connection, auction)).orderCount;
  const atas = atasOf(owner);
  const ix = await program.methods
    .placeOrder(side === "buy" ? { buy: {} } : { sell: {} }, new BN(Math.round(usdPerToken * 1e6)), new BN(Math.round(tokens * 1e8)), index)
    .accountsStrict({
      owner: owner.publicKey,
      order: orderPda(ID, auction, index),
      ownerTickerAta: atas.ticker,
      ownerQuoteAta: atas.quote,
      systemProgram: SystemProgram.programId,
      ...common(auction),
    })
    .instruction();
  await sendV0(connection, deploy, [owner], [ix]);
}

async function computeClearing(auction) {
  const ix = await program.methods
    .computeClearing()
    .accountsStrict({ caller: deploy.publicKey, auction, tickerMint: MINT, pythPriceFeed: SystemProgram.programId })
    .instruction();
  await sendV0(connection, deploy, [], [ix], { cuLimit: 800_000 });
}

async function settle(auction, indices) {
  const remaining = [];
  for (const i of indices) {
    const order = await program.account.order.fetch(orderPda(ID, auction, i));
    const atas = order.owner.equals(deploy.publicKey) ? atasOf(deploy) : atasOf(wallet2);
    remaining.push(
      { pubkey: orderPda(ID, auction, i), isWritable: true, isSigner: false },
      { pubkey: atas.ticker, isWritable: true, isSigner: false },
      { pubkey: atas.quote, isWritable: true, isSigner: false },
    );
  }
  const ix = await program.methods
    .settleBatch(indices)
    .accountsStrict({ caller: deploy.publicKey, ...common(auction) })
    .remainingAccounts(remaining)
    .instruction();
  await sendV0(connection, deploy, [], [ix], { cuLimit: 1_000_000 });
}

async function closeIx(auction, rentRecipient) {
  return program.methods
    .closeAuction()
    .accountsStrict({
      caller: deploy.publicKey,
      auction,
      rentRecipient,
      vaultTicker: vaultTickerAta(auction, MINT),
      vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
    })
    .instruction();
}

/** Attempt a close that must be refused with a specific error. */
async function expectRefused(name, auction, recipient, wantCodes) {
  const want = Array.isArray(wantCodes) ? wantCodes : [wantCodes];
  try {
    const r = await sendV0(connection, deploy, [], [await closeIx(auction, recipient)]);
    fail(name, `close was ACCEPTED (${r.sig}) — this must never happen`);
  } catch (e) {
    const code = errorCode(e);
    if (want.includes(code)) pass(name, `refused with ${code}`);
    else fail(name, `refused, but with ${code} instead of ${want.join(" or ")}`);
  }
  // Whatever happened, the auction must still exist afterwards.
  const still = await connection.getAccountInfo(auction, "confirmed");
  if (!still) fail(`${name} (account intact)`, "auction account no longer exists");
}

async function main() {
  console.log(`close_auction test against ${RPC_URL}`);
  console.log(`program ${ID.toBase58()}\n`);

  // Auction A: one buy and one sell that cross, so it has real escrow in both
  // vaults until it is fully settled.
  const window = Number(process.env.WINDOW_SLOTS ?? 60);
  const A = await openAuction(window, 10);
  console.log(`auction A ${A.auction.toBase58()} (close slot ${A.closeSlot})`);
  await placeOrder(A.auction, deploy, "buy", 331, 1);
  await placeOrder(A.auction, wallet2, "sell", 329, 1);

  console.log("\n1. mid-window, orders in escrow");
  await expectRefused("mid-window", A.auction, deploy.publicKey, "AuctionNotSettled");

  await waitForSlot(connection, A.closeSlot, "A close");
  await computeClearing(A.auction);
  const cleared = await fetchAuction(connection, A.auction);
  console.log(`\n2. cleared, not settled (status=${cleared.status}, settled ${cleared.settledCount}/${cleared.orderCount})`);
  await expectRefused("cleared, not settled", A.auction, deploy.publicKey, "AuctionNotSettled");

  await settle(A.auction, [0]);
  const partial = await fetchAuction(connection, A.auction);
  console.log(`\n3. partially settled (status=${partial.status}, settled ${partial.settledCount}/${partial.orderCount})`);
  await expectRefused("partially settled", A.auction, deploy.publicKey, "AuctionNotSettled");

  await settle(A.auction, [1]);
  const done = await fetchAuction(connection, A.auction);
  const vt = await tokenAmount(connection, vaultTickerAta(A.auction, MINT));
  const vq = await tokenAmount(connection, vaultQuoteAta(A.auction, fx.quoteMint));
  console.log(`\n   A now status=${done.status}, settled ${done.settledCount}/${done.orderCount}, vaults ticker=${vt} quote=${vq}`);

  console.log("\n4. legacy auction with no recorded payer");
  const legacy = new PublicKey(LEGACY_SETTLED);
  const legacyInfo = await connection.getAccountInfo(legacy, "confirmed");
  if (!legacyInfo || !legacyInfo.owner.equals(ID)) {
    console.log(`  SKIP  legacy auction ${LEGACY_SETTLED} not present on this cluster`);
  } else {
    // Its payer reads as the zero key; the address constraint only lets the
    // call reach the handler if the recipient matches that, so pass it.
    // Refusal can come from the handler (UnknownRentPayer) or earlier, because
    // the zero key is the System Program and cannot be taken writable.
    await expectRefused("legacy, payer unknown", legacy, SystemProgram.programId, ["UnknownRentPayer", "ConstraintMut"]);
  }

  // Auction B: nobody trades, so it is settled the moment it clears and both
  // vaults are empty — then a stray token is sent into its quote vault.
  console.log("\n5. settled, but a vault is not empty");
  const B = await openAuction(Math.max(20, Math.floor(window / 3)), 2);
  await waitForSlot(connection, B.closeSlot, "B close");
  await computeClearing(B.auction);
  const quoteVaultB = vaultQuoteAta(B.auction, fx.quoteMint);
  await sendV0(connection, deploy, [], [
    createTransferCheckedInstruction(fx.deployQuoteAta, fx.quoteMint, quoteVaultB, deploy.publicKey, 1n, 6, [], QUOTE_PROGRAM),
  ]);
  console.log(`   B quote vault now holds ${await tokenAmount(connection, quoteVaultB)} raw unit(s)`);
  await expectRefused("settled, vault not empty", B.auction, deploy.publicKey, "VaultNotEmpty");

  console.log("\n6. fully settled, empty vaults, wrong rent recipient");
  await expectRefused("wrong rent recipient", A.auction, wallet2.publicKey, "WrongRentRecipient");

  console.log("\n7. fully settled, empty vaults, rent back to the payer");
  const before = await connection.getBalance(deploy.publicKey, "confirmed");
  const reclaimable =
    (await connection.getBalance(A.auction, "confirmed")) +
    (await connection.getBalance(vaultTickerAta(A.auction, MINT), "confirmed")) +
    (await connection.getBalance(vaultQuoteAta(A.auction, fx.quoteMint), "confirmed"));
  try {
    const r = await sendV0(connection, deploy, [], [await closeIx(A.auction, deploy.publicKey)]);
    const after = await connection.getBalance(deploy.publicKey, "confirmed");
    const gone = await Promise.all(
      [A.auction, vaultTickerAta(A.auction, MINT), vaultQuoteAta(A.auction, fx.quoteMint)].map((k) => connection.getAccountInfo(k, "confirmed")),
    );
    const allGone = gone.every((x) => x === null);
    const net = (after - before) / 1e9;
    if (allGone) pass("happy path", `${r.sig.slice(0, 16)}… auction and both vaults closed; payer ${net >= 0 ? "+" : ""}${net.toFixed(6)} SOL (reclaimable ${(reclaimable / 1e9).toFixed(6)})`);
    else fail("happy path", "close succeeded but an account still exists");
  } catch (e) {
    fail("happy path", `close was refused: ${errorCode(e)}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error("test aborted:", errorCode(e));
  process.exit(1);
});
