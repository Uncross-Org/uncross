// Read tokenized-equity mints live off mainnet and say whether Uncross can
// list them unchanged.
//
//   node scripts/read-mints.mjs <mint> [<mint> ...]
//
// For each mint: token program, decimals, authorities, every Token-2022
// extension with its state, whether a transfer fee is being charged in the
// current epoch, whether a transfer hook points at a program, and the default
// account state. Then it simulates creating the associated token account a
// program-owned PDA (an Uncross auction vault) would need, without sending
// anything. A mint passes only if nothing it carries changes how many tokens a
// transfer delivers or needs accounts the program does not pass.

import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";

const RPC = process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com";
const conn = new Connection(RPC, "confirmed");
const UNCROSS = new PublicKey("Gk9ZUMqPcNuF3PduisUZXBffUP7cCrfnBSCAyTdpjYGP");
// Any funded mainnet account can pay a simulated transaction; nothing is signed or sent.
const PAYER = new PublicKey(process.env.SIM_PAYER ?? "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9");

const epoch = (await conn.getEpochInfo()).epoch;
const payerLamports = await conn.getBalance(PAYER);
console.log(`mainnet epoch ${epoch}; simulation payer ${PAYER.toBase58()} holds ${payerLamports / 1e9} SOL\n`);

for (const m of process.argv.slice(2)) {
  const mint = new PublicKey(m);
  const info = await conn.getParsedAccountInfo(mint);
  if (!info.value) {
    console.log(`${m}: no account\n`);
    continue;
  }
  const program = info.value.owner;
  const p = info.value.data.parsed?.info ?? {};
  const exts = p.extensions ?? [];
  const ext = (name) => exts.find((e) => e.extension === name)?.state;
  const problems = [];

  const fee = ext("transferFeeConfig");
  let feeNow = null;
  if (fee) {
    const newer = fee.newerTransferFee, older = fee.olderTransferFee;
    const active = epoch >= Number(newer.epoch) ? newer : older;
    feeNow = { bps: active.transferFeeBasisPoints, max: active.maximumFee, fromEpoch: Number(active.epoch), withheld: fee.withheldAmount };
    if (Number(active.transferFeeBasisPoints) > 0) problems.push(`transfer fee ${active.transferFeeBasisPoints} bps active now (since epoch ${active.epoch}, max ${active.maximumFee})`);
  }
  const hook = ext("transferHook");
  if (hook?.programId) problems.push(`transfer hook points at ${hook.programId}`);
  const das = ext("defaultAccountState");
  if (das && das.accountState !== "initialized") problems.push(`new accounts start ${das.accountState}`);
  if (exts.some((e) => e.extension === "nonTransferable")) problems.push("non-transferable");
  const paused = ext("pausableConfig")?.paused;
  if (paused) problems.push("mint is paused");

  // The account an auction vault would be: owned by a PDA of the program.
  const pda = PublicKey.findProgramAddressSync([Buffer.from("probe"), mint.toBuffer()], UNCROSS)[0];
  const ata = getAssociatedTokenAddressSync(mint, pda, true, program);
  let sim;
  try {
    const { blockhash } = await conn.getLatestBlockhash();
    const msg = new TransactionMessage({ payerKey: PAYER, recentBlockhash: blockhash, instructions: [createAssociatedTokenAccountIdempotentInstruction(PAYER, ata, pda, mint, program)] }).compileToV0Message();
    const r = await conn.simulateTransaction(new VersionedTransaction(msg), { sigVerify: false, replaceRecentBlockhash: true });
    sim = r.value.err ? `FAILED ${JSON.stringify(r.value.err)} ${(r.value.logs ?? []).slice(-2).join(" / ")}` : "ok";
  } catch (e) {
    sim = `error ${e.message}`;
  }
  if (sim !== "ok") problems.push(`PDA-owned token account cannot be created: ${sim}`);

  console.log(`${m}`);
  console.log(`  program   ${program.toBase58()}${program.toBase58().startsWith("Tokenz") ? " (Token-2022)" : " (SPL Token)"}`);
  console.log(`  decimals  ${p.decimals}   supply ${p.supply}   mint authority ${p.mintAuthority ?? "none"}   freeze authority ${p.freezeAuthority ?? "none"}`);
  console.log(`  extensions (${exts.length}): ${exts.map((e) => e.extension).join(", ") || "none"}`);
  if (fee) console.log(`  transfer fee now: ${JSON.stringify(feeNow)}`);
  if (hook) console.log(`  transfer hook program: ${hook.programId ?? "null (disabled)"}`);
  if (das) console.log(`  default account state: ${das.accountState}`);
  if (ext("pausableConfig")) console.log(`  paused: ${paused}`);
  if (ext("scaledUiAmountConfig")) console.log(`  scaled UI multiplier: ${ext("scaledUiAmountConfig").multiplier}`);
  console.log(`  PDA-owned token account (simulated create): ${sim}`);
  console.log(`  VERDICT: ${problems.length ? `needs a program change — ${problems.join("; ")}` : "no blocking extension"}\n`);
}
