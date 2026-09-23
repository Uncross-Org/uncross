// Every icon the site and dashboard serve, and the share image, built from the
// recoloured mark so they re-render in one step: node build-icons.mjs
//
// Outputs, all at the site root so the dashboard at /app shares them (its
// build empties public/app, so nothing can live there):
//   favicon.ico (16, 32, 48)  favicon.svg  favicon-16x16.png  favicon-32x32.png
//   apple-touch-icon.png (180)  icon-192.png  icon-512.png  site.webmanifest
//   og.png (1200x630)
// and the inline mark both apps draw beside the wordmark:
//   site/components/brand-mark.tsx  web/src/components/BrandMark.tsx
//
// The icons use the dark variant on the dark ground, as the X profile picture
// does, so a tab, a home screen and a timeline show the same thing. A violet
// mark on a transparent ground would vanish on a dark browser tab strip.

import fs from "node:fs";
import path from "node:path";
import { renderAll } from "./render.mjs";

const DIR = import.meta.dirname;
const ROOT = path.join(DIR, "..");
const PUB = path.join(ROOT, "site/public");
const GROUND = "#0a0d14"; // site --bg, dark
const ACCENT = "#8b74ff"; // site --accent, dark
const TEXT = "#e9edf5"; // site --text, dark
const MUTED = "#8a93a6";

// Ink bounds of the mark inside its 1500x1500 artwork, measured with getBBox
// (bounds.mjs). Every crop below starts from these.
const MB = { x: 450.5, y: 376.93, w: 599.02, h: 497.98 };

// The one path, rounded to 0.1 of a unit in a 1500-unit box: invisible at any
// size, and a third of the bytes.
const src = fs.readFileSync(path.join(DIR, "kit/logo/uncross-mark-dark.svg"), "utf8");
const D = [...src.matchAll(/<path fill="[^"]*" d="([^"]*)"/g)].map((m) => m[1])[0]
  .replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n) * 10) / 10))
  .replace(/\s+/g, " ").trim();
const VB = `${MB.x} ${MB.y} ${MB.w} ${MB.h}`;

/** A square tile with the mark centred, `fill` of the tile's width across. */
function tileSvg(size, { fill = 0.72, radius = 0.22 } = {}) {
  const w = size * fill;
  const h = w * (MB.h / MB.w);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${GROUND}"/>` +
    `<svg x="${(size - w) / 2}" y="${(size - h) / 2}" width="${w}" height="${h}" viewBox="${VB}">` +
    `<path fill="${ACCENT}" d="${D}"/></svg></svg>`;
}
const page = (svg, px) =>
  `<html><body style="margin:0;width:${px}px;height:${px}px;background:transparent">${svg.replace(/width="\d+(\.\d+)?" height="\d+(\.\d+)?" viewBox="0 0/, `width="${px}" height="${px}" viewBox="0 0`)}</body></html>`;

// Small sizes fill more of the tile: at 16px every pixel of mark counts.
const small = (px) => ({ html: page(tileSvg(64, { fill: 0.8, radius: 0.2 }), px), width: px, height: px, transparent: true });
// iOS rounds the corners itself and shows transparency as black, so the touch
// icon is full-bleed. The manifest icons keep the mark inside the central 80%
// circle Android masks to, so one file serves as "any" and "maskable".
const bleed = (px) => ({ html: page(tileSvg(64, { fill: 0.58, radius: 0 }), px), width: px, height: px });

const TMP = path.join(DIR, ".icons");
fs.mkdirSync(TMP, { recursive: true });

// ---------------------------------------------------------------- share image
const markInline = (h) =>
  `<svg viewBox="${VB}" height="${h}" width="${Math.round(h * (MB.w / MB.h))}" style="display:block"><path fill="${ACCENT}" d="${D}"/></svg>`;
