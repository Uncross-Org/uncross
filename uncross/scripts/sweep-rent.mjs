// Recover rent from settled auctions the keeper's reclaim cannot see.
//
// The keeper reclaims from the auctions its index knows about, which is the
// recent ones — so rent from anything older sits on chain forever, invisible.
// This scans the program directly, closes every settled auction whose vaults
// are empty and whose recorded payer is ours, and leaves the newest few traded
// auctions per ticker alone because the site reads them for recent crosses.
//
//   node scripts/sweep-rent.mjs --dry-run
//   node scripts/sweep-rent.mjs --keep-traded 3 --max 40
//
// close_auction is permissionless and refuses anything not fully settled, so
// the worst case is a refusal, not a loss.

import anchor from "@coral-xyz/anchor";
import {
  loadKeypair,
  loadFixture,
  loadTickers,
  getProgram,
  decodeAuction,
  vaultTickerAta,
  vaultQuoteAta,
  sendV0,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
} from "./lib.mjs";

const { PublicKey } = anchor.web3;
const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const DRY = process.argv.includes("--dry-run");
const KEEP_TRADED = Number(opt("keep-traded", 3));
const MAX = Number(opt("max", 40));

const payer = loadKeypair("deploy");
const fx = loadFixture();
const { program, connection } = getProgram(payer);
const QUOTE = new PublicKey(fx.quoteMint);
const registry = loadTickers();
const byMint = new Map(registry.tickers.map((t) => [t.devnetMint, t.symbol]));
const log = (...a) => console.log(new Date().toISOString(), ...a);

const accts = await connection.getProgramAccounts(program.programId, {
  commitment: "confirmed",
  filters: [{ dataSize: 2880 }],
});
log(`${accts.length} auction accounts on chain`);

const rows = accts.map((x) => ({
  pubkey: x.pubkey,
  lamports: x.account.lamports,
  ...decodeAuction(x.account.data),
}));

// Newest traded auctions per ticker stay: the site's recent-crosses list and
// the landing page read them from chain, and closing them empties that list.
const keep = new Set();
for (const t of registry.tickers) {
  rows
    .filter((r) => r.tickerMint?.toBase58?.() === t.devnetMint && r.executableVolume > 0n)
    .sort((a, b) => b.openSlot - a.openSlot)
    .slice(0, KEEP_TRADED)
    .forEach((r) => keep.add(r.pubkey.toBase58()));
}

const candidates = rows
  .filter((r) => r.status === "settled" && r.hasPayer && !keep.has(r.pubkey.toBase58()))
  .filter((r) => r.settledCount >= r.orderCount)
  .sort((a, b) => a.openSlot - b.openSlot)
  .slice(0, MAX);

log(`keeping ${keep.size} recent traded auctions`);
log(`${candidates.length} closeable, worth ~${(candidates.reduce((s, r) => s + r.lamports, 0) / 1e9).toFixed(3)} SOL`);

if (DRY) {
  candidates.slice(0, 5).forEach((r) => log(`  would close ${r.pubkey.toBase58()} (${byMint.get(r.tickerMint?.toBase58?.()) ?? "?"})`));
  log("dry run — nothing sent");
  process.exit(0);
}

let closed = 0;
let recovered = 0;
for (const r of candidates) {
  const mint = r.tickerMint;
  try {
    const ix = await program.methods
      .closeAuction()
      .accountsStrict({
        caller: payer.publicKey,
        auction: r.pubkey,
        rentRecipient: r.payer,
        vaultTicker: vaultTickerAta(r.pubkey, mint),
        vaultQuote: vaultQuoteAta(r.pubkey, QUOTE),
        tickerTokenProgram: TICKER_PROGRAM,
        quoteTokenProgram: QUOTE_PROGRAM,
      })
      .instruction();
    await sendV0(connection, payer, [], [ix]);
    closed++;
    recovered += r.lamports / 1e9;
    if (closed % 10 === 0) log(`closed ${closed}, recovered ~${recovered.toFixed(3)} SOL`);
  } catch (e) {
    const code = (e.logs ?? []).map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean);
    log(`refused ${r.pubkey.toBase58()}: ${code ?? (e.message ?? "").slice(0, 80)}`);
  }
}
log(`done: closed ${closed} of ${candidates.length}, recovered ~${recovered.toFixed(3)} SOL`);
