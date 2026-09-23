// Screenshot the ticker search with a query typed, at 1440 and 390 in both
// themes. On a phone the picker sits behind the menu button, so it is opened.
//   node scripts/shoot-search.mjs <baseUrl> <outDir> [query]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const [BASE, OUT, QUERY] = [process.argv[2], process.argv[3] ?? ".", process.argv[4] ?? "micro"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const d = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
const chrome = spawn(path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"), ["--remote-debugging-port=9890", "--headless", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let v; for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch("http://127.0.0.1:9890/json/version")).json(); } catch { await sleep(250); } }
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const p = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
const send = (method, params = {}, sid) => Promise.race([new Promise((res) => { const i = ++id; p.set(i, (m) => res(m.result ?? {})); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); }), sleep(20000).then(() => ({}))]);
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
for (const theme of ["light", "dark"]) for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile }, sessionId);
  await send("Page.navigate", { url: `${BASE}/app?ticker=AAPLx&theme=${theme}` }, sessionId);
  await sleep(8000);
  if (mobile) { await ev(`document.querySelector(".side-toggle")?.click()`); await sleep(600); }
  await ev(`(() => { const i = document.getElementById("ticker-search"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(i, ${JSON.stringify(QUERY)}); i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(800);
  const info = JSON.parse(await ev(`JSON.stringify({ label: document.querySelector(".side-label")?.innerText, rows: [...document.querySelectorAll(".side-item")].slice(0, 6).map(b => b.innerText.replace(/\\s+/g, " ")), cw: document.documentElement.clientWidth, sw: document.documentElement.scrollWidth })`));
  const s = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync(path.join(OUT, `search-${theme}-${w}.png`), Buffer.from(s.data, "base64"));
  console.log(`${theme.padEnd(5)} ${String(w).padEnd(4)} "${info.label}" hscroll=${info.sw > info.cw ? "YES" : "no"} | ${info.rows.slice(0, 3).join(" | ")}`);
}
ws.close(); chrome.kill(); process.exit(0);
