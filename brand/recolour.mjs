// Recolour the supplied logos to the site's own tokens, by rewriting fills —
// never by filtering a raster.
//
// The artwork uses exactly two colours: #9900cc for the UC monogram and
// #ffffff for the UNCROSS / TOGETHER wordmark. Nothing paints a background,
// so a straight swap is safe and reversible; the originals in brand/original
// are never touched.
//
// Tokens are the site's, read from site/app/globals.css:
//   light  --accent #5b3df5  --text #0b0e14   (for near-white grounds)
//   dark   --accent #8b74ff  --text #e9edf5   (for near-black grounds)

import fs from "node:fs";
import path from "node:path";

const SRC = { mark: "original/2.svg", lockup: "original/1.svg" };
const MARK_SRC = "#9900cc";
const WORD_SRC = "#ffffff";

export const TOKENS = {
  light: { mark: "#5b3df5", word: "#0b0e14", ground: "#ffffff" },
  dark: { mark: "#8b74ff", word: "#e9edf5", ground: "#0a0d14" },
  mono: { mark: "#0b0e14", word: "#0b0e14", ground: "#ffffff" },
};

const rx = (hex) => new RegExp(hex.replace("#", "#"), "gi");

export function recolour(svg, variant) {
  const t = TOKENS[variant];
  return svg.replace(rx(MARK_SRC), t.mark).replace(rx(WORD_SRC), t.word);
}

/** Strip the fixed width/height so the viewBox drives scaling. */
export function fit(svg) {
  return svg.replace(/<svg([^>]*)>/, (m, a) =>
    `<svg${a.replace(/\swidth="[^"]*"/, "").replace(/\sheight="[^"]*"/, "")} width="100%" height="100%">`);
}

export function build() {
  const out = {};
  for (const [kind, file] of Object.entries(SRC)) {
    const svg = fs.readFileSync(path.join(import.meta.dirname, file), "utf8");
    out[kind] = {};
    for (const v of Object.keys(TOKENS)) out[kind][v] = recolour(svg, v);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const built = build();
  const dir = path.join(import.meta.dirname, "kit/logo");
  fs.mkdirSync(dir, { recursive: true });
  for (const [kind, vs] of Object.entries(built))
    for (const [v, svg] of Object.entries(vs)) {
      const f = path.join(dir, `uncross-${kind}-${v}.svg`);
      fs.writeFileSync(f, svg);
      console.log(`wrote ${path.relative(import.meta.dirname, f)}`);
    }
}
