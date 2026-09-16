// Uncross keeper: opens auctions on a cadence and cranks them through the cross.
// Every instruction it sends is permissionless except initialize_auction's rent.
//
//   node scripts/keeper.mjs --cluster devnet --cadence 750 --freeze 75
//   node scripts/keeper.mjs --cluster mainnet --no-open        # crank only
//   node scripts/keeper.mjs --cluster devnet --once            # one pass, then exit
//
// Cadence is in slots (~0.4s each): 750 is a five-minute demo window, 9000 is
// hourly. The program stores it; nothing else changes between the two.
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
  makeConnection,
  loadIdl,
  rpcHosts,
  rpcStats,
} from "./lib.mjs";
import { listAuctions as listAuctionsIndexed, rememberAuction } from "./auction-index.mjs";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const { Connection, PublicKey, SystemProgram } = anchor.web3;

const AAPL_FEED = "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688";
const IBM_FEED = "cfd44471407f4da89d469242546bb56f5c626d5bef9bd8b9327783065b43c3ef";
const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

const CLUSTERS = {
  devnet: {
    rpc: null, // RPC_URLS, with failover; see makeConnection in lib.mjs
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
const connection = cfg.rpc ? new Connection(cfg.rpc, "confirmed") : makeConnection();
const idl = loadIdl();
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

// Rent reclaim. Every auction locks rent in its account and two vaults until
// close_auction returns it. Empty auctions are closed as soon as they finish;
// ones that traded are kept for a while because the site's recent-crosses list
// and hero read them from chain. The program refuses anything not fully
// settled with empty vaults, and sendV0 simulates first, so a refused close
// costs nothing.
const KEEP_TRADED = Number(opt("keep-traded", 6));
const CLOSE_PER_TICK = Number(opt("close-per-tick", 4));
const closeRefused = new Set();

async function reclaim(t, mint, auctions) {
  if (flag("no-close")) return;
  const newest = auctions.reduce((m, a) => Math.max(m, a.openSlot), 0);
  const traded = auctions
    .filter((a) => a.executableVolume > 0n)
    .sort((x, y) => y.openSlot - x.openSlot)
    .slice(0, KEEP_TRADED)
    .map((a) => a.pubkey.toBase58());
  const candidates = auctions
    .filter((a) => a.status === "settled" && a.hasPayer && a.openSlot !== newest)
    .filter((a) => !traded.includes(a.pubkey.toBase58()))
    .filter((a) => !closeRefused.has(a.pubkey.toBase58()))
    .sort((x, y) => x.openSlot - y.openSlot)
    .slice(0, CLOSE_PER_TICK);

  for (const a of candidates) {
    const ix = await program.methods
      .closeAuction()
      .accountsStrict({
        caller: payer.publicKey,
        auction: a.pubkey,
        rentRecipient: a.payer,
        vaultTicker: vaultTickerAta(a.pubkey, mint),
        vaultQuote: vaultQuoteAta(a.pubkey, QUOTE),
        tickerTokenProgram: TICKER_PROGRAM,
        quoteTokenProgram: QUOTE_PROGRAM,
      })
      .instruction();
    try {
      const r = await sendV0(connection, payer, [], [ix]);
      log(`${t.symbol} closed ${a.pubkey.toBase58()} (${a.executableVolume > 0n ? "traded" : "empty"}), rent back to ${a.payer.toBase58()}`, r.sig);
    } catch (e) {
      const code = (e.logs ?? []).map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean);
      // A refusal on program grounds will not change on its own (a stray
      // token in a vault, say); stop retrying it. Anything else is transient.
      if (code) closeRefused.add(a.pubkey.toBase58());
      log(`${t.symbol} close refused for ${a.pubkey.toBase58()}: ${code ?? e.message}`);
    }
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
    try {
      await reclaim(t, mint, auctions);
    } catch (e) {
      log(`${t.symbol} reclaim error: ${e.message}`);
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

log(`keeper endpoints: ${cfg.rpc ? new URL(cfg.rpc).host : rpcHosts().join(" -> ")}`);
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
