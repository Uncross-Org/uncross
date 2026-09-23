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
  GATE,
  makeConnection,
  loadIdl,
  loadTickers,
  rpcHosts,
  rpcStatsLine,
  getAccountsBatched,
  withRetry,
} from "./lib.mjs";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const { Connection, PublicKey, SystemProgram } = anchor.web3;

const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

// The ticker set lives in scripts/tickers.json, shared with the bot and the
// site. Each devnet mint replicates its mainnet counterpart extension for
// extension, and each auction is bound to the ticker's Pyth feed ID.
const registry = loadTickers();
const CLUSTERS = {
  devnet: {
    rpc: null, // RPC_URLS, with failover; see makeConnection in lib.mjs
    quoteMint: registry.quoteMint,
    tickers: registry.tickers.map((t) => ({ symbol: t.symbol, mint: t.devnetMint, feed: t.pythFeedId })),
  },
  mainnet: {
    rpc: process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com",
    quoteMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    tickers: registry.tickers.map((t) => ({ symbol: t.symbol, mint: t.mainnetMint, feed: t.pythFeedId })),
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

// The keeper's working set is the chain itself.
//
// It used to be a list of addresses cached in a file on the service's own disk,
// fed by scanning the program's last fourteen transactions. A Railway redeploy
// wiped that file, and every auction opened before the redeploy dropped out of
// the working set: it was never cleared, never settled, and its rent could
// never come back. 119 auctions holding 1.82 SOL were stranded that way.
//
// Now every auction account the program owns is found with one
// getProgramAccounts call — keys only, no data — at startup and every
// SCAN_MS after. Each tick then reads the current state of that set in batches
// of 100. Nothing is persisted, so a redeploy starts from the chain and cannot
// lose anything. Settled auctions with no recorded payer can never change or
// be closed, so once seen they are no longer re-read each tick.
const AUCTION_SIZE = 2880;
const SCAN_MS = Number(opt("scan-ms", 120_000));
const DRY = flag("dry-run");
// Crank one auction and nothing else: for testing a lifecycle end to end
// without also touching every other auction on chain.
const ONLY_AUCTION = opt("only-auction", null);
let known = new Set();
const terminal = new Set();
let lastScan = 0;

async function scan() {
  const r = await withRetry(() =>
    connection.getProgramAccounts(ID, { commitment: "confirmed", dataSlice: { offset: 0, length: 0 }, filters: [{ dataSize: AUCTION_SIZE }] }),
  );
  const fresh = new Set(r.map((x) => x.pubkey.toBase58()));
  // Keep anything opened since the scan started; the RPC may not index it yet.
  for (const k of known) if (!fresh.has(k) && recentlyOpened.has(k)) fresh.add(k);
  known = fresh;
  for (const k of terminal) if (!known.has(k)) terminal.delete(k);
  lastScan = Date.now();
  log(`working set rebuilt from a program scan: ${known.size} auction accounts on chain`);
}

const recentlyOpened = new Set();
function remember(address) {
  const k = typeof address === "string" ? address : address.toBase58();
  known.add(k);
  recentlyOpened.add(k);
}

async function snapshot() {
  if (Date.now() - lastScan > SCAN_MS || known.size === 0) {
    try {
      await scan();
    } catch (e) {
      // A failed scan is not fatal: the set from the last scan is still valid,
      // because an auction's address is fixed for its life.
      log(`program scan failed, keeping the ${known.size} known: ${e.message}`);
    }
  }
  const keys = (ONLY_AUCTION ? [ONLY_AUCTION] : [...known].filter((k) => !terminal.has(k))).map((k) => new PublicKey(k));
  const out = [];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const infos = await getAccountsBatched(connection, chunk);
    infos.forEach((info, j) => {
      const k = chunk[j].toBase58();
      if (!info) {
        known.delete(k);
        recentlyOpened.delete(k);
        return;
      }
      if (info.data.length !== AUCTION_SIZE || !info.owner.equals(ID)) return;
      const a = { pubkey: chunk[j], ...decodeAuction(info.data) };
      if (a.status === "settled" && !a.hasPayer) terminal.add(k);
      out.push(a);
    });
  }
  return out;
}

// A name for logs. Active tickers come from the registry; anything else — a
// dormant ticker someone opened an auction on — is named by its mint.
const SYMBOL = new Map(cfg.tickers.map((t) => [t.mint, t.symbol]));
const describe = (mintKey) => ({ symbol: SYMBOL.get(mintKey) ?? `${mintKey.slice(0, 6)}…` });

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
  if (DRY) return log(`DRY would open ${t.symbol} ${auction.toBase58()} slots ${slot}..${slot + CADENCE}`);
  const r = await sendV0(connection, payer, [], [ix]);
  // Known first-hand, so it joins the working set before any scan sees it.
  remember(auction);
  log(`${t.symbol} opened ${auction.toBase58()} slots ${slot}..${slot + CADENCE} (freeze ${FREEZE})`, r.sig);
}

