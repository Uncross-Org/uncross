// Uncross keeper: opens auctions on a cadence and cranks them through the cross.
// Every instruction it sends is permissionless except initialize_auction's rent.
//
//   node scripts/keeper.mjs --cluster devnet --cadence 750 --freeze 75
//   node scripts/keeper.mjs --cluster mainnet --no-open        # crank only
//   node scripts/keeper.mjs --cluster devnet --once            # one pass, then exit
//
// Cadence is in slots (~0.4s each): 750 is a five-minute demo window, 9000 is
// hourly. The program stores it; nothing else changes between the two.
import fs from "node:fs";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import {
  loadKeypair,
  decodeAuction,
  orderPda,
  tickerAta,
  quoteAta,
  vaultTickerAta,
  vaultQuoteAta,
  auctionPda,
  sendV0,
  sleep,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "./lib.mjs";
import { listAuctions as listAuctionsIndexed, rememberAuction } from "./auction-index.mjs";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const { Connection, PublicKey, SystemProgram } = anchor.web3;

const AAPL_FEED = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const IBM_FEED = "cfd44471407f4da89d469242546bb56f5c626d5bef9bd8b9327783065b43c3ef";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

const CLUSTERS = {
  devnet: {
    rpc: process.env.DEVNET_RPC ?? "https://api.devnet.solana.com",
    quoteMint: "22BrsoDTwXigFmNnMRxfTQ66ksS4SgP5k5k9UcdrRP87",
    tickers: [
      { symbol: "AAPLx", mint: "BvgVkJawYWrWV2eu5ousJUvGWwbgDTUdyr9vBM27BYYG", feed: AAPL_FEED },
      { symbol: "IBMx", mint: "9aGoR5JbatqRYbc4SpQuT3pWVLPhZQJvDq26FFb23Jzp", feed: IBM_FEED },
    ],
  },
  mainnet: {
    rpc: process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com",
    quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tickers: [
      { symbol: "AAPLx", mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", feed: AAPL_FEED },
      { symbol: "IBMx", mint: "XspwhyYPdWVM8XBHZnpS9hgyag9MKjLRyE3tVfmCbSr", feed: IBM_FEED },
    ],
  },
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const clusterName = opt("cluster", "devnet");
const cfg = CLUSTERS[clusterName];
if (!cfg) throw new Error(`unknown cluster ${clusterName}`);
const CADENCE = Number(opt("cadence", 750));
const FREEZE = Number(opt("freeze", Math.round(CADENCE / 10)));
const ONLY = opt("ticker", null);
const BATCH = 7;

const payer = loadKeypair(opt("payer", "deploy"));
const connection = new Connection(cfg.rpc, "confirmed");
const idl = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "../target/idl/uncross.json"), "utf8"));
const program = new Program(idl, new AnchorProvider(connection, new Wallet(payer), { commitment: "confirmed" }));
const ID = program.programId;
const QUOTE = new PublicKey(cfg.quoteMint);

const log = (...a) => console.log(new Date().toISOString(), ...a);

// The sponsored push feed can live on any shard; use whichever one is freshest.
async function pythAccountFor(feedHex) {
  const id = Buffer.from(feedHex, "hex");
  const pdas = [0, 1, 2, 3].map((sh) => {
    const s = Buffer.alloc(2);
    s.writeUInt16LE(sh);
    return PublicKey.findProgramAddressSync([s, id], PYTH_PUSH_ORACLE)[0];
  });
  const infos = await connection.getMultipleAccountsInfo(pdas);
  let best = null;
  infos.forEach((info, i) => {
    if (!info || info.data.length < 101) return;
    const t = Number(info.data.readBigInt64LE(93));
    if (!best || t > best.t) best = { key: pdas[i], t };
  });
  return best?.key ?? SystemProgram.programId;
}

// Reads auctions by address through the shared index rather than
// getProgramAccounts, which the public devnet RPC rate-limits into
// uselessness once more than one consumer polls it. See
// scripts/auction-index.mjs for the measurements.
async function listAuctions(mint) {
  return listAuctionsIndexed(connection, ID, mint);
}

