// Screenshot the connect-wallet modal open, at 1440 and 390, both themes.
// A Wallet Standard wallet is registered so at least one row renders as
// "Detected" — without one, headless Chrome shows no installed wallets and the
// row style under test never appears.
//
//   node scripts/shoot-wallet-modal.mjs <baseUrl> <outDir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const BASE = process.argv[2] ?? "https://uncross.0xo.in";
const OUT = process.argv[3] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const d = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
const bin = path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
const SHIM = `(() => {
  const acct = { address: "11111111111111111111111111111111", publicKey: new Uint8Array(32), chains: ["solana:devnet"], features: [], label: "Test Wallet" };
  const w = { version: "1.0.0", name: "Test Wallet", icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0naHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnIHZpZXdCb3g9JzAgMCAyOCAyOCc+PHJlY3Qgd2lkdGg9JzI4JyBoZWlnaHQ9JzI4JyByeD0nNicgZmlsbD0nIzViM2RmNScvPjwvc3ZnPg==",
    chains: ["solana:devnet"], accounts: [],
    features: { "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [acct] }) },
      "standard:events": { version: "1.0.0", on: () => () => {} },
      "solana:signTransaction": { version: "1.0.0", supportedTransactionVersions: ["legacy", 0], signTransaction: async () => [] } } };
  const reg = () => window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: (api) => api.register(w) }));
  window.addEventListener("wallet-standard:app-ready", (e) => { try { e.detail.register(w); } catch {} });
  reg(); document.addEventListener("DOMContentLoaded", reg);
})();`;
const chrome = spawn(bin, ["--remote-debugging-port=9830", "--headless", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let v; for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch("http://127.0.0.1:9830/json/version")).json(); } catch { await sleep(250); } }
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const p = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
const send = (method, params = {}, sid) => Promise.race([new Promise((res) => { const i = ++id; p.set(i, (m) => res(m.result ?? m.error)); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); }), sleep(20000).then(() => { console.log(`TIMEOUT on ${method}`); return {}; })]);
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
await send("Page.addScriptToEvaluateOnNewDocument", { source: SHIM }, sessionId);
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
const results = [];
for (const theme of ["light", "dark"]) for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile }, sessionId);
  await send("Page.navigate", { url: `${BASE}/app?ticker=AAPLx&theme=${theme}` }, sessionId);
  await sleep(8000);
  await ev(`(() => { const b = [...document.querySelectorAll("button")].find(x => /select wallet/i.test(x.innerText)); if (b) b.click(); return !!b; })()`);
  await sleep(1500);
  const probe = JSON.parse(await ev(`JSON.stringify((() => {
    const row = document.querySelector(".wallet-adapter-modal-list .wallet-adapter-button");
    const wrap = document.querySelector(".wallet-adapter-modal-wrapper");
    const cs = row ? getComputedStyle(row) : null, ws = wrap ? getComputedStyle(wrap) : null;
    const span = row?.querySelector("span"); const ss = span ? getComputedStyle(span) : null;
    return { modalOpen: !!wrap, rows: document.querySelectorAll(".wallet-adapter-modal-list li").length,
      rowBg: cs?.backgroundColor, rowBorder: cs?.borderTopColor + " " + cs?.borderTopWidth, rowPad: cs?.padding, rowH: row?.getBoundingClientRect().height,
      wrapBg: ws?.backgroundColor, detected: span?.innerText, detectedColor: ss?.color, detectedSize: ss?.fontSize,
      clientW: document.documentElement.clientWidth, scrollW: document.documentElement.scrollWidth };
  })())`));
  const s = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  const f = path.join(OUT, `modal-${theme}-${w}.png`);
  fs.writeFileSync(f, Buffer.from(s.data, "base64"));
  results.push({ theme, w, ...probe });
  console.log(`${theme.padEnd(5)} ${String(w).padEnd(4)} open=${probe.modalOpen} rows=${probe.rows} rowBg=${probe.rowBg} wrapBg=${probe.wrapBg} rowH=${probe.rowH} detected="${probe.detected}" ${probe.detectedColor} ${probe.detectedSize} hscroll=${probe.scrollW > probe.clientW ? "YES" : "no"}`);
}
ws.close(); chrome.kill(); process.exit(0);
