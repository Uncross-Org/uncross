// The order path, end to end, through the live dashboard, checked on chain.
//
//   RPC_URLS=<devnet rpc> node scripts/order-path-browser.mjs --base https://uncross.0xo.in [--ticker AAPLx]
//
// A fresh wallet (a throwaway keypair behind a Wallet Standard stand-in that
// signs in this process) is funded by the faucet through the page, then:
//   1. places a buy and cancels it while the auction is open — the cancel must
//      land and return the escrow;
//   2. places a second buy and waits for the freeze — the Cancel button must be
//      disabled, and a cancel sent straight to the program with preflight
//      skipped must land as a failed transaction, leaving the order in place;
//   3. waits for the cross — the page must raise its "crossed" notice and show
//      the order's receipt with its settlement.
// Every assertion reads chain state, not page text, except the two that are
// about the page itself (the notice and the receipt). Takes up to one auction
// cadence, about 20 minutes.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { decodeAuction, getProgram, loadKeypair, loadTickers, makeConnection, orderPda, quoteAta, sendV0, tickerAta, vaultQuoteAta, vaultTickerAta, TICKER_PROGRAM, QUOTE_PROGRAM } from "./lib.mjs";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "https://uncross.0xo.in");
const OUT = arg("out", path.join(os.tmpdir(), "uncross-order-path"));
fs.mkdirSync(OUT, { recursive: true });
const SLOT_S = 0.166; // measured devnet slot time; only used to choose a ticker
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const conn = makeConnection();
const registry = loadTickers();
const { program } = getProgram(loadKeypair("deploy"));
const ID = program.programId;
const QUOTE = new PublicKey(registry.quoteMint);

// ------------------------------------------------------------ choose a ticker
// The one whose freeze comes soonest while leaving time to fund, place and cancel.
const venue = await (await fetch(`${BASE}/api/venue`, { cache: "no-store" })).json();
const slot0 = await conn.getSlot("confirmed");
const bySymbol = Object.fromEntries(registry.tickers.map((t) => [t.devnetMint, t.symbol]));
const candidates = venue.auctions
  .map((w) => ({ address: w.address, a: decodeAuction(Buffer.from(w.data, "base64")) }))
  .filter(({ a }) => a.status === "open" && a.closeSlot > slot0 && bySymbol[a.tickerMint.toBase58()])
  .map(({ address, a }) => ({ address, a, symbol: bySymbol[a.tickerMint.toBase58()], toFreeze: (a.closeSlot - a.freezeSlots - slot0) * SLOT_S }))
  .filter((c) => c.toFreeze >= 150 && (!arg("ticker") || c.symbol === arg("ticker")))
  .sort((x, y) => x.toFreeze - y.toFreeze);
if (!candidates.length) throw new Error("no running auction with at least 150s before its freeze; try again shortly");
const pick = candidates[0];
const TICKER = pick.symbol;
const MINT = pick.a.tickerMint;
console.log(`ticker ${TICKER}, auction ${pick.address}, freeze in ~${Math.round(pick.toFreeze)}s`);

// ------------------------------------------------------------ browser + wallet
const kp = Keypair.generate();
const me = kp.publicKey.toBase58();
console.log(`fresh wallet ${me}`);
const SHIM = `(() => { const ADDRESS=${JSON.stringify(me)};
  const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const dec=(t)=>{let n=0n;for(const c of t)n=n*58n+BigInt(A.indexOf(c));let h=n.toString(16);if(h.length%2)h="0"+h;const o=[];for(let i=0;i<h.length;i+=2)o.push(parseInt(h.slice(i,i+2),16));for(const c of t){if(c!=="1")break;o.unshift(0);}return new Uint8Array(o);};
  const account={address:ADDRESS,publicKey:dec(ADDRESS),chains:["solana:devnet"],features:["solana:signTransaction"],label:"Test Wallet"};
  window.__signSeq=0; window.__signWaiting={};
  window.__signTxResolve=(id,signed,error)=>{const w=window.__signWaiting[id]; if(!w)return; delete window.__signWaiting[id]; error?w.rej(new Error(error)):w.res(signed);};
  const wallet={version:"1.0.0",name:"Test Wallet",icon:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",chains:["solana:devnet"],accounts:[account],
    features:{"standard:connect":{version:"1.0.0",connect:async()=>({accounts:[account]})},"standard:disconnect":{version:"1.0.0",disconnect:async()=>{}},"standard:events":{version:"1.0.0",on:()=>()=>{}},
      "solana:signTransaction":{version:"1.0.0",supportedTransactionVersions:["legacy",0],signTransaction:async(...inputs)=>{const out=[];for(const input of inputs.flat()){const b64=btoa(String.fromCharCode(...new Uint8Array(input.transaction)));
        const signed=await new Promise((res,rej)=>{const id=++window.__signSeq;window.__signWaiting[id]={res,rej};window.__signTxRaw(JSON.stringify({id,b64}));});
        out.push({signedTransaction:Uint8Array.from(atob(signed),(c)=>c.charCodeAt(0))});}return out;}}}};
  const reg=()=>window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet",{detail:(api)=>api.register(wallet)}));
  window.addEventListener("wallet-standard:app-ready",(e)=>{try{e.detail.register(wallet)}catch{}}); reg(); document.addEventListener("DOMContentLoaded",reg);
  // Every notice the page raises, kept, since each one disappears after a few seconds.
  // Installed once the document exists; this script runs before it does.
  window.__notices=[];
  const watch=()=>new MutationObserver(()=>{for(const t of document.querySelectorAll(".toast span:first-child")){const x=t.innerText; if(x && !window.__notices.includes(x)) window.__notices.push(x);}})
    .observe(document.body,{subtree:true,childList:true,characterData:true});
  document.readyState==="loading" ? document.addEventListener("DOMContentLoaded",watch) : watch();
})();`;