const ogHtml = `<html><head>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,500..700&family=Geist:wght@400..600&family=Geist+Mono:wght@400..500&display=block">
</head><body style="margin:0;width:1200px;height:630px;background:${GROUND};position:relative;overflow:hidden;font-family:Geist,system-ui,sans-serif">
  <div style="position:absolute;inset:0;background:radial-gradient(60% 90% at 22% 40%, rgba(139,116,255,0.16), transparent 70%)"></div>
  <div style="position:absolute;inset:84px 88px 44px;display:flex;flex-direction:column">
    <div style="display:flex;align-items:center;gap:22px">
      ${markInline(64)}
      <span style="font-family:Archivo;font-stretch:125%;font-weight:700;font-size:52px;color:${TEXT};letter-spacing:-0.01em">Uncross</span>
    </div>
    <div style="margin-top:64px;font-family:Archivo;font-stretch:112%;font-weight:600;font-size:66px;line-height:1.04;letter-spacing:-0.02em;color:${TEXT}">
      One price for everyone,<br><span style="color:${ACCENT}">even when the market is thin.</span>
    </div>
    <div style="margin-top:28px;max-width:900px;font-size:27px;line-height:1.4;color:#b7bfcf">
      A periodic call auction for tokenized stocks on Solana. Every order in a round fills at the single price that trades the most shares.
    </div>
    <div style="margin-top:auto;display:flex;justify-content:space-between;font-family:'Geist Mono',ui-monospace,monospace;font-size:20px;color:${MUTED}">
      <span>uncross.0xo.in</span><span>Solana devnet · xStocks</span>
    </div>
  </div>
</body></html>`;

await renderAll([
  { ...small(16), out: path.join(TMP, "16.png") },
  { ...small(32), out: path.join(TMP, "32.png") },
  { ...small(48), out: path.join(TMP, "48.png") },
  { ...bleed(180), out: path.join(TMP, "180.png") },
  { ...bleed(192), out: path.join(TMP, "192.png") },
  { ...bleed(512), out: path.join(TMP, "512.png") },
  { html: ogHtml, width: 1200, height: 630, out: path.join(TMP, "og.png"), settle: 2500 },
], 9821);

const cp = (from, to) => fs.copyFileSync(path.join(TMP, from), path.join(PUB, to));
cp("16.png", "favicon-16x16.png");
cp("32.png", "favicon-32x32.png");
cp("180.png", "apple-touch-icon.png");
cp("192.png", "icon-192.png");
cp("512.png", "icon-512.png");
cp("og.png", "og.png");

// favicon.ico: a directory of PNGs, which every browser since IE Vista reads.
{
  const imgs = [16, 32, 48].map((s) => ({ s, png: fs.readFileSync(path.join(TMP, `${s}.png`)) }));
  const head = Buffer.alloc(6 + 16 * imgs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(imgs.length, 4);
  let off = head.length;
  imgs.forEach(({ s, png }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(s, e); head.writeUInt8(s, e + 1); head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(png.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += png.length;
  });
  fs.writeFileSync(path.join(PUB, "favicon.ico"), Buffer.concat([head, ...imgs.map((i) => i.png)]));
}

fs.writeFileSync(path.join(PUB, "favicon.svg"), tileSvg(64, { fill: 0.8, radius: 0.2 }) + "\n");
fs.writeFileSync(path.join(PUB, "site.webmanifest"), JSON.stringify({
  name: "Uncross",
  short_name: "Uncross",
  description: "One price for everyone, even when the market is thin. A periodic call auction for tokenized stocks on Solana.",
  start_url: "/",
  display: "standalone",
  background_color: GROUND,
  theme_color: GROUND,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}, null, 2) + "\n");

// ---------------------------------------------------------------- inline mark
const header = `// Generated by brand/build-icons.mjs from brand/kit/logo/uncross-mark-dark.svg;
// edit that, not this. The monogram, cropped to its own ink, in the accent
// colour of whichever theme is showing.
`;
fs.writeFileSync(path.join(ROOT, "site/components/brand-mark.tsx"), `${header}
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="${VB}" className={className} aria-hidden="true" focusable="false">
      <path fill="var(--accent)" d="${D}" />
    </svg>
  );
}
`);
fs.writeFileSync(path.join(ROOT, "web/src/components/BrandMark.tsx"), `${header}
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="${VB}" className={className} aria-hidden="true" focusable="false">
      <path fill="var(--accent)" d="${D}" />
    </svg>
  );
}
`);
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`path ${D.length} chars; wrote icons, manifest, og.png and both marks`);
