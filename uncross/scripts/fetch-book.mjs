// Read one auction's real order book from chain into JSON, for anything that
// has to draw a book faithfully — the launch clip's supply and demand curves.
// Decodes exactly as event-report.mjs does: the order accounts themselves, not
// the auction's summaries, and the same unit conversions.
//   node scripts/fetch-book.mjs <auction> <out.json>
import fs from "node:fs";
import anchor from "@coral-xyz/anchor";
import { getProgram, loadKeypair, decodeAuction, orderPda, loadTickers } from "./lib.mjs";
const { PublicKey } = anchor.web3;
const [addr, out] = process.argv.slice(2);
const auction = new PublicKey(addr);
const { program, connection } = getProgram(loadKeypair("deploy"));
const ID = program.programId;
const info = await connection.getAccountInfo(auction, "confirmed");
const a = decodeAuction(info.data);
const tk = loadTickers().tickers.find((t) => t.devnetMint === a.tickerMint.toBase58());
const pdas = [...Array(a.orderCount).keys()].map((i) => orderPda(ID, auction, i));
const infos = await connection.getMultipleAccountsInfo(pdas, "confirmed");
const orders = [];
infos.forEach((oi) => {
  if (!oi) return;
  const o = program.coder.accounts.decode("order", oi.data);
  if (o.cancelled) return;
  orders.push({ side: o.side?.buy !== undefined ? "buy" : "sell", limit: Number(o.limitPrice.toString()) / 1e6, qty: Number(o.quantity.toString()) / 1e8 });
});
let t = null;
for (let s = Number(a.closeSlot); s < Number(a.closeSlot) + 40 && t == null; s++) { try { t = await connection.getBlockTime(s); } catch {} }
const book = {
  auction: addr, ticker: tk?.symbol, closedAt: t ? new Date(t * 1000).toISOString() : null,
  clearingPrice: Number(a.clearingPrice.toString()) / 1e6, volume: Number(a.executableVolume.toString()) / 1e8,
  units: "price per token, quantity in tokens — the same units as Jupiter's quoted price",
  orders,
};
fs.writeFileSync(out, JSON.stringify(book, null, 1));
console.log(`${book.ticker} ${addr} closed ${book.closedAt}: ${orders.filter((o) => o.side === "buy").length} buys, ${orders.filter((o) => o.side === "sell").length} sells, cleared $${book.clearingPrice} x ${book.volume}`);
