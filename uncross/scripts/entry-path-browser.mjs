// The entry path, in a real browser, as a stranger would do it.
//
// Fresh browser, a wallet that has never existed, and only actions a person
// can take with a mouse: connect, click "Get test tokens", type a price and a
// size, click place. Signing crosses into the page over the DevTools protocol
// rather than an HTTP signer on localhost, because an https page may not fetch
// a private http origin — that hop is what silently failed every run against
// the live domain while the harness still reported a pass.
//
// Nothing here passes on rendered text alone: the final word belongs to the
// chain.
//
//   RPC_URLS=... node entry-test.mjs https://uncross.0xo.in

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";

const BASE = process.argv[2] ?? "https://uncross.0xo.in";
const TICKER = process.argv[3] ?? "AAPLx";
// --open: the ticker is dormant, so the visitor has to open its auction first.
const OPEN = process.argv.includes("--open");
const PORT = 9700;
const PROGRAM_ID = "Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP";
const OUT = path.dirname(new URL(import.meta.url).pathname);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findShell() {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dirs = fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) for (const arch of ["mac-arm64", "mac-x64"]) {
    const p = path.join(cache, d, `chrome-headless-shell-${arch}`, "chrome-headless-shell");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("chrome-headless-shell not found");
}

const kp = Keypair.generate();
const pubkey = kp.publicKey.toBase58();
console.log(`fresh wallet ${pubkey}`);

const WALLET_SHIM = `
(() => {
  const ADDRESS = ${JSON.stringify(pubkey)};
  const b58 = (() => {
    const A = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    return { decode(s){ let n=0n; for(const c of s){ const i=A.indexOf(c); if(i<0) throw new Error("bad b58"); n=n*58n+BigInt(i);}
      let hex=n.toString(16); if(hex.length%2)hex="0"+hex; const out=[]; for(let i=0;i<hex.length;i+=2)out.push(parseInt(hex.slice(i,i+2),16));
      for(const c of s){ if(c!=="1")break; out.unshift(0);} return new Uint8Array(out); } };
  })();
  const account = { address: ADDRESS, publicKey: b58.decode(ADDRESS), chains: ["solana:devnet"],
    features: ["solana:signTransaction"], label: "Test Wallet" };
  window.__signSeq = 0; window.__signWaiting = {};
  window.__signTxResolve = (id, signed, error) => {
    const w = window.__signWaiting[id]; if (!w) return; delete window.__signWaiting[id];
    error ? w.rej(new Error(error)) : w.res(signed);
  };
  const wallet = {
    version: "1.0.0", name: "Test Wallet",
    icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=",
    chains: ["solana:devnet"], accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "standard:disconnect": { version: "1.0.0", disconnect: async () => {} },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": {
        version: "1.0.0", supportedTransactionVersions: ["legacy", 0],
        signTransaction: async (...inputs) => {
          const out = [];
          for (const input of inputs.flat()) {
            const b64 = btoa(String.fromCharCode(...new Uint8Array(input.transaction)));
            const signed = await new Promise((res, rej) => {
              const id = ++window.__signSeq;
              window.__signWaiting[id] = { res, rej };
              window.__signTxRaw(JSON.stringify({ id, b64 }));
            });
            out.push({ signedTransaction: Uint8Array.from(atob(signed), (c) => c.charCodeAt(0)) });
          }
          return out;
        },
      },
    },
  };
  const register = () => window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(wallet) }));
  window.addEventListener("wallet-standard:app-ready", (e) => { try { e.detail.register(wallet); } catch {} });
  register();
  document.addEventListener("DOMContentLoaded", register);
})();
`;