async function clear(t, mint, a) {
  if (DRY) return log(`DRY would clear ${t.symbol} ${a.pubkey.toBase58()} (${a.orderCount} orders, window ended at slot ${a.closeSlot})`);
  // The auction records its own feed, so this works for a ticker the keeper
  // has no config for. An all-zero feed means no oracle.
  const pyth = await pythAccountFor(a.pythFeedId);
  const ix = await program.methods
    .computeClearing()
    .accountsStrict({ caller: payer.publicKey, auction: a.pubkey, tickerMint: mint, pythPriceFeed: pyth })
    .instruction();
  const r = await sendV0(connection, payer, [], [ix], { cuLimit: 800_000 });
  const after = decodeAuction((await connection.getAccountInfo(a.pubkey, "confirmed")).data);
  log(
    `${t.symbol} cleared ${a.pubkey.toBase58()} at ${after.clearingPrice} x ${after.executableVolume}`,
    `(${after.orderCount} orders, pyth gate ${GATE[after.oracleGate] ?? after.oracleGate}${after.oraclePublishTime ? ` @${after.oraclePublishTime}` : ""}${after.referencePriceSet ? `, anchor ${after.referencePrice}` : ""})`,
    r.sig,
  );
}

async function settleNext(t, mint, a) {
  if (a.orderCount === 0) return;
  if (DRY) return log(`DRY would settle ${t.symbol} ${a.pubkey.toBase58()} (${a.orderCount - a.settledCount} of ${a.orderCount} left)`);
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
// Auctions that must stay on chain whatever the reclaim policy says: the
// community event's auction is a permanent, linkable record, and closing it
// to recover 0.018 SOL would break every link pointing at it.
// From the environment as well as the command line: on a hosted runner the
// address is set as a variable, and a flag that only worked as an argv would
// fail silently exactly when it mattered.
const NEVER_CLOSE = new Set(
  (process.env.NEVER_CLOSE ?? opt("never-close", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
);
const CLOSE_PER_TICK = Number(opt("close-per-tick", 4));
const closeRefused = new Set();

// A dormant ticker's auctions are opened on demand, not on cadence. Holding
// back its newest one — right for an active ticker, whose newest auction is
// the current book — would mean its only auction never closed and its rent
// never came back. So the newest is kept only for active tickers, and a
// dormant ticker keeps just its latest traded auction, as the record of the
// price it last crossed at.
const KEEP_TRADED_DORMANT = Number(opt("keep-traded-dormant", 1));

async function reclaim(t, mint, auctions) {
  if (flag("no-close")) return;
  const active = SYMBOL.has(mint.toBase58());
  const newest = active ? auctions.reduce((m, a) => Math.max(m, a.openSlot), 0) : null;
  const traded = auctions
    .filter((a) => a.executableVolume > 0n)
    .sort((x, y) => y.openSlot - x.openSlot)
    .slice(0, active ? KEEP_TRADED : KEEP_TRADED_DORMANT)
    .map((a) => a.pubkey.toBase58());
  const candidates = auctions
    .filter((a) => a.status === "settled" && a.hasPayer && a.openSlot !== newest)
    .filter((a) => !traded.includes(a.pubkey.toBase58()))
    .filter((a) => !closeRefused.has(a.pubkey.toBase58()))
    .filter((a) => !NEVER_CLOSE.has(a.pubkey.toBase58()))
    .sort((x, y) => x.openSlot - y.openSlot)
    .slice(0, CLOSE_PER_TICK);

  for (const a of candidates) {
    if (DRY) {
      log(`DRY would close ${t.symbol} ${a.pubkey.toBase58()} (${a.executableVolume > 0n ? "traded" : "empty"})`);
      continue;
    }
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
  const all = await snapshot();
  const byMint = new Map();
  for (const a of all) {
    const k = a.tickerMint.toBase58();
    if (!byMint.has(k)) byMint.set(k, []);
    byMint.get(k).push(a);
  }

  // Crank every auction on chain, whatever its ticker. A dormant ticker's
  // auction, opened by a visitor, is cleared, settled and closed exactly like
  // one the keeper opened on cadence — otherwise it would strand its rent.
  for (const [mintKey, auctions] of byMint) {
    const mint = new PublicKey(mintKey);
    const t = describe(mintKey);
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
  }

  // Open on cadence only for the active set.
  if (ONLY_AUCTION) return;
  for (const t of cfg.tickers) {
    if (ONLY && t.symbol !== ONLY) continue;
    const live = (byMint.get(t.mint) ?? []).some((a) => a.status === "open" && slot < a.closeSlot);
    if (!live && !flag("no-open")) {
      try {
        await openAuction(t, new PublicKey(t.mint), slot);
      } catch (e) {
        log(`${t.symbol} could not open auction: ${e.message}`);
      }
    }
  }
}

log(`keeper endpoints: ${cfg.rpc ? new URL(cfg.rpc).host : rpcHosts().join(" -> ")}`);
log(`keeper up: ${clusterName}, cadence ${CADENCE} slots, freeze ${FREEZE}, payer ${payer.publicKey.toBase58()}`);
// One rpcStats line every ~5 minutes (STATS_EVERY ticks at the default 15s
// interval), so a soak run's request rate and 429 count can be read straight
// off the deployed logs rather than requiring a separate instrumented run.
const STATS_EVERY = Math.max(1, Math.round(300 / Number(opt("interval", 15))));
let tickCount = 0;
for (;;) {
  try {
    await tick();
  } catch (e) {
    log("tick failed:", e.message);
  }
  tickCount++;
  if (tickCount % STATS_EVERY === 0) log(rpcStatsLine("keeper"));
  if (flag("once")) break;
  await sleep(Number(opt("interval", 15)) * 1000);
}