const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const dir = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort((a, b) => b.split("-")[1] - a.split("-")[1])[0];
const bin = ["mac-arm64", "mac-x64"].map((a) => path.join(cache, dir, `chrome-headless-shell-${a}`, "chrome-headless-shell")).find(fs.existsSync);
const port = 9650 + Math.floor(Math.random() * 40);
const chrome = spawn(bin, [`--remote-debugging-port=${port}`, "--headless", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let ver;
for (let i = 0; i < 80 && !ver; i++) {
  try {
    ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const send = (method, params = {}, sid) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, (m) => (m.error ? rej(new Error(method + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
  if (m.method === "Runtime.bindingCalled" && m.params.name === "__signTxRaw") {
    const { id: reqId, b64 } = JSON.parse(m.params.payload);
    let expr;
    try {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      tx.sign([kp]);
      expr = `window.__signTxResolve(${reqId}, ${JSON.stringify(Buffer.from(tx.serialize()).toString("base64"))})`;
    } catch (err) {
      expr = `window.__signTxResolve(${reqId}, null, ${JSON.stringify(String(err))})`;
    }
    send("Runtime.evaluate", { expression: expr }, m.sessionId).catch(() => {});
  }
};
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, s);
await send("Runtime.enable", {}, s);
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, s);
await send("Runtime.addBinding", { name: "__signTxRaw" }, s);
await send("Page.addScriptToEvaluateOnNewDocument", { source: SHIM }, s);
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }, s)).result?.value;
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" }, s);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(r.data, "base64"));
};
const clickText = (t, scope = "") =>
  ev(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(`${scope} button`)})].find(e=>(e.innerText||"").trim().toLowerCase().includes(${JSON.stringify(t)}) && !e.disabled); if(!el) return false; el.scrollIntoView({block:"center"}); el.click(); return true; })()`);
const setInput = (label, value) =>
  ev(`(() => { const el=document.querySelector('input[aria-label=${JSON.stringify(label)}]'); if(!el) return false; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event("input",{bubbles:true})); return true; })()`);
const notices = () => ev(`window.__notices.slice()`);
const step = async (name, ok, detail) => {
  results.push({ step: name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    await shot("order-path-FAIL");
    console.log("notices:", JSON.stringify(await notices()));
    finish(1);
  }
};
function finish(code) {
  fs.writeFileSync(path.join(OUT, "order-path.json"), JSON.stringify({ base: BASE, ticker: TICKER, wallet: me, results }, null, 2));
  console.log(`\nORDER PATH: ${code ? "FAIL" : "PASS"} (${results.length} checks, log in ${OUT})`);
  ws.close();
  chrome.kill();
  process.exit(code);
}

/** This wallet's orders, straight from chain. */
async function myOrders() {
  const r = await conn.getProgramAccounts(ID, { commitment: "confirmed", filters: [{ dataSize: 111 }, { memcmp: { offset: 40, bytes: me } }] });
  return r.map(({ pubkey, account: { data: b } }) => ({
    address: pubkey.toBase58(),
    auction: new PublicKey(b.subarray(8, 40)).toBase58(),
    index: b.readUInt16LE(72),
    limit: b.readBigUInt64LE(75),
    escrow: b.readBigUInt64LE(91),
    cancelled: !!b[107],
    settled: !!b[108],
    filled: b.readBigUInt64LE(99),
  }));
}
const quoteBalance = async () => BigInt((await conn.getTokenAccountBalance(quoteAta(kp.publicKey, QUOTE), "confirmed").catch(() => ({ value: { amount: "0" } }))).value.amount);
const lastSig = async (addr) => (await conn.getSignaturesForAddress(new PublicKey(addr), { limit: 1 }, "confirmed"))[0];

// ------------------------------------------------------------ fund
await send("Page.navigate", { url: `${BASE}/app?ticker=${TICKER}` }, s);
await sleep(8000);
let connected = false;
for (let attempt = 0; attempt < 4 && !connected; attempt++) {
  await clickText("select wallet");
  await sleep(1500);
  await clickText("test wallet");
  for (let i = 0; i < 12 && !connected; i++) {
    await sleep(500);
    connected = (await ev(`document.querySelector(".wallet-adapter-button")?.innerText ?? ""`)).includes("..");
  }
}
await step("wallet connected", connected, me);
await sleep(3000);
await step("clicked Get test tokens", await clickText("get test tokens"));
let funded = false;
for (let i = 0; i < 40 && !funded; i++) {
  await sleep(1500);
  funded = (await quoteBalance()) > 0n;
}
await step("faucet funded the wallet (read on chain)", funded, `${Number(await quoteBalance()) / 1e6} test USDC`);

// A price to start from: the page's first price chip, or a fixed fallback.
await sleep(4000);
const chipPrice = await ev(`(() => { const c=document.querySelector(".chips .chip"); const m=c && c.innerText.match(/\\$([0-9,]+\\.[0-9]+)/); return m ? Number(m[1].replace(/,/g,"")) : null; })()`);
const ref = chipPrice ?? 100;

async function place(price, shares) {
  await clickText("buy", ".order-form .seg-side");
  await setInput("Limit price per share in dollars", price.toFixed(2));
  await setInput("Number of shares", shares);
  await sleep(600);
  const before = (await myOrders()).length;
  const clicked = await ev(`(() => { const b=document.querySelector(".order-form .btn.wide:not([disabled])"); if(!b) return false; b.click(); return b.innerText; })()`);
  let orders = [];
  for (let i = 0; i < 40 && orders.length <= before; i++) {
    await sleep(1500);
    orders = await myOrders();
  }
  return { clicked, order: orders.length > before ? orders.find((o) => o.auction === pick.address && !o.cancelled && !o.settled) ?? orders[orders.length - 1] : null };
}

// ------------------------------------------------------------ 1. cancel while open
const qStart = await quoteBalance();
const a = await place(Math.max(1, ref * 0.5), "0.1");
await step("order A placed (read on chain)", !!a.order, a.order ? `${a.order.address}, escrow ${Number(a.order.escrow) / 1e6} USDC, button "${a.clicked}"` : `button: ${a.clicked}`);
const phaseA = await ev(`document.querySelector(".pill-label")?.innerText ?? ""`);
await step("auction still open before cancelling", /taking orders/i.test(phaseA), phaseA);
await sleep(3000);
const cancelClicked = await ev(`(() => { const b=[...document.querySelectorAll(".mine .tbl button")].find(x=>/cancel/i.test(x.innerText) && !x.disabled); if(!b) return false; b.click(); return true; })()`);
await step("clicked Cancel on order A while open", cancelClicked);
let aNow = null;
for (let i = 0; i < 40 && !aNow?.cancelled; i++) {
  await sleep(1500);
  aNow = (await myOrders()).find((o) => o.address === a.order.address);
}
const cancelSig = await lastSig(a.order.address);
await step("order A cancelled on chain", aNow?.cancelled, `tx ${cancelSig?.signature}`);
await step("order A's escrow came back", (await quoteBalance()) === qStart, `${Number(qStart) / 1e6} USDC before and after`);
await shot("1-cancelled-while-open");

// ------------------------------------------------------------ 2. refused once frozen
const askNow = await ev(`(() => { const t=[...document.querySelectorAll(".stat")].find(x=>/best ask/i.test(x.innerText)); const m=t && t.innerText.match(/\\$([0-9,]+\\.[0-9]+)/); return m ? Number(m[1].replace(/,/g,"")) : null; })()`);
const bPrice = (askNow ?? ref) * 1.02;
const b = await place(bPrice, "0.1");
await step("order B placed (read on chain)", !!b.order, b.order ? `${b.order.address} at $${bPrice.toFixed(2)}` : `button: ${b.clicked}`);
let phase = "";
for (let i = 0; i < 900 && !/closing/i.test(phase); i++) {
  await sleep(1000);
  phase = await ev(`document.querySelector(".pill-label")?.innerText ?? ""`);
}
await step("auction reached its freeze", /closing/i.test(phase), phase);
await sleep(4000);
const btn = await ev(`(() => { const b=[...document.querySelectorAll(".mine .tbl button")].find(x=>/cancel/i.test(x.innerText)); return b ? { disabled: b.disabled, status: b.closest("tr")?.querySelector(".status")?.innerText } : null; })()`);
await step("Cancel is disabled once frozen, and the row says Frozen", btn?.disabled && /frozen/i.test(btn.status ?? ""), JSON.stringify(btn));
// The app cannot be made to send this cancel: React ignores clicks on a
// button it has disabled. So the refusal is tested where it matters, at the
// program, with preflight skipped so the attempt lands on chain.
// Straight to the program, preflight skipped, so the refusal lands on chain.
const auctionKey = new PublicKey(pick.address);
const ix = await program.methods
  .cancelOrder()
  .accountsStrict({
    owner: kp.publicKey,
    order: orderPda(ID, auctionKey, b.order.index),
    ownerTickerAta: tickerAta(kp.publicKey, MINT),
    ownerQuoteAta: quoteAta(kp.publicKey, QUOTE),
    auction: auctionKey,
    vaultTicker: vaultTickerAta(auctionKey, MINT),
    vaultQuote: vaultQuoteAta(auctionKey, QUOTE),
    tickerMint: MINT,
    quoteMint: QUOTE,
    tickerTokenProgram: TICKER_PROGRAM,
    quoteTokenProgram: QUOTE_PROGRAM,
  })
  .instruction();
let refusedSig = null;
let refusedErr = null;
try {
  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const { TransactionMessage } = await import("@solana/web3.js");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: kp.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message());
  tx.sign([kp]);
  refusedSig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await conn.confirmTransaction(refusedSig, "confirmed").catch(() => {});
  await sleep(2000);
  const t = await conn.getTransaction(refusedSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  refusedErr = t?.meta?.err ? (t.meta.logMessages ?? []).map((l) => l.match(/Error Code: (\w+)/)?.[1]).find(Boolean) ?? JSON.stringify(t.meta.err) : null;
} catch (e) {
  refusedErr = `send failed: ${e.message}`;
}
const bNow = (await myOrders()).find((o) => o.address === b.order.address);
await step("a cancel sent straight to the program failed on chain", !!refusedSig && /PastFreezeWindow/.test(refusedErr ?? ""), `tx ${refusedSig}: ${refusedErr}`);
await step("order B is still live on chain", bNow && !bNow.cancelled, JSON.stringify({ cancelled: bNow?.cancelled, settled: bNow?.settled }));
await shot("2-refused-when-frozen");

// ------------------------------------------------------------ 3. the cross
let receipt = null;
let crossedNotice = null;
for (let i = 0; i < 300 && !(receipt && crossedNotice); i++) {
  await sleep(2000);
  crossedNotice ??= (await notices()).find((n) => /crossed/i.test(n)) ?? null;
  receipt = await ev(`(() => { const r=document.querySelector(".receipt"); if(!r || !r.innerText.includes(${JSON.stringify(pick.address.slice(0, 4))})) return null; return r.innerText.replace(/\\n+/g," | "); })()`);
}
await step("the page raised a notice at the cross", !!crossedNotice, crossedNotice ?? "none");
let bFinal = null;
for (let i = 0; i < 60 && !bFinal?.settled; i++) {
  await sleep(2000);
  bFinal = (await myOrders()).find((o) => o.address === b.order.address);
}
const settleSig = await lastSig(b.order.address);
await step("order B settled on chain", bFinal?.settled, `filled ${Number(bFinal?.filled ?? 0n) / 1e8} tokens, tx ${settleSig?.signature}`);
for (let i = 0; i < 20 && !(receipt && /settled/i.test(receipt) && receipt.includes(settleSig.signature.slice(0, 4))); i++) {
  await sleep(3000);
  receipt = await ev(`(() => { const r=document.querySelector(".receipt"); return r ? r.innerText.replace(/\\n+/g," | ") : null; })()`);
}
await step("the receipt shows the result and its settlement", !!receipt && receipt.includes(settleSig.signature.slice(0, 4)), receipt);
await shot("3-receipt");
finish(0);
