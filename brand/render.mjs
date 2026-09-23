// Render SVGs to PNG with chrome-headless-shell. Used for every artefact in
// the kit so anything here re-renders in one step.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function findShell() {
  const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
  const dirs = fs.readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
  for (const d of dirs) for (const a of ["mac-arm64", "mac-x64"]) {
    const p = path.join(cache, d, `chrome-headless-shell-${a}`, "chrome-headless-shell");
    if (fs.existsSync(p)) return p;
  }
  throw new Error("chrome-headless-shell not found");
}

/** jobs: [{ html, width, height, out, scale }] */
export async function renderAll(jobs, port = 9800) {
  const chrome = spawn(findShell(), [`--remote-debugging-port=${port}`, "--headless", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
  let v;
  for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(250); } }
  if (!v) throw new Error("devtools never came up");
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, (m) => (m.error ? rej(new Error(method + ": " + JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  await send("Page.enable", {}, sessionId);

  for (const j of jobs) {
    await send("Emulation.setDeviceMetricsOverride", { width: j.width, height: j.height, deviceScaleFactor: j.scale ?? 1, mobile: false }, sessionId);
    // Transparent jobs keep their alpha, so an overlay can sit over video.
    await send("Emulation.setDefaultBackgroundColorOverride", j.transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {}, sessionId);
    await send("Page.navigate", { url: "data:text/html;charset=utf-8," + encodeURIComponent(j.html) }, sessionId);
    await sleep(j.settle ?? 450);
    const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, sessionId);
    fs.mkdirSync(path.dirname(j.out), { recursive: true });
    fs.writeFileSync(j.out, Buffer.from(data, "base64"));
    console.log(`rendered ${path.basename(j.out)} ${j.width}x${j.height}${j.scale && j.scale !== 1 ? ` @${j.scale}x` : ""}`);
  }
  ws.close(); chrome.kill();
}
