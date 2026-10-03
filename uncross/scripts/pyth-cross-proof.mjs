// End-to-end proof that the program takes a pulled Pyth update: a real
// compute_clearing, on devnet, against a PriceUpdateV2 account posted from
// Hermes a few seconds earlier through the fully verified path.
//
// Opens a short auction bound to the given feed on a mint that is not listed
// (so no visitor ever sees the book), posts the latest update for that feed,
// runs the cross the moment the window closes, reads what the gate recorded,
// then closes the price update, the encoded VAA and the auction, so the run
// costs only fees.
//
//   railway run --service uncross-keeper -- node scripts/pyth-cross-proof.mjs <FEED_ID> [MINT]
import fs from "node:fs";
import anchor from "@coral-xyz/anchor";
import {
  loadKeypair, loadFixture, getProgram, auctionPda, vaultTickerAta, vaultQuoteAta, decodeAuction, sendV0, sleep,
  TICKER_PROGRAM, QUOTE_PROGRAM, ASSOCIATED_TOKEN_PROGRAM, GATE,
} from "./lib.mjs";
import { buildPostUpdate, fetchLatestUpdate } from "./pyth-pull.mjs";

const { BN } = anchor;
const { PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;
const FEED = (process.argv[2] ?? "").replace(/^0x/, "");
if (!/^[0-9a-f]{64}$/.test(FEED)) throw new Error("usage: pyth-cross-proof.mjs <FEED_ID> [MINT]");
// FRx: a fixture mint the 23 Sept run created but never listed.
const MINT = new PublicKey(process.argv[3] ?? "6KQ4HSxYGuNbLCaTvMkxcZDYb2XxRQ71vPtPHJDksoqq");
const WINDOW = 150, FREEZE = 20;

const deploy = loadKeypair("deploy");
const fx = loadFixture();
const { program, connection } = getProgram(deploy);
const ID = program.programId;
const log = (...a) => console.log(new Date().toISOString(), ...a);
const tx = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const out = { feed: FEED, mint: MINT.toBase58(), steps: [] };
const step = (name, sig, extra = {}) => { out.steps.push({ name, sig, explorer: tx(sig), ...extra }); log(`${name} — ${tx(sig)}`); };

const before = await connection.getBalance(deploy.publicKey, "confirmed");

// 1. A short auction bound to the feed.
const openSlot = await connection.getSlot("confirmed");
const auction = auctionPda(ID, MINT, openSlot);
const init = await program.methods
  .initializeAuction(new BN(openSlot), new BN(openSlot + WINDOW), new BN(FREEZE), new BN(WINDOW), Array.from(Buffer.from(FEED, "hex")))
  .accountsStrict({
    payer: deploy.publicKey, auction, tickerMint: MINT, quoteMint: fx.quoteMint,
    vaultTicker: vaultTickerAta(auction, MINT), vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
    tickerTokenProgram: TICKER_PROGRAM, quoteTokenProgram: QUOTE_PROGRAM, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM, systemProgram: SystemProgram.programId,
  })
  .instruction();
step(`open auction ${auction.toBase58()} (slots ${openSlot}..${openSlot + WINDOW})`, (await sendV0(connection, deploy, [], [init])).sig);
out.auction = auction.toBase58();

// 2. Wait until the window is nearly over, so the print is as fresh as it can be at the cross.
while ((await connection.getSlot("confirmed")) < openSlot + WINDOW - 70) await sleep(1000);
const update = await fetchLatestUpdate([FEED]);
out.hermes = update.parsed[0];
log(`Hermes print $${out.hermes.price} published ${new Date(out.hermes.publishTime * 1000).toISOString()}`);
const built = await buildPostUpdate(connection, deploy, update.binary[0], "core");
for (const g of built.groups) step(g.label, (await sendV0(connection, deploy, g.signers, g.ixs, { cuLimit: g.cu })).sig);
const priceAccount = built.accounts[FEED];
out.priceUpdateAccount = priceAccount.toBase58();

// 3. The cross, the moment the window closes.
while ((await connection.getSlot("confirmed")) < openSlot + WINDOW) await sleep(400);
const cross = await program.methods
  .computeClearing()
  .accountsStrict({ caller: deploy.publicKey, auction, tickerMint: MINT, pythPriceFeed: priceAccount })
  .instruction();
const crossSig = (await sendV0(connection, deploy, [], [cross], { cuLimit: 800_000 })).sig;
const crossTx = await connection.getTransaction(crossSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
const a = decodeAuction((await connection.getAccountInfo(auction, "confirmed")).data);
out.gate = {
  outcome: GATE[a.oracleGate] ?? a.oracleGate,
  publishTime: a.oraclePublishTime,
  crossBlockTime: crossTx.blockTime,
  ageAtCrossSecs: crossTx.blockTime - a.oraclePublishTime,
  referencePriceSet: a.referencePriceSet,
  referencePriceRaw: a.referencePrice.toString(),
  status: a.status,
};
step(`cross: gate ${out.gate.outcome}, print ${out.gate.ageAtCrossSecs}s old at the cross block`, crossSig, { gate: out.gate });

// 4. Close everything that was created.
for (const c of built.close) step(c.label, (await sendV0(connection, deploy, [], c.ixs, { cuLimit: c.cu })).sig);
try {
  const closeIx = await program.methods
    .closeAuction()
    .accountsStrict({
      caller: deploy.publicKey, auction, rentRecipient: deploy.publicKey,
      vaultTicker: vaultTickerAta(auction, MINT), vaultQuote: vaultQuoteAta(auction, fx.quoteMint),
      tickerTokenProgram: TICKER_PROGRAM, quoteTokenProgram: QUOTE_PROGRAM,
    })
    .instruction();
  step("close auction", (await sendV0(connection, deploy, [], [closeIx])).sig);
} catch (e) {
  log(`close auction refused (${e.message.slice(0, 120)}); the keeper closes empty auctions on its own`);
}

const after = await connection.getBalance(deploy.publicKey, "confirmed");
out.netCostSol = (before - after) / LAMPORTS_PER_SOL;
log(`net cost to deploy: ${out.netCostSol} SOL`);
fs.writeFileSync(new URL("./pyth-cross-proof-result.json", import.meta.url), JSON.stringify(out, null, 2));
