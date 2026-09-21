// Opens one auction for a scheduled event, on one ticker, with a window long
// enough that someone arriving late can still take part.
//
// The regular cadence is wrong for this: a twenty-minute window that started
// before the announcement closes while people are still installing a wallet.
// This opens a single auction on demand, with the window given in minutes and
// converted using the slot rate measured seconds beforehand — devnet slot time
// drifts, and a window asked for in minutes has to actually last that long.
//
//   node scripts/event-auction.mjs --ticker IBMx --window-mins 22 --freeze-mins 2
//   node scripts/event-auction.mjs --ticker IBMx --window-mins 22 --dry-run
//
// Prints the auction address. Nothing else in the venue needs to know about
// it: the keeper sees a live auction for that ticker and so does not open a
// competing one, and it crosses it when the window closes like any other.
// Keep the bot away from it — that is the whole point of the event — by
// leaving the ticker out of the bot's --tickers list while it runs.

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

const SYMBOL = opt("ticker", "IBMx");
const WINDOW_MINS = Number(opt("window-mins", 22));
const FREEZE_MINS = Number(opt("freeze-mins", 2));
const DRY = flag("dry-run");

const payer = loadKeypair(opt("payer", "deploy"));
const fx = loadFixture();
const { program, connection } = getProgram(payer);
const ID = program.programId;
const QUOTE = new PublicKey(fx.quoteMint);
const tk = loadTickers().tickers.find((t) => t.symbol === SYMBOL);
if (!tk?.devnetMint) throw new Error(`unknown ticker ${SYMBOL}`);
const mint = new PublicKey(tk.devnetMint);
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** Slots per second, measured now rather than assumed. */
async function slotRate(sampleMs = 12000) {
  const a = await connection.getSlot("confirmed");
  const t0 = Date.now();
  await sleep(sampleMs);
  const b = await connection.getSlot("confirmed");
  const perSec = (b - a) / ((Date.now() - t0) / 1000);
  // Devnet sits near 2.5 slots/s but stalls; refuse a reading that would make
  // the window wildly wrong rather than opening a five-hour "twenty minutes".
  if (!(perSec > 0.5 && perSec < 10)) throw new Error(`slot rate looks wrong: ${perSec.toFixed(2)}/s`);
  return perSec;
}

const perSec = await slotRate();
const windowSlots = Math.round(WINDOW_MINS * 60 * perSec);
const freezeSlots = Math.round(FREEZE_MINS * 60 * perSec);
const slot = await connection.getSlot("confirmed");
const auction = auctionPda(ID, mint, slot);

log(`slot rate ${perSec.toFixed(2)}/s — ${WINDOW_MINS}min = ${windowSlots} slots, freeze ${FREEZE_MINS}min = ${freezeSlots} slots`);
log(`${SYMBOL} auction ${auction.toBase58()}`);
log(`opens at slot ${slot}, closes at ${slot + windowSlots}, ~${new Date(Date.now() + WINDOW_MINS * 60000).toISOString()}`);
log(`cancellations close ~${new Date(Date.now() + (WINDOW_MINS - FREEZE_MINS) * 60000).toISOString()}`);

if (DRY) {
  log("dry run — nothing sent");
  process.exit(0);
}

const ix = await program.methods
  .initializeAuction(new BN(slot), new BN(slot + windowSlots), new BN(freezeSlots), new BN(windowSlots), Array.from(Buffer.from(tk.pythFeedId.replace(/^0x/, ""), "hex")))
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
rememberAuction(auction);
log(`opened ${auction.toBase58()} ${r.sig}`);
console.log(`\nEVENT_AUCTION=${auction.toBase58()}`);
console.log(`link https://uncross.0xo.in/app?ticker=${SYMBOL}`);
console.log(`explorer https://explorer.solana.com/address/${auction.toBase58()}?cluster=devnet`);
