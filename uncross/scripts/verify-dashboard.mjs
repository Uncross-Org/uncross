// Check the dashboard's labels and candle colours on a given deployment:
// sidebar text read from the DOM, screenshots in both themes, and a live theme
// toggle — the chart used to keep the old theme's colours until a reload.
//   node scripts/verify-dashboard.mjs <baseUrl> <outDir>
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const BASE = process.argv[2], OUT = process.argv[3] ?? ".";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const d = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
const chrome = spawn(path.join(cache, d, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"), ["--remote-debugging-port=9870", "--headless", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
let v; for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch("http://127.0.0.1:9870/json/version")).json(); } catch { await sleep(250); } }
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const p = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
const send = (method, params = {}, sid) => Promise.race([new Promise((res) => { const i = ++id; p.set(i, (m) => res(m.result ?? {})); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); }), sleep(20000).then(() => ({}))]);
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
const shot = async (n) => { const s = await send("Page.captureScreenshot", { format: "png" }, sessionId); if (s.data) fs.writeFileSync(path.join(OUT, n), Buffer.from(s.data, "base64")); };
const sidebar = () => ev(`JSON.stringify([...document.querySelectorAll(".side-item")].map(b => b.innerText.replace(/\\s+/g," ").trim()))`);
const pill = () => ev(`document.querySelector(".pill")?.innerText?.replace(/\\s+/g," ") ?? null`);
const tokens = () => ev(`JSON.stringify({ theme: document.documentElement.dataset.theme ?? "light", up: getComputedStyle(document.documentElement).getPropertyValue("--up").trim(), down: getComputedStyle(document.documentElement).getPropertyValue("--down").trim() })`);

for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
  for (const theme of ["light", "dark"]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile }, sessionId);
    await send("Page.navigate", { url: `${BASE}/app?ticker=AAPLx&theme=${theme}` }, sessionId);
    await sleep(9000);
    await shot(`dash-${theme}-${w}.png`);
    const cw = await ev("document.documentElement.clientWidth"), sw = await ev("document.documentElement.scrollWidth");
    console.log(`${theme.padEnd(5)} ${String(w).padEnd(4)} tokens=${await tokens()} pill=${JSON.stringify(await pill())} hscroll=${sw > cw ? "YES" : "no"}`);
    if (w === 1440 && theme === "light") console.log("  sidebar:", await sidebar());
  }
}
// Live toggle: light page, flip to dark in place, confirm the chart rebuilt.
await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId);
await send("Page.navigate", { url: `${BASE}/app?ticker=AAPLx&theme=light` }, sessionId);
await sleep(9000);
const before = await ev(`document.querySelector(".chart-wrap canvas, canvas")?.toDataURL().length ?? 0`);
const clicked = await ev(`(() => { const b = [...document.querySelectorAll("button")].find(x => /theme|dark|light/i.test(x.getAttribute("aria-label")||x.title||"")); if (b) { b.click(); return b.getAttribute("aria-label")||b.title; } return null; })()`);
await sleep(2500);
await shot("dash-toggled-to-dark-1440.png");
console.log(`toggle clicked=${JSON.stringify(clicked)} now=${await tokens()}`);
ws.close(); chrome.kill(); process.exit(0);