async function openAuction(t, mint, slot) {
  const auction = auctionPda(ID, mint, slot);
  const ix = await program.methods
    .initializeAuction(new BN(slot), new BN(slot + CADENCE), new BN(FREEZE), new BN(CADENCE), Array.from(Buffer.from(t.feed, "hex")))
    .accountsStrict({
      payer: payer.publicKey,
      auction,
      tickerMint: mint,
      quoteMint: QUOTE,
      vaultTicker: vaultTickerAta(auction, mint),
      vaultQuote: vaultQuoteAta(auction, QUOTE),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const r = await sendV0(connection, payer, [], [ix]);
  // The keeper knows this address first-hand, so record it straight away: the
  // index never has to discover an auction we opened ourselves.
  rememberAuction(auction);
  log(`${t.symbol} opened ${auction.toBase58()} slots ${slot}..${slot + CADENCE} (freeze ${FREEZE})`, r.sig);
}

async function clear(t, mint, a) {
  const pyth = await pythAccountFor(t.feed);
  const ix = await program.methods
    .computeClearing()
    .accountsStrict({ caller: payer.publicKey, auction: a.pubkey, tickerMint: mint, pythPriceFeed: pyth })
    .instruction();
  const r = await sendV0(connection, payer, [], [ix], { cuLimit: 800_000 });
  const after = decodeAuction((await connection.getAccountInfo(a.pubkey, "confirmed")).data);
  log(
    `${t.symbol} cleared ${a.pubkey.toBase58()} at ${after.clearingPrice} x ${after.executableVolume}`,
    `(${after.orderCount} orders, pyth anchor ${after.referencePriceSet ? after.referencePrice : "none"})`,
    r.sig,
  );
}

async function settleNext(t, mint, a) {
  if (a.orderCount === 0) return;
  const pdas = [...Array(a.orderCount).keys()].map((i) => orderPda(ID, a.pubkey, i));
  const infos = await connection.getMultipleAccountsInfo(pdas, "confirmed");
  const pending = [];
  infos.forEach((info, i) => {
    if (!info) return;
    const o = program.coder.accounts.decode("order", info.data);
    if (!o.settled) pending.push({ i, owner: o.owner });
  });
  if (pending.length === 0) return;
  const batch = pending.slice(0, BATCH);
  const remaining = batch.flatMap(({ i, owner }) => [
    { pubkey: pdas[i], isWritable: true, isSigner: false },
    { pubkey: tickerAta(owner, mint), isWritable: true, isSigner: false },
    { pubkey: quoteAta(owner, QUOTE), isWritable: true, isSigner: false },
  ]);
  const indices = batch.map((b) => b.i);
  const refund = a.settlePath === "refund";
  const m = refund ? program.methods.cancelAndRefund(indices) : program.methods.settleBatch(indices);
  const ix = await m
    .accountsStrict({
      caller: payer.publicKey,
      auction: a.pubkey,
      vaultTicker: vaultTickerAta(a.pubkey, mint),
      vaultQuote: vaultQuoteAta(a.pubkey, QUOTE),
      tickerMint: mint,
      quoteMint: QUOTE,
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
    })
    .remainingAccounts(remaining)
    .instruction();
  try {
    const r = await sendV0(connection, payer, [], [ix], { cuLimit: 1_000_000 });
    log(`${t.symbol} ${refund ? "refunded" : "settled"} [${indices}] of ${a.pubkey.toBase58()} (${pending.length - batch.length} left)`, r.sig);
  } catch (e) {
    const paused = (e.logs ?? []).some((l) => /paused/i.test(l));
    if (paused && a.settlePath === "none" && flag("refund-on-pause")) {
      log(`${t.symbol} mint paused -- switching ${a.pubkey.toBase58()} to the refund path`);
      a.settlePath = "refund";
      return settleNext(t, mint, a);
    }
    log(`${t.symbol} settle failed for ${a.pubkey.toBase58()}: ${paused ? "mint paused, will retry" : e.message}`);
  }
}

async function tick() {
  const slot = await connection.getSlot("confirmed");
  for (const t of cfg.tickers) {
    if (ONLY && t.symbol !== ONLY) continue;
    const mint = new PublicKey(t.mint);
    const auctions = await listAuctions(mint);
    for (const a of auctions) {
      try {
        if (a.status === "open" && slot >= a.closeSlot) await clear(t, mint, a);
        else if (a.status === "cleared") await settleNext(t, mint, a);
      } catch (e) {
        log(`${t.symbol} crank error on ${a.pubkey.toBase58()}: ${e.message}`);
      }
    }
    const live = auctions.some((a) => a.status === "open" && slot < a.closeSlot);
    if (!live && !flag("no-open")) {
      try {
        await openAuction(t, mint, slot);
      } catch (e) {
        log(`${t.symbol} could not open auction: ${e.message}`);
      }
    }
  }
}

log(`keeper up: ${clusterName}, cadence ${CADENCE} slots, freeze ${FREEZE}, payer ${payer.publicKey.toBase58()}`);
for (;;) {
  try {
    await tick();
  } catch (e) {
    log("tick failed:", e.message);
  }
  if (flag("once")) break;
  await sleep(Number(opt("interval", 15)) * 1000);
}
