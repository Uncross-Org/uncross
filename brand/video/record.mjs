// Record the live dashboard as timestamped frames — the raw material for the
// launch clip. Nothing is staged: the page is the production app, logged out,
// reading devnet; the frames are exactly what a visitor would have seen.
//
//   node record.mjs <url> <outDir> <seconds> [intervalMs]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const [URL, OUT, SECS, IV] = [process.argv[2], process.argv[3], Number(process.argv[4] ?? 480), Number(process.argv[5] ?? 500)];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const d = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
const bin = path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell");
fs.mkdirSync(OUT, { recursive: true });
const chrome = spawn(bin, ["--remote-debugging-port=9850", "--headless", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let v; for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch("http://127.0.0.1:9850/json/version")).json(); } catch { await sleep(250); } }
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const p = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
const send = (method, params = {}, sid) => Promise.race([
  new Promise((res) => { const i = ++id; p.set(i, (m) => res(m.result ?? {})); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); }),
  sleep(15000).then(() => ({})),
]);
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);
await send("Page.navigate", { url: URL }, sessionId);
await sleep(9000);
const log = [];
const t0 = Date.now();
let n = 0;
while (Date.now() - t0 < SECS * 1000) {
  const tick = Date.now();
  const s = await send("Page.captureScreenshot", { format: "jpeg", quality: 92 }, sessionId);
  if (s.data) {
    const f = `f${String(n).padStart(5, "0")}.jpg`;
    fs.writeFileSync(path.join(OUT, f), Buffer.from(s.data, "base64"));
    // What the page itself says at this instant, for choosing the cut later.
    const r = await send("Runtime.evaluate", { expression: `JSON.stringify({
      pill: document.querySelector(".pill")?.innerText?.replace(/\\s+/g," ") ?? null,
      cross: document.querySelector(".stat .stat-v")?.innerText ?? null,
      liveOrders: (document.body.innerText.match(/(\\d+) live orders?/)||[])[1] ?? null })`, returnByValue: true }, sessionId);
    log.push({ n, f, t: new Date(tick).toISOString(), ...(JSON.parse(r.result?.value ?? "{}")) });
    n++;
  }
  const spent = Date.now() - tick;
  if (spent < IV) await sleep(IV - spent);
}
fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify(log, null, 1));
console.log(`captured ${n} frames over ${((Date.now() - t0) / 1000).toFixed(0)}s`);
ws.close(); chrome.kill(); process.exit(0);
