// Acceptance test for the pull model, run before anything is built on it:
// does devnet accept a current Hermes update through the fully verified path?
//
// For each Pyth deployment on Solana (the original Core programs and the
// upgraded ones), post one update for the given feed exactly as the keeper
// would — encoded VAA, every guardian signature verified, post_update — then
// read the PriceUpdateV2 account it produced and set it against what
// oracle::check_price requires. Everything created is closed afterwards, so
// the run costs only fees. Nothing about the program changes.
//
// Needs PYTH_API_KEY, RPC_URLS and the deploy keypair; run it with the keeper
// service's environment so the key never passes through a terminal or a file:
//   railway run --service uncross-keeper -- node scripts/pyth-accept.mjs [FEED_ID]
import fs from "node:fs";
import anchor from "@coral-xyz/anchor";
import { loadKeypair, makeConnection, sendV0 } from "./lib.mjs";
import { PYTH_PROGRAMS, buildPostUpdate, fetchLatestUpdate, readPriceUpdate } from "./pyth-pull.mjs";

const { LAMPORTS_PER_SOL } = anchor.web3;
const FEED = (process.argv[2] ?? "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688").replace(/^0x/, "");
/** What the program's gate requires of the account (programs/uncross/src/oracle.rs). */
const GATE_OWNER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";
const PRICE_UPDATE_V2 = "22f123639d7ef4cd"; // sha256("account:PriceUpdateV2")[..8]

const payer = loadKeypair("deploy");
const connection = makeConnection();
const log = (...a) => console.log(new Date().toISOString(), ...a);
const explorer = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const reason = (e) => (e.logs ?? []).filter((l) => /Error|failed|AnchorError/i.test(l)).slice(0, 3).join(" | ") || e.message;

const report = { feed: FEED, ranAt: new Date().toISOString(), cluster: "devnet", payer: payer.publicKey.toBase58(), runs: [] };

log(`fetching the latest Hermes update for ${FEED.slice(0, 8)}…`);
const update = await fetchLatestUpdate([FEED]);
const hermes = update.parsed[0];
report.hermes = { price: hermes.price, conf: hermes.conf, publishTime: hermes.publishTime, ageSecs: Math.round(Date.now() / 1000 - hermes.publishTime) };
log(`Hermes: $${hermes.price} ± ${hermes.conf}, published ${new Date(hermes.publishTime * 1000).toISOString()} (${report.hermes.ageSecs}s ago)`);

for (const which of ["upgraded", "core"]) {
  const run = { which, receiver: PYTH_PROGRAMS[which].receiver.toBase58(), wormhole: PYTH_PROGRAMS[which].wormhole.toBase58(), steps: [] };
  report.runs.push(run);
  const before = await connection.getBalance(payer.publicKey, "confirmed");
  const built = await buildPostUpdate(connection, payer, update.binary[0], which);
  run.vaaBytes = built.vaaBytes;
  run.guardianSetIndex = built.guardianSetIndex;
  const gs = await connection.getAccountInfo(
    anchor.web3.PublicKey.findProgramAddressSync([Buffer.from("GuardianSet"), Buffer.from([0, 0, 0, 0].map((_, i) => (built.guardianSetIndex >>> (24 - 8 * i)) & 255))], built.ids.wormhole)[0],
    "confirmed",
  );
  run.guardianSetOnDevnet = !!gs;
  log(`[${which}] receiver ${run.receiver}, VAA ${built.vaaBytes} bytes, guardian set ${built.guardianSetIndex} ${gs ? "present" : "MISSING"} on devnet`);

  let created = false;
  let ok = true;
  for (const g of built.groups) {
    try {
      const r = await sendV0(connection, payer, g.signers, g.ixs, { cuLimit: g.cu });
      run.steps.push({ step: g.label, ok: true, sig: r.sig, cu: r.cu, size: r.size });
      log(`[${which}] ok   ${g.label} — ${r.cu} CU, ${r.size} B — ${explorer(r.sig)}`);
      if (g.label === "create encoded VAA") created = true;
    } catch (e) {
      ok = false;
      run.steps.push({ step: g.label, ok: false, error: reason(e) });
      log(`[${which}] FAIL ${g.label} — ${reason(e)}`);
      break;
    }
  }

  if (ok) {
    const account = built.accounts[FEED];
    const info = await connection.getAccountInfo(account, "confirmed");
    const p = readPriceUpdate(info);
    const disc = Buffer.from(info.data.subarray(0, 8)).toString("hex");
    run.posted = {
      account: account.toBase58(),
      ...p,
      discriminator: disc,
      checks: {
        "owner is the receiver the program accepts": p.owner === GATE_OWNER,
        "PriceUpdateV2 discriminator": disc === PRICE_UPDATE_V2,
        "fully verified (byte 40 == 1)": p.verification === 1,
        "feed id matches": p.feedId === FEED,
        "price positive": p.price > 0,
        "same print Hermes served": p.publishTime === hermes.publishTime,
      },
    };
    log(`[${which}] posted ${account.toBase58()}: owner ${p.owner}, ${p.len} B, verification ${p.verification}, $${p.price}, published ${new Date(p.publishTime * 1000).toISOString()}`);
    for (const [k, v] of Object.entries(run.posted.checks)) log(`[${which}]   ${v ? "yes" : "NO "} ${k}`);
  }

  // Close whatever was created, success or not: the VAA account and any price update account.
  if (created) {
    for (const c of built.close) {
      if (c.label.startsWith("reclaim") && !ok) continue;
      try {
        const r = await sendV0(connection, payer, [], c.ixs, { cuLimit: c.cu });
        run.steps.push({ step: c.label, ok: true, sig: r.sig });
        log(`[${which}] ok   ${c.label} — ${explorer(r.sig)}`);
      } catch (e) {
        run.steps.push({ step: c.label, ok: false, error: reason(e) });
        log(`[${which}] FAIL ${c.label} — ${reason(e)}`);
      }
    }
  }
  const after = await connection.getBalance(payer.publicKey, "confirmed");
  run.netCostSol = (before - after) / LAMPORTS_PER_SOL;
  run.accepted = ok;
  log(`[${which}] ${ok ? "ACCEPTED" : "REJECTED"} — net cost ${run.netCostSol} SOL`);
}

fs.writeFileSync(new URL("./pyth-accept-result.json", import.meta.url), JSON.stringify(report, null, 2));
log("written scripts/pyth-accept-result.json");
