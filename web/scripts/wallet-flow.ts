// Drives the web app's own transaction builders (src/lib/tx.ts) end to end on
// devnet, with local keypairs standing in for a browser wallet. Exercises what
// the UI does on click: place orders (with ATA creation), cancel, run the
// cross, settle in batches.
//
//   npx tsx scripts/wallet-flow.ts        (needs an open IBMx devnet auction)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { CLUSTERS, SETTLE_BATCH } from "../src/config";
import { auctionPhase, fetchAuction, fetchAuctions } from "../src/lib/auction";
import { fetchOrders } from "../src/lib/order";
import { cancelOrderIx, computeClearingIx, getProgram, placeOrderIxs, sendIxs, sendMany, settleIx } from "../src/lib/tx";
import { fetchMultiplier, perShareToProgram, programToPerShare, rawToShares, sharesToRaw } from "../src/lib/units";

const cluster = CLUSTERS.devnet;
const tk = cluster.tickers.IBMx;
const conn = new Connection(cluster.rpc, "confirmed");
const program = getProgram(conn);

function load(name: string) {
  const p = path.join(os.homedir(), ".config/solana/uncross", `${name}.json`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

// Minimal stand-in for @solana/wallet-adapter's context.
function walletOf(kp: Keypair) {
  return {
    publicKey: kp.publicKey,
    sendTransaction: async (tx: VersionedTransaction, c: Connection, opts?: object) => {
      tx.sign([kp]);
      return c.sendRawTransaction(tx.serialize(), opts);
    },
    signAllTransactions: async <T extends VersionedTransaction>(txs: T[]) => {
      txs.forEach((t) => t.sign([kp]));
      return txs;
    },
  } as never;
}

const seller = load("deploy");
const buyer = load("wallet2");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function current() {
  const [a] = await fetchAuctions(conn, program.programId, new PublicKey(tk.mint!));
  return a;
}

async function place(kp: Keypair, side: "buy" | "sell", perShare: number, shares: number, m: number) {
  const a = (await current())!;
  const ixs = await placeOrderIxs(program, a, kp.publicKey, side, perShareToProgram(perShare, m), sharesToRaw(shares, m), a.orderCount);
  const sig = await sendIxs(conn, walletOf(kp), ixs);
  const after = (await fetchAuction(conn, a.address))!;
  console.log(
    `  ${side} ${shares} @ $${perShare}/share -> #${a.orderCount}  ${sig}\n` +
      `    indicative $${programToPerShare(after.indicativePrice, m).toFixed(2)}/share x ${rawToShares(after.indicativeVolume, m).toFixed(4)} shares`,
  );
  return a.orderCount;
}

async function main() {
  const a0 = await current();
  const slot = await conn.getSlot("confirmed");
  if (!a0 || auctionPhase(a0, slot) !== "open" || a0.closeSlot - a0.freezeSlots - slot < 150) {
    throw new Error("need an IBMx devnet auction with time left in its open window (run the keeper)");
  }
  const m = await fetchMultiplier(conn, new PublicKey(tk.mint!));
  console.log(`auction ${a0.address.toBase58()} | multiplier ${m} | ${a0.closeSlot - slot} slots to close`);

  console.log("\n== place orders through placeOrderIxs + sendIxs ==");
  await place(seller, "sell", 100, 3, m);
  await place(buyer, "buy", 110, 3, m);
  const toCancel = await place(buyer, "buy", 50, 1, m);

  console.log("\n== cancel through cancelOrderIx ==");
  const a1 = (await fetchAuction(conn, a0.address))!;
  console.log("  " + (await sendIxs(conn, walletOf(buyer), [await cancelOrderIx(program, a1, buyer.publicKey, toCancel)])));

  process.stdout.write("\n== waiting for close");
  while ((await conn.getSlot("confirmed")) < a0.closeSlot) {
    process.stdout.write(".");
    await sleep(3000);
  }
  console.log();

  console.log("== run the cross through computeClearingIx ==");
  const a2 = (await fetchAuction(conn, a0.address))!;
  console.log("  " + (await sendIxs(conn, walletOf(seller), [await computeClearingIx(program, a2, seller.publicKey, tk.pythAccount)], 800_000)));
  const cleared = (await fetchAuction(conn, a0.address))!;
  console.log(`  cleared at $${programToPerShare(cleared.clearingPrice, m).toFixed(4)}/share x ${rawToShares(cleared.executableVolume, m).toFixed(4)} shares`);

  console.log("== settle through settleIx + sendMany ==");
  const pending = (await fetchOrders(conn, program.programId, a0.address, cleared.orderCount)).filter((o) => !o.settled);
  const groups = [];
  for (let i = 0; i < pending.length; i += SETTLE_BATCH) {
    groups.push([await settleIx(program, cleared, seller.publicKey, pending.slice(i, i + SETTLE_BATCH), "settle")]);
  }
  for (const s of await sendMany(conn, walletOf(seller), groups, 1_000_000)) console.log("  " + s);

  const done = (await fetchAuction(conn, a0.address))!;
  const vt = (await conn.getTokenAccountBalance(done.vaultTicker)).value.amount;
  const vq = (await conn.getTokenAccountBalance(done.vaultQuote)).value.amount;
  console.log(`\nfinal: status ${done.status}, settled ${done.settledCount}/${done.orderCount}, vaults ticker ${vt} quote ${vq}`);
  if (done.status !== "settled" || vt !== "0" || vq !== "0") process.exit(1);
}

main().catch((e) => {
  console.error("FAILED:", e.message, e.logs ?? "");
  process.exit(1);
});
