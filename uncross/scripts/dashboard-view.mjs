// Open the dashboard as any wallet, read-only, and report what it shows.
//
//   node scripts/dashboard-view.mjs --base https://uncross.0xo.in --ticker MSTRx \
//     --wallet <address> --view trade|orders|portfolio --width 1440 --theme light --out shot.png
//
// The wallet is a Wallet Standard stand-in that connects as the given address
// and refuses to sign, so it can look at anyone's receipts and orders without
// holding their keys. Prints the text of the page's main parts, whether the
// page scrolls sideways, and any page errors, and saves a screenshot.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg("base", "http://localhost:3000");
const TICKER = arg("ticker", "AAPLx");
const ADDRESS = arg("wallet", null);
const VIEW = arg("view", "trade");
const WIDTH = Number(arg("width", 1440));
const THEME = arg("theme", "light");
const OUT = arg("out", null);
const JS = arg("js", "on") !== "off";
// Extra URL parameters, e.g. "wallet=<address>" for a read-only link or "auction=<address>".
const QUERY = arg("query", "");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const dir = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort((a, b) => b.split("-")[1] - a.split("-")[1])[0];
const bin = ["mac-arm64", "mac-x64"].map((a) => path.join(cache, dir, `chrome-headless-shell-${a}`, "chrome-headless-shell")).find(fs.existsSync);
const port = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(bin, [`--remote-debugging-port=${port}`, "--headless", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let v;
for (let i = 0; i < 80 && !v; i++) {
  try {
    v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  } catch {
    await sleep(250);
  }
}
const ws = new WebSocket(v.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pend = new Map();
const errors = [];
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
  if (m.method === "Runtime.exceptionThrown") errors.push((m.params.exceptionDetails.exception?.description ?? "").slice(0, 200));
};
const send = (method, params = {}, sid) =>
  new Promise((res, rej) => {
    const i = ++id;
    pend.set(i, (m) => (m.error ? rej(new Error(method + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) }));
  });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId: s } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, s);
await send("Runtime.enable", {}, s);
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 1000, deviceScaleFactor: 1, mobile: WIDTH < 500 }, s);
if (!JS) await send("Emulation.setScriptExecutionDisabled", { value: true }, s);

if (ADDRESS) {
  const SHIM = `(() => { const ADDRESS = ${JSON.stringify(ADDRESS)};
    const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const dec=(t)=>{let n=0n;for(const c of t)n=n*58n+BigInt(A.indexOf(c));let h=n.toString(16);if(h.length%2)h="0"+h;const o=[];for(let i=0;i<h.length;i+=2)o.push(parseInt(h.slice(i,i+2),16));for(const c of t){if(c!=="1")break;o.unshift(0);}return new Uint8Array(o);};
    const account={address:ADDRESS,publicKey:dec(ADDRESS),chains:["solana:devnet"],features:["solana:signTransaction"],label:"View"};
    const wallet={version:"1.0.0",name:"View Wallet",icon:"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",chains:["solana:devnet"],accounts:[account],
      features:{"standard:connect":{version:"1.0.0",connect:async()=>({accounts:[account]})},"standard:disconnect":{version:"1.0.0",disconnect:async()=>{}},"standard:events":{version:"1.0.0",on:()=>()=>{}},
        "solana:signTransaction":{version:"1.0.0",supportedTransactionVersions:["legacy",0],signTransaction:async()=>{throw new Error("view-only wallet")}}}};
    const reg=()=>window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet",{detail:(api)=>api.register(wallet)}));
    window.addEventListener("wallet-standard:app-ready",(e)=>{try{e.detail.register(wallet)}catch{}}); reg(); document.addEventListener("DOMContentLoaded",reg); })();`;
  await send("Page.addScriptToEvaluateOnNewDocument", { source: SHIM }, s);
}
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }, s)).result?.value;
const clickText = (t) =>
  ev(`(() => { const el=[...document.querySelectorAll("button")].find(e=>(e.innerText||"").trim().toLowerCase().includes(${JSON.stringify(t)})); if(!el) return false; el.click(); return true; })()`);

const url = `${BASE}${VIEW === "landing" ? "/" : `/app?ticker=${TICKER}&theme=${THEME}${VIEW === "trade" ? "" : `&view=${VIEW}`}${QUERY ? `&${QUERY}` : ""}`}`;
await send("Page.navigate", { url }, s);
await sleep(JS ? 7000 : 3000);

let connected = null;
if (ADDRESS && JS) {
  // The modal fades in; retry until the wallet shows as connected.
  for (let attempt = 0; attempt < 4 && !connected; attempt++) {
    await clickText("select wallet");
    await sleep(1500);
    await clickText("view wallet");
    for (let i = 0; i < 12 && !connected; i++) {
      await sleep(500);
      const t = await ev(`document.querySelector(".wallet-adapter-button")?.innerText ?? ""`);
      if (t.includes("..")) connected = t;
    }
    await ev(`document.querySelector(".wallet-adapter-modal-button-close")?.click()`);
  }
}

const ready = {
  orders: ".orders-tbl, .page .card.empty, .page-empty",
  portfolio: ".port-cards, .page .card.empty, .page-empty",
  auction: ".tx-tbl, .page .card.empty",
  trade: ADDRESS || QUERY.includes("wallet=") ? ".receipt, .mine .empty" : ".stat-groups",
  landing: "main, body",
}[VIEW];
let found = false;
for (let i = 0; i < 30 && !found && JS; i++) {
  await sleep(1500);
  found = await ev(`!!document.querySelector(${JSON.stringify(ready)})`);
}
await sleep(2000);

const part = (sel) => `(document.querySelector(${JSON.stringify(sel)})?.innerText ?? "")`;
const text =
  VIEW === "trade"
    ? await ev(`[${part(".stat-groups")}, ${part(".mine")}, ${part(".past-last")}, ${part(".chips")}].join("\\n=====\\n")`)
    : VIEW === "landing"
      ? await ev(`document.body.innerText.slice(0, 1500)`)
      : await ev(`[${part(".banner.viewing")}, ${part(".page")}, ${part(".venue-status")}].join("\\n=====\\n")`);
const layout = JSON.parse(
  await ev(`JSON.stringify({ overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, height: document.documentElement.scrollHeight,
    sidebar: [...document.querySelectorAll(".side-item")].slice(0, 4).map((e) => e.innerText.replace(/\\n/g, " · ")) })`),
);
if (OUT) {
  const h = Math.min(layout.height, 3000);
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: WIDTH, height: h, scale: 1 } }, s);
  fs.writeFileSync(OUT, Buffer.from(shot.data, "base64"));
}
console.log(JSON.stringify({ view: VIEW, width: WIDTH, theme: THEME, js: JS, wallet: ADDRESS?.slice(0, 6) ?? null, connected, found, ...layout, errors }));
console.log(text);
ws.close();
chrome.kill();
