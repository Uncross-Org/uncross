// Opens the auctions for a scheduled event: one ticker after another, with no
// gap between them.
//
// The regular cadence is wrong for this. A twenty-minute window that started
// before the announcement closes while people are still installing a wallet,
// and a second auction opened by hand after the first crosses arrives minutes
// late — by which time most of the audience has gone. So every auction in the
// sequence is opened up front, each one's open slot set to the previous one's
// close slot. The program refuses orders outside [open_slot, close_slot), so
// an auction opened early simply waits, and the next one begins the moment
// the last one ends with nobody touching anything.
//
//   node scripts/event-auction.mjs --sequence AAPLx:20,IBMx:20 --dry-run
//   node scripts/event-auction.mjs --sequence AAPLx:20,IBMx:20 --freeze-mins 2
//   node scripts/event-auction.mjs --sequence AAPLx:20,IBMx:20 --start-in-mins 5
//
// Windows are given in minutes and converted with the slot rate measured
// seconds beforehand, because devnet slot time drifts and a window asked for
// in minutes has to last that many minutes. The dry run prints every computed
// start and close time; check those before sending anything.

import anchor from "@coral-xyz/anchor";
import {
  loadKeypair,
  loadFixture,
  loadTickers,
  getProgram,
  auctionPda,
  vaultTickerAta,
  vaultQuoteAta,
  sendV0,
  sleep,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "./lib.mjs";
import { rememberAuction } from "./auction-index.mjs";

const { BN } = anchor;
const { PublicKey, SystemProgram } = anchor.web3;

const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const flag = (n) => process.argv.includes(`--${n}`);

// "AAPLx:20,IBMx:20" — ticker and window in minutes, in the order they run.
const SEQUENCE = (opt("sequence", `${opt("ticker", "IBMx")}:${opt("window-mins", 22)}`) || "")
  .split(",")
  .map((part) => {
    const [symbol, mins] = part.split(":");
    return { symbol: symbol.trim(), mins: Number(mins) };
  })
  .filter((s) => s.symbol && s.mins > 0);
const FREEZE_MINS = Number(opt("freeze-mins", 2));
const START_IN_MINS = Number(opt("start-in-mins", 0));
const DRY = flag("dry-run");

if (SEQUENCE.length === 0) throw new Error("--sequence AAPLx:20,IBMx:20");

const payer = loadKeypair(opt("payer", "deploy"));
const fx = loadFixture();
const { program, connection } = getProgram(payer);
const ID = program.programId;
const QUOTE = new PublicKey(fx.quoteMint);
const registry = loadTickers();
const log = (...a) => console.log(new Date().toISOString(), ...a);

for (const s of SEQUENCE) {
  const tk = registry.tickers.find((t) => t.symbol === s.symbol);
  if (!tk?.devnetMint) throw new Error(`unknown ticker ${s.symbol}`);
  if (FREEZE_MINS >= s.mins) throw new Error(`${s.symbol}: freeze ${FREEZE_MINS}min must be shorter than the ${s.mins}min window`);
  s.tk = tk;
}

/** Slots per second, measured now rather than assumed. */
async function slotRate(sampleMs = 12000) {
  const a = await connection.getSlot("confirmed");
  const t0 = Date.now();
  await sleep(sampleMs);
  const b = await connection.getSlot("confirmed");
  const perSec = (b - a) / ((Date.now() - t0) / 1000);
  // Devnet has been running near 6 slots/s but stalls; refuse a reading that
  // would make the window wildly wrong rather than opening a five-hour
  // "twenty minutes".
  if (!(perSec > 0.5 && perSec < 12)) throw new Error(`slot rate looks wrong: ${perSec.toFixed(2)}/s`);
  return perSec;
}

const perSec = await slotRate();
const now = await connection.getSlot("confirmed");
const freezeSlots = Math.round(FREEZE_MINS * 60 * perSec);
log(`slot rate ${perSec.toFixed(2)}/s — freeze ${FREEZE_MINS}min = ${freezeSlots} slots`);

// Each auction begins exactly where the previous one ends: no gap, and no
// manual step between them.
let cursor = now + Math.round(START_IN_MINS * 60 * perSec);
const plan = SEQUENCE.map((s) => {
  const openSlot = cursor;
  const closeSlot = openSlot + Math.round(s.mins * 60 * perSec);
  cursor = closeSlot;
  const mint = new PublicKey(s.tk.devnetMint);
  return {
    ...s,
    mint,
    openSlot,
    closeSlot,
    auction: auctionPda(ID, mint, openSlot),
    opensAt: new Date(Date.now() + ((openSlot - now) / perSec) * 1000),
    closesAt: new Date(Date.now() + ((closeSlot - now) / perSec) * 1000),
  };
});

console.log("");
for (const p of plan) {
  log(`${p.symbol.padEnd(6)} ${p.auction.toBase58()}`);
  log(`${" ".repeat(7)}opens  ${p.opensAt.toISOString()}  (slot ${p.openSlot})`);
  log(`${" ".repeat(7)}closes ${p.closesAt.toISOString()}  (slot ${p.closeSlot}), cancels close ${new Date(p.closesAt.getTime() - FREEZE_MINS * 60000).toISOString()}`);
}
console.log("");

if (DRY) {
  log("dry run — nothing sent");
  console.log(`SKIP_AUCTIONS=${plan.map((p) => p.auction.toBase58()).join(",")}`);
  console.log(`NEVER_CLOSE=${plan.map((p) => p.auction.toBase58()).join(",")}`);
  process.exit(0);
}

for (const p of plan) {
  const ix = await program.methods
    .initializeAuction(
      new BN(p.openSlot),
      new BN(p.closeSlot),
      new BN(freezeSlots),
      new BN(p.closeSlot - p.openSlot),
      Array.from(Buffer.from(p.tk.pythFeedId.replace(/^0x/, ""), "hex")),
    )
    .accountsStrict({
      payer: payer.publicKey,
      auction: p.auction,
      tickerMint: p.mint,
      quoteMint: QUOTE,
      vaultTicker: vaultTickerAta(p.auction, p.mint),
      vaultQuote: vaultQuoteAta(p.auction, QUOTE),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const r = await sendV0(connection, payer, [], [ix]);
  rememberAuction(p.auction);
  log(`opened ${p.symbol} ${p.auction.toBase58()} ${r.sig}`);
}

const addrs = plan.map((p) => p.auction.toBase58()).join(",");
console.log(`\nSKIP_AUCTIONS=${addrs}`);
console.log(`NEVER_CLOSE=${addrs}`);
plan.forEach((p) => console.log(`link  https://uncross.0xo.in/app?ticker=${p.symbol}`));
