// Devnet fixture mints for the whole xStocks universe.
//
// Every one of the 1,026 real mints carries the same eight Token-2022
// extensions under one authority, so the fixture recipe that produced the
// first ten reproduces all of them: the same spl-token flags as
// create-devnet-tickers.sh, with each mint's own live scaled-UI multiplier
// read from mainnet. Only the mint and its metadata are created — no deploy or
// wallet2 token accounts, which the first ten had but a dormant ticker does not
// need, and which would have added ~3.2 SOL across the universe.
//
// spl-token is called with an argument array, never through a shell: 38
// symbols contain dots and dozens of names contain apostrophes.
//
// Resumable: results append to universe-fixtures.jsonl one line per mint, and
// symbols already there are skipped.
//   RPC_URL=<devnet> node scripts/create-universe-fixtures.mjs [--limit N] [--concurrency 6]
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Connection, PublicKey } from "@solana/web3.js";

const HERE = import.meta.dirname;
const OUT = path.join(HERE, "universe-fixtures.jsonl");
const UNIVERSE = path.join(HERE, "../../docs/data/xstocks-universe-2026-09-23.json");
const DEPLOY = path.join(os.homedir(), ".config/solana/uncross/deploy.json");
const URL = process.env.RPC_URL ?? "https://api.devnet.solana.com";
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg("limit", Infinity));
const CONC = Number(arg("concurrency", 6));

const run = (args) => new Promise((res, rej) =>
  execFile("spl-token", args, { maxBuffer: 1 << 22, timeout: 120_000 }, (e, out, err) => (e ? rej(new Error((err || e.message).slice(0, 300))) : res(out))));

const existing = new Set(JSON.parse(fs.readFileSync(path.join(HERE, "tickers.json"), "utf8")).tickers.map((t) => t.symbol));
const done = new Set(fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).symbol) : []);
const all = JSON.parse(fs.readFileSync(UNIVERSE, "utf8")).tickers;
const todo = all.filter((t) => !existing.has(t.symbol) && !done.has(t.symbol)).slice(0, LIMIT);
console.log(`${all.length} in universe; ${existing.size} already live; ${done.size} already created; ${todo.length} to create now`);
if (!todo.length) process.exit(0);

// Each real mint's multiplier, as currently effective on mainnet.
const main = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const mult = {};
for (let i = 0; i < todo.length; i += 100) {
  const chunk = todo.slice(i, i + 100);
  let r; for (let a = 0; a < 5 && !r; a++) { try { r = await main.getMultipleParsedAccounts(chunk.map((t) => new PublicKey(t.mint))); } catch { await new Promise((z) => setTimeout(z, 1500 * (a + 1))); } }
  const now = Date.now() / 1000;
  r.value.forEach((v, j) => {
    const cfg = v?.data?.parsed?.info?.extensions?.find((e) => e.extension === "scaledUiAmountConfig")?.state;
    mult[chunk[j].symbol] = !cfg ? "1" : String(now >= cfg.newMultiplierEffectiveTimestamp ? cfg.newMultiplier : cfg.multiplier);
  });
}

// A mint, once created, is never created again for the same ticker. The first
// version retried the whole of create() when initialize-metadata failed, so
// every retry made a fresh mint and leaked the last one: 17 mints, about
// 0.057 SOL, before it was caught by reconciling deploy's transactions against
// this file. Now the address is kept across attempts, written to a pending log
// the moment it exists, and only the step that failed is retried.
const PENDING = path.join(HERE, "universe-fixtures.pending.jsonl");
const pending = new Map(fs.existsSync(PENDING) ? fs.readFileSync(PENDING, "utf8").trim().split("\n").filter(Boolean).map((l) => { const j = JSON.parse(l); return [j.symbol, j.devnetMint]; }) : []);

const dev = new Connection(URL, "confirmed");
async function hasMetadata(mint) {
  const v = (await dev.getParsedAccountInfo(new PublicKey(mint))).value;
  return !!v?.data?.parsed?.info?.extensions?.find((e) => e.extension === "tokenMetadata")?.state?.name;
}

async function create(t, state) {
  if (!state.mint && pending.has(t.symbol)) {
    // Recovered from a previous run: its metadata may already be written.
    state.mint = pending.get(t.symbol);
    state.meta = await hasMetadata(state.mint);
  }
  if (!state.mint) {
    const out = await run(["create-token", "--program-2022", "--decimals", "8", "--enable-freeze",
      "--default-account-state", "initialized", "--enable-permanent-delegate", "--enable-transfer-hook",
      "--enable-pause", "--enable-confidential-transfers", "manual", "--enable-metadata",
      "--ui-amount-multiplier", mult[t.symbol], "--fee-payer", DEPLOY, "-u", URL, "--output", "json"]);
    state.mint = JSON.parse(out).commandOutput.address;
    fs.appendFileSync(PENDING, JSON.stringify({ symbol: t.symbol, devnetMint: state.mint }) + "\n");
  }
  if (!state.meta) {
    await run(["initialize-metadata", state.mint, `${t.name} (devnet fixture)`, `${t.symbol}-fx`,
      `https://example.com/${encodeURIComponent(t.symbol)}-fixture.json`, "--fee-payer", DEPLOY, "-u", URL]);
    state.meta = true;
  }
  fs.appendFileSync(OUT, JSON.stringify({ symbol: t.symbol, name: t.name, mainnetMint: t.mint, devnetMint: state.mint, multiplier: mult[t.symbol], halted: t.halted }) + "\n");
  return state.mint;
}

let ok = 0, fail = 0, next = 0;
const t0 = Date.now();
await Promise.all(Array.from({ length: CONC }, async () => {
  while (next < todo.length) {
    const t = todo[next++];
    const state = { mint: null, meta: false };
    for (let a = 0; a < 5; a++) {
      try { const m = await create(t, state); ok++; if (ok % 25 === 0 || todo.length <= 10) console.log(`${ok}/${todo.length} ${t.symbol} -> ${m}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`); break; }
      catch (e) { if (a === 4) { fail++; console.log(`FAILED ${t.symbol} (mint ${state.mint ?? "not created"}, metadata ${state.meta}): ${e.message}`); } else await new Promise((z) => setTimeout(z, 2000 * (a + 1))); }
    }
  }
}));
console.log(`done: ${ok} created, ${fail} failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