const chrome = spawn(findShell(), [`--remote-debugging-port=${PORT}`, "--headless", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let version;
for (let i = 0; i < 80 && !version; i++) { try { version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json(); } catch { await sleep(250); } }
if (!version) throw new Error("devtools never came up");

const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); const logs = [];
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
  ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
});
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled") logs.push(m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 160));
  if (m.method === "Runtime.exceptionThrown") logs.push("EXC " + (m.params.exceptionDetails.exception?.description ?? "").slice(0, 160));
  if (m.method === "Runtime.bindingCalled" && m.params.name === "__signTxRaw") {
    const { id: reqId, b64 } = JSON.parse(m.params.payload);
    let expr;
    try {
      const tx = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
      tx.sign([kp]);
      expr = `window.__signTxResolve(${reqId}, ${JSON.stringify(Buffer.from(tx.serialize()).toString("base64"))})`;
      logs.push("signed a transaction for the page");
    } catch (err) { expr = `window.__signTxResolve(${reqId}, null, ${JSON.stringify(String(err))})`; logs.push("SIGN ERROR " + err); }
    send("Runtime.evaluate", { expression: expr }, m.sessionId).catch(() => {});
  }
};

const { targetId } = await send("Target.createTarget", { url: "about:blank", width: 1440, height: 900 });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId);
await send("Runtime.enable", {}, sessionId);
await send("Runtime.addBinding", { name: "__signTxRaw" }, sessionId);
await send("Page.addScriptToEvaluateOnNewDocument", { source: WALLET_SHIM }, sessionId);

