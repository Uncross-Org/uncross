// Build universe.json: every listed ticker in one shape, for the faucet, the
// site's venue route and the dashboard's search.
//
// The ten active tickers come from tickers.json with their Pyth config; every
// other one from the verified xStocks list joined to its devnet fixture. A
// ticker with no fixture yet is left out rather than listed with nothing
// behind it, so this can be rebuilt at any point while fixtures are created.
//   node scripts/build-universe.mjs
import fs from "node:fs";
import path from "node:path";
const HERE = import.meta.dirname;
const registry = JSON.parse(fs.readFileSync(path.join(HERE, "tickers.json"), "utf8"));
const verified = JSON.parse(fs.readFileSync(path.join(HERE, "../../docs/data/xstocks-universe-2026-09-23.json"), "utf8"));
const FX = path.join(HERE, "universe-fixtures.jsonl");
const fixtures = new Map(
  (fs.existsSync(FX) ? fs.readFileSync(FX, "utf8").trim().split("\n").filter(Boolean) : []).map((l) => {
    const j = JSON.parse(l);
    return [j.symbol, j];
  }),
);
const market = new Map(verified.tickers.map((t) => [t.symbol, t]));

const out = [];
for (const t of registry.tickers) {
  const m = market.get(t.symbol);
  out.push({
    symbol: t.symbol, name: t.name, underlying: t.underlying, devnetMint: t.devnetMint, mainnetMint: t.mainnetMint,
    active: true, pythFeedId: t.pythFeedId ?? null, pythAccount: t.pythAccount ?? null, halted: !!m?.halted, poolTvlUsd: m?.poolTvlUsd ?? null,
  });
}
const active = new Set(out.map((t) => t.symbol));
for (const m of verified.tickers) {
  if (active.has(m.symbol)) continue;
  const f = fixtures.get(m.symbol);
  if (!f) continue;
  out.push({
    symbol: m.symbol, name: m.name, underlying: m.underlying ?? m.symbol.replace(/x$/, ""), devnetMint: f.devnetMint, mainnetMint: m.mint,
    active: false, pythFeedId: null, pythAccount: null, halted: !!m.halted, poolTvlUsd: m.poolTvlUsd,
  });
}
const doc = {
  builtAt: new Date().toISOString(),
  source: "docs/data/xstocks-universe-2026-09-23.json + scripts/universe-fixtures.jsonl + scripts/tickers.json",
  listed: out.length, active: out.filter((t) => t.active).length, of: verified.tickers.length, tickers: out,
};
fs.writeFileSync(path.join(HERE, "universe.json"), JSON.stringify(doc));
console.log(`universe.json: ${doc.listed} listed (${doc.active} active, ${doc.listed - doc.active} dormant) of ${doc.of}; ${(fs.statSync(path.join(HERE, "universe.json")).size / 1024).toFixed(0)} KB`);
