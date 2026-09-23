// Runway for the wallets that keep the venue running, measured over a long
// window.
//
// The previous version compared two readings a couple of hours apart. That is
// exactly the window in which deploy's balance oscillates — it pays rent to
// open an auction and gets it back when one closes — so a sustained drain
// averaged out to nearly zero and the check never warned. It reported
// "runway 75.6h" on a wallet that lost 1.5 SOL over the following day.
//
// So: every run appends a sample, and the rate is the least-squares slope over
// every sample inside LONG_HOURS. Oscillation cancels in the fit; a real trend
// does not. A short window is still printed for context but never triggers a
// warning on its own, and the fit is not trusted until it spans MIN_SPAN_HOURS.
//
//   node scripts/wallet-watch.mjs            # silent unless something is wrong
//   node scripts/wallet-watch.mjs --verbose  # print the sample history too

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadKeypair, makeConnection } from "./lib.mjs";

const WALLETS = ["deploy", "wallet2"];
const LONG_HOURS = 24;       // widest window considered
const MIN_SPAN_HOURS = 4;    // below this the fit is not trusted for a warning
const WARN_RUNWAY_HOURS = 2; // the threshold that must actually fire
const WARN_FLOOR_SOL = 0.08; // and an absolute floor, whatever the trend says

const STORE = path.join(os.homedir(), ".config/solana/uncross/wallet-samples.json");
const verbose = process.argv.includes("--verbose");

function load() {
  try { return JSON.parse(fs.readFileSync(STORE, "utf8")); } catch { return {}; }
}
function save(db) {
  try {
    fs.mkdirSync(path.dirname(STORE), { recursive: true });
    fs.writeFileSync(STORE, JSON.stringify(db, null, 1));
  } catch (e) {
    console.log(`WARN wallet-watch could not write its history (${e.message}) — the trend cannot build`);
  }
}

/** Least-squares slope in SOL per hour over the samples given. */
function slopePerHour(samples) {
  const n = samples.length;
  if (n < 2) return null;
  const t0 = samples[0].t;
  const xs = samples.map((s) => (s.t - t0) / 3_600_000);
  const ys = samples.map((s) => s.sol);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? null : num / den;
}

const c = makeConnection();
const db = load();
const now = Date.now();
const lines = [];

// Every line carries the slot and clock time its balance was read at. Without
// that, a figure quoted from an earlier run is indistinguishable from a live
// one — which is exactly how a two-hour-old balance got reported as current.
const readSlot = await c.getSlot("confirmed");
const readAt = new Date(now).toISOString().slice(11, 19);

for (const name of WALLETS) {
  let sol;
  try {
    sol = (await c.getBalance(loadKeypair(name).publicKey, "confirmed")) / 1e9;
  } catch (e) {
    lines.push(`WARN ${name} could not be read: ${e.message}`);
    continue;
  }

  const hist = (db[name] ?? []).filter((s) => now - s.t <= LONG_HOURS * 3_600_000);
  hist.push({ t: now, sol });
  db[name] = hist;

  const spanH = (now - hist[0].t) / 3_600_000;
  const long = slopePerHour(hist);
  const recent = hist.filter((s) => now - s.t <= 3 * 3_600_000);
  const short = slopePerHour(recent);

  const fmtRate = (r) => (r == null ? "n/a" : `${r >= 0 ? "+" : ""}${r.toFixed(4)} SOL/h`);
  // Only a genuine drain produces a runway; a flat or rising balance has none.
  const draining = long != null && long < -0.0005;
  const runwayH = draining ? sol / -long : null;
  const trusted = spanH >= MIN_SPAN_HOURS;

  const detail =
    `${sol.toFixed(4)} SOL @slot ${readSlot} ${readAt}Z, long ${fmtRate(long)} over ${spanH.toFixed(1)}h (${hist.length} samples)` +
    `, short ${fmtRate(short)}` +
    `, runway ${runwayH == null ? "n/a" : `${runwayH.toFixed(1)}h`}` +
    (trusted ? "" : " [trend still forming]");

  if (sol < WARN_FLOOR_SOL) lines.push(`WARN ${name} ${detail} — below the ${WARN_FLOOR_SOL} SOL floor`);
  else if (trusted && runwayH != null && runwayH < WARN_RUNWAY_HOURS) lines.push(`WARN ${name} ${detail}`);
  else lines.push(`ok ${name} ${detail}`);

  if (verbose) for (const s of hist) lines.push(`     ${new Date(s.t).toISOString()}  ${s.sol.toFixed(4)}`);
}

save(db);
for (const l of lines) console.log(l);