const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
const shot = async (name) => { const s = await send("Page.captureScreenshot", { format: "png" }, sessionId); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(s.data, "base64")); };
const step = async (name, ok, detail) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) { await shot("entry-FAIL"); console.log("\nrecent console: " + logs.slice(-6).join(" | ")); console.log("\nENTRY PATH: FAIL"); ws.close(); chrome.kill(); process.exit(1); }
};
const clickText = async (text, tag = "button") => ev(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find(e => (e.innerText||"").trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}));
  if (!el) return false; el.scrollIntoView({block:"center"}); el.click(); return true; })()`);

const t0 = Date.now();
await send("Page.navigate", { url: `${BASE}/app?ticker=${TICKER}` }, sessionId);
await sleep(9000);
await step("dashboard loaded", (await ev(`!!document.querySelector(".shell")`)) === true);

await clickText("select wallet"); await sleep(1200);
await clickText("test wallet"); await sleep(3500);
await step("wallet connected in the UI", (await ev(`document.body.innerText.includes(${JSON.stringify(pubkey.slice(0, 4))})`)) === true, pubkey.slice(0, 8) + "…");

await sleep(2000);
await step("the faucet action is offered to an empty wallet", (await ev(`!!document.querySelector(".faucet-card")`)) === true);
await step("clicked Get test tokens", (await clickText("get test tokens")) === true);

let funded = false;
for (let i = 0; i < 40 && !funded; i++) { await sleep(1500); funded = await ev(`document.body.innerText.includes("Funded:")`); }
await step("faucet reported success", funded === true);
const toast = await ev(`(() => { const m = document.body.innerText.match(/Funded:[^\\n]*/); return m ? m[0] : null; })()`);
await step("the toast names both event tickers", !!toast && /AAPLx/.test(toast) && /IBMx/.test(toast), toast ?? "no toast text");
await shot("entry-funded");

let hasBalance = false;
for (let i = 0; i < 30 && !hasBalance; i++) { await sleep(2000); hasBalance = await ev(`/6,?000/.test(document.body.innerText)`); }
await step("balances reached the order form", hasBalance === true);

if (OPEN) {
  await step("the page offers to open an auction for the dormant ticker", (await ev(`!!document.querySelector(".open-auction")`)) === true);
  const openText = await ev(`(() => { const b = [...document.querySelectorAll(".open-auction button")].find(x => /open an auction/i.test(x.innerText) && !x.disabled); if (!b) return null; b.click(); return b.innerText.trim(); })()`);
  await step("clicked open", !!openText, String(openText));
  let opened = null, openErr = null;
  for (let i = 0; i < 30 && !opened && !openErr; i++) {
    await sleep(1500);
    const r = JSON.parse(await ev(`JSON.stringify({ ok: (document.body.innerText.match(/${TICKER} (auction opened|already has an auction running)[^\\n]*/) || [])[0] || null, err: (document.body.innerText.match(/could not open[^\\n]*|not a listed ticker[^\\n]*|opened an auction recently[^\\n]*|maximum number of on-demand[^\\n]*/) || [])[0] || null })`));
    opened = r.ok; openErr = r.err;
  }
  await step("the auction was opened", !!opened, opened || `error shown: ${openErr ?? "timed out"}`);
  let ready = false;
  for (let i = 0; i < 20 && !ready; i++) { await sleep(1500); ready = await ev(`!document.querySelector(".open-auction") && /Taking orders/.test(document.querySelector(".pill")?.innerText || "")`); }
  await step("the new book is shown and taking orders", ready === true);
  await shot("entry-opened");
}

const priced = await ev(`(() => {
  const chip = [...document.querySelectorAll(".chip")].find(c => /cross|bid|pyth/i.test(c.innerText));
  if (chip) { chip.click(); return "chip: " + chip.innerText.trim(); }
  const input = document.querySelector(".order-form input"); if (!input) return null;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "250.00"); input.dispatchEvent(new Event("input", { bubbles: true })); return "typed 250.00";
})()`);
await step("a price could be set", !!priced, priced ?? "no price input");
await sleep(600);

await step("typed a share amount", (await ev(`(() => {
  const inputs = [...document.querySelectorAll(".order-form input")]; const shares = inputs[1]; if (!shares) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(shares, "0.4"); shares.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`)) === true);
await sleep(800);

const placeClicked = await ev(`(() => {
  const btn = [...document.querySelectorAll(".order-form button")].find(b => /place|buy|review/i.test(b.innerText) && !b.disabled && !/^(buy|sell)$/i.test(b.innerText.trim()));
  if (!btn) return false; btn.click(); return btn.innerText.trim(); })()`);
await step("the place-order button was enabled and clicked", !!placeClicked, String(placeClicked));

let placed = false, errorToast = null;
for (let i = 0; i < 40 && !placed && !errorToast; i++) {
  await sleep(1500);
  const r = await ev(`(() => { const t = document.body.innerText;
    const ok = /(Buy|Sell) [\\d.,]+ ${TICKER} @ \\$[\\d.,]+ placed/.exec(t);
    const bad = /Failed to fetch|Transaction failed[^\\n]*|Cancelled in wallet|expired before it landed[^\\n]*|Insufficient[^\\n]*/.exec(t);
    return JSON.stringify({ ok: ok ? ok[0] : null, bad: bad ? bad[0] : null }); })()`);
  const j = JSON.parse(r); if (j.ok) placed = j.ok; if (j.bad) errorToast = j.bad;
}
await step("the order was confirmed in the UI", !!placed, placed || `error shown: ${errorToast ?? "timed out"}`);
await shot("entry-placed");

// The chain has the last word.
const rpc = (process.env.RPC_URLS ?? "https://api.devnet.solana.com").split(",")[0];
const conn = new Connection(rpc, "confirmed");
let onChain = null;
for (let i = 0; i < 20 && !onChain; i++) {
  await sleep(2000);
  for (const s of await conn.getSignaturesForAddress(kp.publicKey, { limit: 10 })) {
    if (s.err) continue;
    const tx = await conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0 });
    const keys = (tx?.transaction.message.staticAccountKeys ?? []).map((k) => k.toBase58());
    if (keys.includes(PROGRAM_ID) && !tx?.meta?.err) { onChain = s.signature; break; }
  }
}
await step("a successful program transaction from this wallet is on chain", !!onChain, onChain ? onChain.slice(0, 20) + "…" : "none after 40s");

console.log(`\nENTRY PATH: PASS — ${((Date.now() - t0) / 1000).toFixed(0)}s, wallet ${pubkey}, tx ${onChain}`);
fs.writeFileSync(`${OUT}/entry-wallet.txt`, `${pubkey}\n${onChain}\n`);
ws.close(); chrome.kill(); process.exit(0);
