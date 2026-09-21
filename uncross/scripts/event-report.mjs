// What actually happened in one auction, told straight.
//
// The community event's claim is that real people filled the book. That claim
// is only worth making if it is checked, so this counts the orders, counts the
// distinct wallets behind them, and counts how many of those wallets are the
// bot's 42 test owners. If the bot got in, this says so, loudly, before anyone
// writes a post about strangers trading at one price.
//
//   node scripts/event-report.mjs --auction <address>

import anchor from "@coral-xyz/anchor";
import {
  loadKeypair,
  loadKeypairArray,
  loadTickers,
  getProgram,
  decodeAuction,
  orderPda,
  GATE,
} from "./lib.mjs";
// Prices are 6dp per token unit, quantities 8dp, as the program stores them.
// Per-share display applies each mint's scaled-UI multiplier; that is the
// site's job, and this report deliberately shows the raw on-chain figures.
const toPrice = (raw) => Number(raw) / 1e6;
const toShares = (raw) => Number(raw) / 1e8;

const { PublicKey } = anchor.web3;
const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const address = opt("auction", null);
if (!address) throw new Error("--auction <address> is required");

const payer = loadKeypair("deploy");
const { program, connection } = getProgram(payer);
const ID = program.programId;
const auction = new PublicKey(address);

const info = await connection.getAccountInfo(auction, "confirmed");
if (!info) throw new Error(`no account at ${address} — it may have been closed`);
const a = decodeAuction(info.data);

const registry = loadTickers();
const tk = registry.tickers.find((t) => t.devnetMint === a.tickerMint?.toBase58?.());
const symbol = tk?.symbol ?? "?";

// Who placed each order. The summaries in the auction account carry no owner,
// so read the order accounts themselves.
const pdas = [...Array(a.orderCount).keys()].map((i) => orderPda(ID, auction, i));
const infos = await connection.getMultipleAccountsInfo(pdas, "confirmed");
const orders = [];
infos.forEach((oi, i) => {
  if (!oi) return;
  const o = program.coder.accounts.decode("order", oi.data);
  orders.push({
    index: i,
    owner: o.owner.toBase58(),
    side: o.side?.buy !== undefined ? "buy" : "sell",
    limit: BigInt(o.limitPrice.toString()),
    qty: BigInt(o.quantity.toString()),
    filled: BigInt(o.filledQuantity?.toString?.() ?? "0"),
    cancelled: !!o.cancelled,
  });
});

// The bot's owners, so a claim about "real people" can be checked rather than
// assumed. Missing key material is not a pass: say the check could not run.
let botOwners = null;
try {
  botOwners = new Set(loadKeypairArray("mb-owners").map((k) => k.publicKey.toBase58()));
} catch {
  botOwners = null;
}

const wallets = new Set(orders.map((o) => o.owner));
const botWallets = botOwners ? [...wallets].filter((w) => botOwners.has(w)) : [];
const humanWallets = botOwners ? [...wallets].filter((w) => !botOwners.has(w)) : [...wallets];

const price = toPrice(a.clearingPrice);
const volume = toShares(a.executableVolume);

console.log(`\nAuction ${address}`);
console.log(`Ticker        ${symbol}`);
console.log(`Status        ${a.status}${a.settlePath && a.settlePath !== "none" ? ` (${a.settlePath})` : ""}`);
console.log(`Window        slots ${a.openSlot} → ${a.closeSlot}, freeze ${a.freezeSlots}`);
console.log(`Clearing      ${a.executableVolume > 0n ? `$${price.toFixed(4)} × ${volume.toFixed(4)} shares` : "no trade"}`);
console.log(`Pyth gate     ${GATE[a.oracleGate] ?? a.oracleGate}${a.oraclePublishTime ? ` @${a.oraclePublishTime}` : ""}`);
console.log(`\nOrders        ${orders.length} placed, ${orders.filter((o) => o.cancelled).length} cancelled`);
console.log(`              ${orders.filter((o) => o.side === "buy").length} buy, ${orders.filter((o) => o.side === "sell").length} sell`);
console.log(`Distinct wallets  ${wallets.size}`);

if (botOwners === null) {
  console.log(`\n!! Could not load the bot's owner list, so the "real people" check DID NOT RUN.`);
  console.log(`   Do not claim the book was filled by real participants on this output alone.`);
} else if (botWallets.length > 0) {
  console.log(`\n!! ${botWallets.length} of ${wallets.size} wallets are the test bot's own owners.`);
  console.log(`   This book was NOT filled only by real people. Report it as it is:`);
  botWallets.forEach((w) => console.log(`   bot  ${w}`));
  console.log(`   ${humanWallets.length} wallet(s) were not the bot.`);
} else {
  console.log(`\nNone of these wallets belong to the test bot (checked against its ${botOwners.size} owners).`);
  console.log(`"${wallets.size} distinct wallets, none of them ours" is a true statement.`);
}

console.log(`\nParticipants:`);
[...wallets].forEach((w) => {
  const theirs = orders.filter((o) => o.owner === w);
  const tag = botOwners?.has(w) ? " [BOT]" : "";
  console.log(`  ${w}${tag}  ${theirs.length} order(s): ${theirs.map((o) => `${o.side} ${(Number(o.qty) / 1e8).toFixed(2)}@$${(Number(o.limit) / 1e6).toFixed(2)}`).join(", ")}`);
});
console.log(`\nexplorer https://explorer.solana.com/address/${address}?cluster=devnet`);
