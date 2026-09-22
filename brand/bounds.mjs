// True ink bounds of an SVG, measured by the browser's own getBBox rather than
// guessed from the viewBox. Both supplied files sit off-centre inside a
// 1500x1500 box with heavy padding, so anything cropped to the viewBox floats
// small and off-axis.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findShell() {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const d = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))[0];
  for (const a of ["mac-arm64", "mac-x64"]) {
    const p = path.join(cache, d, `chrome-headless-shell-${a}`, "chrome-headless-shell");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("no shell");
}
export async function measure(svgPaths, port = 9810) {
  const chrome = spawn(findShell(), [`--remote-debugging-port=${port}`, "--headless", "about:blank"], { stdio: "ignore" });
  let v; for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); } }
  const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}, sid) => new Promise((res, rej) => { const i = ++id; pend.set(i, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result))); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);
  const out = {};
  for (const p of svgPaths) {
    const svg = fs.readFileSync(p, "utf8");
    const html = `<html><body style="margin:0">${svg}</body></html>`;
    await send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(html) }, sessionId);
    await sleep(400);
    const r = await send("Runtime.evaluate", { expression: `(() => {
      const svg = document.querySelector("svg");
      const b = svg.getBBox();
      const vb = svg.getAttribute("viewBox");
      return JSON.stringify({ x: b.x, y: b.y, w: b.width, h: b.height, viewBox: vb });
    })()`, returnByValue: true }, sessionId);
    out[path.basename(p)] = JSON.parse(r.result.value);
  }
  ws.close(); chrome.kill();
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const files = process.argv.slice(2);
  const r = await measure(files);
  for (const [k, b] of Object.entries(r)) console.log(k, JSON.stringify(b));
  process.exit(0);
}
