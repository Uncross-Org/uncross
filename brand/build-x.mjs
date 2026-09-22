// The two X images, built from the recoloured SVGs so they re-render in one
// step: node build-x.mjs
//
// Both use the dark variant on the dark ground so the profile picture and the
// header read as one identity in a timeline.
//
// Profile (400x400): X crops it to a circle, so the mark is cropped to its own
// ink bounds and re-padded to sit centred and large inside that circle rather
// than floating small inside the artwork's original 1500x1500 padding.
//
// Header (1500x500): X overlays the profile picture over the bottom-left, and
// the mobile crop trims top and bottom, so the lockup is centred and kept
// inside both safe areas. It carries TOGETHER itself — no separate slogan.

import fs from "node:fs";
import path from "node:path";
import { renderAll } from "./render.mjs";
import { measure } from "./bounds.mjs";

const DIR = import.meta.dirname;
const OUT = path.join(DIR, "kit/x");
const GROUND = "#0a0d14";   // site --bg, dark
const ACCENT = "#8b74ff";   // site --accent, dark

const MARK = path.join(DIR, "kit/logo/uncross-mark-dark.svg");
const LOCKUP = path.join(DIR, "kit/logo/uncross-lockup-dark.svg");

// Bottom-left keep-out for the avatar X lays over the header, and the band the
// mobile crop keeps. Both are measured in header pixels.
export const AVATAR = { cx: 160, cy: 462, d: 272 };
export const MOBILE_BAND = { top: 70, bottom: 430 };

const b = await measure([MARK, LOCKUP], 9811);
const mb = b["uncross-mark-dark.svg"];
const lb = b["uncross-lockup-dark.svg"];

/** An <svg> cropped to the artwork's own ink bounds, with optional padding. */
function cropped(file, bb, pad = 0) {
  const svg = fs.readFileSync(file, "utf8");
  const vb = `${bb.x - pad} ${bb.y - pad} ${bb.w + pad * 2} ${bb.h + pad * 2}`;
  return svg
    .replace(/<svg([^>]*)>/, (m, a) =>
      `<svg${a.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "").replace(/\sviewBox="[^"]*"/, "")}` +
      ` viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">`);
}

// ---------------------------------------------------------------- profile
// 64% of the square across. The mark's bbox diagonal then sits well inside the
// circle X crops to, so nothing clips and it still fills the frame.
const P = 400;
const markW = Math.round(P * 0.64);
const markH = Math.round(markW * (mb.h / mb.w));
const profileHtml = `<html><body style="margin:0;width:${P}px;height:${P}px;background:${GROUND};display:grid;place-items:center">
  <div style="width:${markW}px;height:${markH}px">${cropped(MARK, mb)}</div>
</body></html>`;

// ---------------------------------------------------------------- header
// Centred: clear of the bottom-left avatar, and inside the band the mobile
// crop keeps.
const W = 1500, H = 500;
const lockH = 300;
const lockW = Math.round(lockH * (lb.w / lb.h));
const headerBody = (guides) => `<html><body style="margin:0;width:${W}px;height:${H}px;background:${GROUND};position:relative;overflow:hidden">
  <div style="position:absolute;inset:0;background:radial-gradient(48% 120% at 50% 50%, rgba(139,116,255,0.16), transparent 70%)"></div>
  <div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:${lockW}px;height:${lockH}px">${cropped(LOCKUP, lb)}</div>
  ${guides ? `
    <div style="position:absolute;left:${AVATAR.cx - AVATAR.d / 2}px;top:${AVATAR.cy - AVATAR.d / 2}px;width:${AVATAR.d}px;height:${AVATAR.d}px;border-radius:50%;background:rgba(255,255,255,.1);border:3px solid ${ACCENT};box-sizing:border-box"></div>
    <div style="position:absolute;left:0;right:0;top:0;height:${MOBILE_BAND.top}px;background:rgba(233,102,103,.28)"></div>
    <div style="position:absolute;left:0;right:0;top:${MOBILE_BAND.bottom}px;bottom:0;background:rgba(233,102,103,.28)"></div>
    <div style="position:absolute;left:14px;top:${MOBILE_BAND.top + 8}px;font:600 13px ui-sans-serif,system-ui;color:#e9edf5;opacity:.75">mobile crop keeps this band</div>
    <div style="position:absolute;left:${AVATAR.cx + AVATAR.d / 2 + 12}px;top:${AVATAR.cy - 10}px;font:600 13px ui-sans-serif,system-ui;color:${ACCENT}">profile picture sits here</div>
  ` : ""}
</body></html>`;

fs.mkdirSync(OUT, { recursive: true });
await renderAll([
  { html: profileHtml, width: P, height: P, out: path.join(OUT, "profile.png") },
  { html: headerBody(false), width: W, height: H, out: path.join(OUT, "header.png") },
  { html: headerBody(true), width: W, height: H, out: path.join(OUT, "header-safe-areas.png") },
], 9812);

// What the mobile crop actually leaves, and whether the lockup survives it.
const lockTop = H / 2 - lockH / 2, lockBottom = H / 2 + lockH / 2;
const lockLeft = W / 2 - lockW / 2, lockRight = W / 2 + lockW / 2;
const avatarRight = AVATAR.cx + AVATAR.d / 2, avatarTop = AVATAR.cy - AVATAR.d / 2;
console.log(`\nmark  ink ${mb.w.toFixed(0)}x${mb.h.toFixed(0)} -> ${markW}x${markH} in ${P}x${P} (${((markW / P) * 100).toFixed(0)}% across)`);
console.log(`lockup ink ${lb.w.toFixed(0)}x${lb.h.toFixed(0)} -> ${lockW}x${lockH} at x ${lockLeft.toFixed(0)}..${lockRight.toFixed(0)}, y ${lockTop}..${lockBottom}`);
console.log(`mobile band ${MOBILE_BAND.top}..${MOBILE_BAND.bottom}: lockup ${lockTop >= MOBILE_BAND.top && lockBottom <= MOBILE_BAND.bottom ? "SURVIVES intact" : "WOULD BE CLIPPED"}`);
console.log(`avatar keep-out ends x=${avatarRight}, y>=${avatarTop}: lockup starts x=${lockLeft.toFixed(0)} -> ${lockLeft > avatarRight ? `clear by ${(lockLeft - avatarRight).toFixed(0)}px` : "OVERLAPS"}`);
