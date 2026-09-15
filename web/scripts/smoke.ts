// Data-layer smoke test against real endpoints, using the same modules the app uses.
//   npm run smoke
import { Connection, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { CLUSTERS, DEVNET_RPC, MAINNET_RPC, PROGRAM_ID } from "../src/config";
import { auctionPhase, fetchAuctions } from "../src/lib/auction";
import { bookOrders } from "../src/lib/book";
import { fetchOrders } from "../src/lib/order";
import { fetchPythPrice, fetchSchedule } from "../src/lib/pyth";
import { marketState, parseSchedule } from "../src/lib/schedule";
import { computeClearingIx, getProgram, placeOrderIxs } from "../src/lib/tx";
import { escrowForBuy, fetchMultiplier, perShareToProgram, programToPerShare, rawToShares, sharesToRaw } from "../src/lib/units";

const main = new Connection(MAINNET_RPC, "confirmed");
const dev = new Connection(DEVNET_RPC, "confirmed");
const PROGRAM = new PublicKey(PROGRAM_ID);
const DEPLOY = new PublicKey("68N5a3Nj5u7Kc5RPiyu4iH3qVLN1A7wu1fEWErNtqLJf"); // devnet fixture wallet (payer for simulation only)

async function simulate(conn: Connection, payer: PublicKey, ixs: TransactionInstruction[]) {
  const { blockhash } = await conn.getLatestBlockhash();
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  const r = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true });
  return { err: r.value.err, logs: (r.value.logs ?? []).filter((l) => /Instruction|Error|consumed/.test(l)).slice(-6) };
}

console.log("== Pyth (mainnet) ==");
const aapl = CLUSTERS.devnet.tickers.AAPLx;
const p = await fetchPythPrice(main, aapl.pythAccount!);
const age = Date.now() / 1000 - p.publishTime;
console.log(`AAPL price $${p.price.toFixed(4)} ±${p.conf.toFixed(4)} expo ${p.expo} published ${new Date(p.publishTime * 1000).toISOString()} (age ${age.toFixed(0)}s) feed ${p.feedId.slice(0, 8)}… matches=${p.feedId === aapl.pythFeedId}`);
const sched = await fetchSchedule(aapl.hermesQuery, aapl.pythFeedId);
console.log(`schedule: ${sched}`);
const ms = marketState(parseSchedule(sched!));
console.log(`market open=${ms.open} nextOpen=${ms.nextOpen ? new Date(ms.nextOpen).toISOString() : null} closesAt=${ms.closesAt ? new Date(ms.closesAt).toISOString() : null}`);
const ibmSched = await fetchSchedule("IBM", CLUSTERS.devnet.tickers.IBMx.pythFeedId);
console.log(`IBM schedule found: ${!!ibmSched}`);
// Known-schedule checks: Sat → next open Mon 09:30 ET; holiday 1127 half day.
const s = parseSchedule(sched!);
const sat = Date.parse("2026-09-19T15:00:00Z");
console.log(`Sat 2026-09-19 11:00 ET → nextOpen ${new Date(marketState(s, sat).nextOpen!).toISOString()} (expect 2026-09-21T13:30:00Z)`);
console.log(`Wed 2026-09-16 14:00 ET → ${JSON.stringify(marketState(s, Date.parse("2026-09-16T18:00:00Z")))} (expect open, closesAt 20:00Z)`);
console.log(`Thanksgiving 2026-11-26 → nextOpen ${new Date(marketState(s, Date.parse("2026-11-26T15:00:00Z")).nextOpen!).toISOString()} (expect 11-27 14:30Z)`);

console.log("\n== Multipliers ==");
for (const [c, conn] of [["devnet", dev]] as const) {
  for (const t of Object.values(CLUSTERS[c].tickers)) {
    if (!t.mint) continue;
    console.log(`${c} ${t.symbol} m=${await fetchMultiplier(conn, new PublicKey(t.mint))}`);
  }
}

console.log("\n== Units round-trip (m = 1.0153) ==");
const m = 1.015340763856885;
const raw = sharesToRaw(10, m);
const price = perShareToProgram(250, m);
console.log(`10 shares → raw ${raw} → ${rawToShares(raw, m).toFixed(6)} shares; $250/share → program ${price} → $${programToPerShare(price, m).toFixed(6)}; buy escrow ${escrowForBuy(raw, price)} (≈ $${Number(escrowForBuy(raw, price)) / 1e6})`);

console.log("\n== Devnet auctions (gPA dataSize 2880 + memcmp ticker@80) ==");
const program = getProgram(dev);
for (const t of Object.values(CLUSTERS.devnet.tickers)) {
  if (!t.mint) continue;
  const list = await fetchAuctions(dev, PROGRAM, new PublicKey(t.mint));
  const slot = await dev.getSlot();
  const mm = await fetchMultiplier(dev, new PublicKey(t.mint));
  console.log(`${t.symbol}: ${list.length} auctions (slot ${slot})`);
  for (const a of list.slice(0, 5)) {
    console.log(
      `  ${a.address.toBase58()} open=${a.openSlot} close=${a.closeSlot} freeze=${a.freezeSlots} status=${a.status} phase=${auctionPhase(a, slot)} orders=${a.orderCount} settled=${a.settledCount} ` +
        `indicative=$${programToPerShare(a.indicativePrice, mm).toFixed(2)}/${rawToShares(a.indicativeVolume, mm)}sh clearing=$${programToPerShare(a.clearingPrice, mm).toFixed(2)} vol=${rawToShares(a.executableVolume, mm)}sh ref=${a.referencePriceSet}`,
    );
  }
  const cur = list[0];
  if (!cur) continue;
  const orders = await fetchOrders(dev, PROGRAM, cur.address, cur.orderCount);
  console.log(`  latest: ${orders.length}/${cur.orderCount} order PDAs fetched; owners: ${[...new Set(orders.map((o) => o.owner.toBase58().slice(0, 6)))].join(",")}`);
  for (const o of orders.slice(0, 6)) {
    const sm = cur.orders[o.orderIndex];
    console.log(`    #${o.orderIndex} ${o.side} $${programToPerShare(o.limitPrice, mm).toFixed(2)} × ${rawToShares(o.quantity, mm)}sh escrow=${o.escrowAmount} filled=${sm.filledQuantity} quote=${sm.quoteAmount} cancelled=${o.cancelled} settled=${o.settled}`);
  }
  console.log(`  book (display units): ${JSON.stringify(bookOrders(cur, mm).slice(0, 4))}`);

  // Simulate compute_clearing on the latest auction (a no-op if already cleared) — validates IDL + account list.
  const cc = await computeClearingIx(program, cur, DEPLOY, t.pythAccount);
  console.log(`  simulate compute_clearing: ${JSON.stringify(await simulate(dev, DEPLOY, [cc]))}`);
  // If the window is open, simulate a 0.01-share sell from the fixture wallet (validates place_order + ATA ixs).
  if (auctionPhase(cur, slot) === "open" || auctionPhase(cur, slot) === "freeze") {
    const ixs = await placeOrderIxs(program, cur, DEPLOY, "sell", perShareToProgram(1000, mm), sharesToRaw(0.01, mm), cur.orderCount);
    console.log(`  simulate place_order: ${JSON.stringify(await simulate(dev, DEPLOY, ixs))}`);
  }
}
