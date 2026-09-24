// Reads the 24 Sept community auction off chain and writes book.json, the only
// source of every figure in the results clip. No dependencies:
//   node read-book.mjs
// Devnet: both auction accounts, every order account (owner, side, limit,
// quantity, fill), checked against the activity bot's 42 wallets. Mainnet: the
// Pyth AAPL/USD price from the last update transaction at or before the AAPLx
// cross, decoded from the signed price message in its instruction data.
import fs from "node:fs";
import path from "node:path";

const D = import.meta.dirname;
const PROGRAM = "Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP";
const DEVNET = "https://api.devnet.solana.com", MAINNET = "https://api.mainnet-beta.solana.com";
const BOOKS = [
  { ticker: "AAPLx", auction: "7uc3uXqHFRx5eqAbuDV5BUdoimCVYLARQYDCYYMivcVn", cross: "439jNtYvUnqosHwJpcgXarVmxSMixB11X43omAsq22pEtGJ8T971Jz6hHjKksnpSvcR7AwBYxwase2J8wqCHk2wC" },
  { ticker: "IBMx", auction: "JgkL8nLKuFA2rGRCjmFy2EC75mxpZXsXYumWBe6WnwD", cross: "2MvdyHfbfVtnJ578cTWs1ZW9VXYUEHMxKNL7VLmzqc3Fd17kKiYqE1fNmfcDSQGrRgHNKXRDcg3LXkNxymrSCk1K" },
];
const PYTH_AAPL = { account: "D9uk39pqZMcnmtPP9WeC8cREUpKZmyXLga9mSQ79SphW", feed: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(url, method, params) {
  for (let i = 0; i < 8; i++) {
    try {
      const r = await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json();
      if (r.result !== undefined) return r.result;
    } catch {}
    await sleep(2000 * (i + 1));
  }
  throw new Error(`${method} failed`);
}
const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (buf) => { let n = BigInt("0x" + (Buffer.from(buf).toString("hex") || "0")), s = ""; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const x of buf) { if (x) break; s = "1" + s; } return s; };
const unb58 = (s) => { let n = 0n; for (const c of s) n = n * 58n + BigInt(A.indexOf(c)); let h = n.toString(16); if (h.length % 2) h = "0" + h; const lead = s.match(/^1*/)[0].length; return Buffer.concat([Buffer.alloc(lead), n ? Buffer.from(h, "hex") : Buffer.alloc(0)]); };

const repo = path.join(D, "../..");
const bots = new Set(JSON.parse(fs.readFileSync(path.join(repo, "uncross/scripts/bot-owners.json"), "utf8")).owners);
const tickers = JSON.parse(fs.readFileSync(path.join(repo, "uncross/scripts/tickers.json"), "utf8")).tickers;

const out = { event: "Community auction, 24 Sept 2026, Solana devnet", units: "dollars per share and shares (raw amounts converted with each mint's multiplier)", books: [] };
for (const bk of BOOKS) {
  const m = Number(tickers.find((t) => t.symbol === bk.ticker).multiplier);
  const a = Buffer.from((await rpc(DEVNET, "getAccountInfo", [bk.auction, { encoding: "base64" }])).value.data[0], "base64");
  const price = Number(a.readBigUInt64LE(40)), volume = Number(a.readBigUInt64LE(48));
  const accts = await rpc(DEVNET, "getProgramAccounts", [PROGRAM, { encoding: "base64", filters: [{ dataSize: 111 }, { memcmp: { offset: 8, bytes: bk.auction } }] }]);
  const orders = accts.map((x) => {
    const d = Buffer.from(x.account.data[0], "base64");
    return {
      index: d.readUInt16LE(72), wallet: b58(d.subarray(40, 72)), side: d[74] === 0 ? "buy" : "sell",
      limit: Number(d.readBigUInt64LE(75)) / 1e6 / m, qty: (Number(d.readBigUInt64LE(83)) / 1e8) * m, filled: (Number(d.readBigUInt64LE(99)) / 1e8) * m,
    };
  }).sort((x, y) => x.index - y.index).map((o) => ({ ...o, bot: bots.has(o.wallet) }));
  const cross = await rpc(DEVNET, "getTransaction", [bk.cross, { maxSupportedTransactionVersion: 0 }]);
  out.books.push({
    ticker: bk.ticker, auction: bk.auction, cross: bk.cross, crossTime: cross.blockTime, multiplier: m,
    clearingPrice: price / 1e6 / m, volumeShares: (volume / 1e8) * m,
    wallets: new Set(orders.map((o) => o.wallet)).size, walletsNotBot: new Set(orders.filter((o) => !o.bot).map((o) => o.wallet)).size, orders,
  });
  await sleep(500);
}
const nonBot = new Set(out.books.flatMap((b) => b.orders.filter((o) => !o.bot).map((o) => o.wallet)));
out.walletsNotBot = nonBot.size;
out.ordersTotal = out.books.reduce((s, b) => s + b.orders.length, 0);

// Mainnet Pyth AAPL/USD at the AAPLx cross.
const crossT = out.books[0].crossTime;
let before, sig;
for (let page = 0; page < 30 && !sig; page++) {
  const sigs = await rpc(MAINNET, "getSignaturesForAddress", [PYTH_AAPL.account, { limit: 1000, ...(before ? { before } : {}) }]);
  sig = sigs.find((s) => s.blockTime && s.blockTime <= crossT && !s.err);
  before = sigs.at(-1).signature;
}
const tx = await rpc(MAINNET, "getTransaction", [sig.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }]);
const datas = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap((i) => i.instructions)].map((i) => unb58(i.data));
const needle = Buffer.concat([Buffer.from([0]), Buffer.from(PYTH_AAPL.feed, "hex")]);
for (const d of datas) {
  const i = d.indexOf(needle);
  if (i < 0 || d.length < i + 33 + 36) continue;
  const o = i + 33, expo = d.readInt32BE(o + 16);
  out.pythAAPL = {
    source: "mainnet Pyth Equity.US.AAPL/USD, last update at or before the AAPLx cross", tx: sig.signature,
    price: Number(d.readBigInt64BE(o)) * 10 ** expo, conf: Number(d.readBigUInt64BE(o + 8)) * 10 ** expo, publishTime: Number(d.readBigInt64BE(o + 20)),
  };
  break;
}
fs.writeFileSync(path.join(D, "book.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wallets not bot ${out.walletsNotBot}, orders ${out.ordersTotal}`);
for (const b of out.books) console.log(`${b.ticker}: ${b.orders.length} orders, ${b.wallets} wallets (${b.walletsNotBot} not bot), $${b.clearingPrice} x ${b.volumeShares} shares`);
console.log("Pyth AAPL", out.pythAAPL);
