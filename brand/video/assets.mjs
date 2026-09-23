// The launch clip's stills: a burned-in caption overlay and a logo end card,
// both 1080x1080 and rendered from code so the clip rebuilds in one step.
import fs from "node:fs";
import path from "node:path";
import { renderAll } from "../render.mjs";
import { measure } from "../bounds.mjs";
const D = path.join(import.meta.dirname);
const LOCK = path.join(D, "../kit/logo/uncross-lockup-dark.svg");
const b = (await measure([LOCK], 9861))["uncross-lockup-dark.svg"];
const lock = fs.readFileSync(LOCK, "utf8").replace(/<svg([^>]*)>/, (m, a) =>
  `<svg${a.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "").replace(/\sviewBox="[^"]*"/, "")} viewBox="${b.x} ${b.y} ${b.w} ${b.h}" width="100%" height="100%">`);
const FONT = `font-family:'Geist',ui-sans-serif,system-ui,-apple-system,sans-serif`;

// Caption: a bar across the bottom, so the chart and the countdown stay clear.
// "Timelapse" is stated on screen — the footage is real but sped up, and a
// viewer should not have to guess that.
const overlay = `<html><body style="margin:0;width:1080px;height:1080px;background:transparent;${FONT}">
<div style="position:absolute;left:0;right:0;bottom:252px;height:56px;background:linear-gradient(to top,rgba(10,13,20,.96),rgba(10,13,20,0))"></div>
<div style="position:absolute;left:0;right:0;bottom:0;height:252px;background:rgba(10,13,20,.96)"></div>
<div style="position:absolute;left:48px;right:48px;bottom:46px;color:#e9edf5">
  <div style="font-size:19px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#b3bbcb;margin-bottom:16px">
    <span style="display:inline-block;width:11px;height:11px;border-radius:50%;background:#2fc48c;margin-right:12px;vertical-align:1px"></span>Live on Solana devnet · <span style="color:#8b74ff">timelapse</span></div>
  <div style="font-size:48px;font-weight:700;line-height:1.08;letter-spacing:-.02em">Orders collect.<br>Everyone fills at one price.</div>
</div></body></html>`;

const endcard = `<html><body style="margin:0;width:1080px;height:1080px;background:#0a0d14;${FONT};display:flex;flex-direction:column;align-items:center;justify-content:center">
<div style="position:absolute;inset:0;background:radial-gradient(50% 50% at 50% 46%,rgba(139,116,255,.2),transparent 70%)"></div>
<div style="position:relative;width:${Math.round(420 * (b.w / b.h))}px;height:420px">${lock}</div>
<div style="position:relative;margin-top:56px;font-size:26px;font-weight:600;color:#b3bbcb;letter-spacing:.02em">uncross.0xo.in</div>
</body></html>`;

await renderAll([
  { html: overlay, width: 1080, height: 1080, out: path.join(D, "overlay.png"), transparent: true },
  { html: endcard, width: 1080, height: 1080, out: path.join(D, "endcard.png") },
], 9862);
