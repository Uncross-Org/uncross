// Render the invite clip: load invite.html, call render(t) for every frame at
// 30fps, screenshot, encode. Deterministic — frame n is always the same image,
// so the clip re-renders identically in one step.
//   node render.mjs
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { measure } from "../bounds.mjs";
const D = import.meta.dirname, FRAMES = path.join(D, "frames"), FPS = 30, END = 7.00;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The light lockup, cropped to its own ink so it centres properly.
const LOCK = path.join(D, "../kit/logo/uncross-lockup-light.svg");
const b = (await measure([LOCK], 9891))["uncross-lockup-light.svg"];
const lockup = fs.readFileSync(LOCK, "utf8").replace(/<svg([^>]*)>/, (m, a) =>
  `<svg${a.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "").replace(/\sviewBox="[^"]*"/, "")} viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="100%" height="100%">`);
const html = fs.readFileSync(path.join(D, "invite.html"), "utf8")
  .replace("__BOOK__", fs.readFileSync(path.join(D, "book.json"), "utf8"))
  .replace("__LOCKUP__", JSON.stringify(lockup));
const page = path.join(D, ".invite.rendered.html");
fs.writeFileSync(page, html);

const cache = path.join(os.homedir(), "Library/Caches/ms-playwright");
const dir = fs.readdirSync(cache).filter((x) => x.startsWith("chromium_headless_shell-")).sort((a, c) => Number(c.split("-")[1]) - Number(a.split("-")[1]))[0];
const chrome = spawn(path.join(cache, dir, "chrome-headless-shell-mac-arm64", "chrome-headless-shell"), ["--remote-debugging-port=9892", "--headless", "--hide-scrollbars", "--force-color-profile=srgb", "about:blank"], { stdio: "ignore" });
let v; for (let i = 0; i < 80 && !v; i++) { try { v = await (await fetch("http://127.0.0.1:9892/json/version")).json(); } catch { await sleep(250); } }
const ws = new WebSocket(v.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}, sid) => new Promise((res) => { const i = ++id; pend.set(i, (m) => res(m.result ?? m.error)); ws.send(JSON.stringify({ id: i, method, params, ...(sid ? { sessionId: sid } : {}) })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
await send("Page.enable", {}, sessionId); await send("Runtime.enable", {}, sessionId);
await send("Emulation.setDeviceMetricsOverride", { width: 1080, height: 1080, deviceScaleFactor: 2, mobile: false }, sessionId);
await send("Page.navigate", { url: "file://" + page }, sessionId);
await sleep(1500);
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }, sessionId)).result?.value;
// Fonts must be loaded before frame 0, or the first frames render in a fallback face.
const fonts = await ev(`document.fonts.ready.then(() => [...document.fonts].filter(f => f.status === "loaded").map(f => f.family + " " + f.weight).join(", "))`);
console.log("fonts loaded:", fonts || "NONE");
const err = await ev(`typeof window.render`);
if (err !== "function") throw new Error("invite.html did not define render(): " + err);

fs.rmSync(FRAMES, { recursive: true, force: true }); fs.mkdirSync(FRAMES);
const N = Math.round(END * FPS);
for (let f = 0; f < N; f++) {
  await ev(`window.render(${(f / FPS).toFixed(6)})`);
  const s = await send("Page.captureScreenshot", { format: "png" }, sessionId);
  fs.writeFileSync(path.join(FRAMES, `f${String(f).padStart(4, "0")}.png`), Buffer.from(s.data, "base64"));
}
ws.close(); chrome.kill();
console.log(`rendered ${N} frames`);

const out = path.join(D, "../kit/video/invite.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", path.join(FRAMES, "f%04d.png"),
  "-vf", "scale=1080:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16",
  "-profile:v", "high", "-level", "4.1", "-pix_fmt", "yuv420p", "-color_range", "tv", "-colorspace", "bt709",
  "-color_primaries", "bt709", "-color_trc", "bt709", "-r", String(FPS), "-movflags", "+faststart", "-an", out]);
console.log(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height,r_frame_rate,pix_fmt:format=duration,size", "-of", "default=nw=1", out]).toString());
