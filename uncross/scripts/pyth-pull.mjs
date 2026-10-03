// Pyth pull updates: fetch a signed price update from Hermes and post it to
// Solana through the fully verified path, so a cross can be given a fresh
// PriceUpdateV2 account instead of a sponsored push account that has stopped.
//
// The fully verified path, as the receiver SDK's addPostPriceUpdates does it:
//   1. create + init an encoded VAA account (Wormhole), write the VAA into it,
//      and verify it against the guardian set — every guardian signature;
//   2. post_update once per feed: the receiver checks the feed's Merkle proof
//      against the verified VAA and writes a PriceUpdateV2 account marked Full;
//   3. after the consumer, close the encoded VAA and reclaim the price update
//      accounts' rent, so only fees are spent.
// post_update_atomic (partially verified) is never used: oracle::check_price
// refuses anything not fully verified, and that is the right policy.
//
// The SDK's own entry point does not load under Node here (its Jito helper
// drags in an older web3.js), so this uses its IDLs, VAA helpers and the
// Anchor 0.29 it ships with, and builds the same instructions.
//
// PYTH_API_KEY is read from the environment and sent only as a bearer token
// to Hermes. It is never logged, returned or put in an error message.

import { createRequire } from "node:module";
import anchor from "@coral-xyz/anchor";

const { Keypair, PublicKey, SystemProgram } = anchor.web3;
const sdkRequire = createRequire(import.meta.resolve("@pythnetwork/pyth-solana-receiver/package.json"));
const anchor29 = sdkRequire("@coral-xyz/anchor");
const SDK = "./dist/cjs/";
const { IDL: RECEIVER_IDL } = sdkRequire(`${SDK}idl/pyth_solana_receiver.cjs`);
const { IDL: WORMHOLE_IDL } = sdkRequire(`${SDK}idl/wormhole_core_bridge_solana.cjs`);
const address = sdkRequire(`${SDK}address.cjs`);
const { VAA_START } = sdkRequire(`${SDK}vaa.cjs`);
const { parseAccumulatorUpdateData, parsePriceFeedMessage } = sdkRequire("@pythnetwork/price-service-sdk");

/** The two Pyth deployments on Solana: the original Core programs and the upgraded ("Pro-compatible") ones. */
export const PYTH_PROGRAMS = {
  core: { receiver: address.DEFAULT_RECEIVER_PROGRAM_ID, wormhole: address.DEFAULT_WORMHOLE_PROGRAM_ID },
  upgraded: { receiver: address.PRO_COMPATIBLE_RECEIVER_PROGRAM_ID, wormhole: address.PRO_COMPATIBLE_WORMHOLE_PROGRAM_ID },
};

export const HERMES_URL = (process.env.HERMES_URL ?? "https://pyth.dourolabs.app/hermes").replace(/\/$/, "");

/** Hermes requests made by this process, by kind — reported so a plan can be sized. */
export const hermesStats = { since: Date.now(), updates: 0, failures: 0 };

const strip = (h) => h.replace(/^0x/, "").toLowerCase();

/**
 * The latest signed update for some feeds, plus Hermes' own parsed view of it.
 * One request covers every feed asked for.
 */
export async function fetchLatestUpdate(feedIds) {
  const key = process.env.PYTH_API_KEY;
  if (!key) throw new Error("PYTH_API_KEY is not set");
  const qs = feedIds.map((id) => `ids[]=${strip(id)}`).join("&");
  let res;
  try {
    res = await fetch(`${HERMES_URL}/v2/updates/price/latest?${qs}&encoding=base64&parsed=true`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    hermesStats.failures++;
    throw new Error(`Hermes request failed: ${e.name === "TimeoutError" ? "timed out" : e.message}`);
  }
  hermesStats.updates++;
  if (!res.ok) {
    hermesStats.failures++;
    // The body is Hermes' error text; the request (and its header) is not echoed.
    throw new Error(`Hermes answered ${res.status}: ${(await res.text().catch(() => "")).slice(0, 120)}`);
  }
  const body = await res.json();
  return {
    binary: body.binary.data, // base64 accumulator updates
    parsed: (body.parsed ?? []).map((p) => ({
      feedId: strip(p.id),
      price: Number(p.price.price) * 10 ** p.price.expo,
      conf: Number(p.price.conf) * 10 ** p.price.expo,
      publishTime: p.price.publish_time,
    })),
  };
}

function programs(connection, payer, which) {
  const ids = PYTH_PROGRAMS[which];
  const wallet = { publicKey: payer.publicKey, signTransaction: async (t) => t, signAllTransactions: async (t) => t };
  const provider = new anchor29.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return {
    ids,
    receiver: new anchor29.Program(RECEIVER_IDL, ids.receiver, provider),
    wormhole: new anchor29.Program(WORMHOLE_IDL, ids.wormhole, provider),
  };
}

/**
 * Instructions to post one Hermes update (any number of feeds) fully verified,
 * grouped into transactions in the order they must land, and the instructions
 * that close what was created. Each group lists the extra signers it needs.
 *
 * Returns { groups: [{ ixs, signers, cu }], close: [{ ixs, cu }], accounts: { feedId -> PublicKey }, encodedVaa }.
 */
export async function buildPostUpdate(connection, payer, updateBase64, which = "upgraded", { chunk = 800 } = {}) {
  const { ids, receiver, wormhole } = programs(connection, payer, which);
  const acc = parseAccumulatorUpdateData(Buffer.from(updateBase64, "base64"));
  const vaa = acc.vaa;
  const guardianSetIndex = vaa.readUInt32BE(1);
  const encoded = Keypair.generate();
  const groups = [];

  // 1. Create and initialise the encoded VAA account, sized for this VAA.
  groups.push({
    label: "create encoded VAA",
    signers: [encoded],
    cu: 60_000,
    ixs: [
      await wormhole.account.encodedVaa.createInstruction(encoded, vaa.length + VAA_START),
      await wormhole.methods.initEncodedVaa().accounts({ writeAuthority: payer.publicKey, encodedVaa: encoded.publicKey }).instruction(),
    ],
  });
  // 2. Write it in chunks, one transaction each: a transaction is 1232 bytes.
  for (let at = 0; at < vaa.length; at += chunk) {
    groups.push({
      label: `write VAA bytes ${at}..${Math.min(vaa.length, at + chunk)}`,
      signers: [],
      cu: 30_000,
      ixs: [await wormhole.methods.writeEncodedVaa({ data: vaa.subarray(at, at + chunk), index: at }).accounts({ writeAuthority: payer.publicKey, draftVaa: encoded.publicKey }).instruction()],
    });
  }
  // 3. Verify every guardian signature against the guardian set the VAA names.
  groups.push({
    label: `verify VAA (guardian set ${guardianSetIndex})`,
    signers: [],
    cu: 400_000,
    ixs: [
      await wormhole.methods
        .verifyEncodedVaaV1()
        .accounts({ writeAuthority: payer.publicKey, draftVaa: encoded.publicKey, guardianSet: address.getGuardianSetPda(guardianSetIndex, ids.wormhole) })
        .instruction(),
    ],
  });
  // 4. One PriceUpdateV2 account per feed in the update.
  const accounts = {};
  const treasuryId = 0;
  const close = [];
  for (const update of acc.updates) {
    const kp = Keypair.generate();
    const feedId = parsePriceFeedMessage(update.message).feedId.toString("hex");
    accounts[feedId] = kp.publicKey;
    groups.push({
      label: `post update ${feedId.slice(0, 8)}`,
      signers: [kp],
      cu: 80_000,
      ixs: [
        await receiver.methods
          .postUpdate({ merklePriceUpdate: update, treasuryId })
          .accounts({
            payer: payer.publicKey,
            encodedVaa: encoded.publicKey,
            config: address.getConfigPda(ids.receiver),
            treasury: address.getTreasuryPda(treasuryId, ids.receiver),
            priceUpdateAccount: kp.publicKey,
            systemProgram: SystemProgram.programId,
            writeAuthority: payer.publicKey,
          })
          .instruction(),
      ],
    });
    close.push({ label: `reclaim ${feedId.slice(0, 8)}`, cu: 20_000, ixs: [await receiver.methods.reclaimRent().accounts({ payer: payer.publicKey, priceUpdateAccount: kp.publicKey }).instruction()] });
  }
  close.unshift({ label: "close encoded VAA", cu: 20_000, ixs: [await wormhole.methods.closeEncodedVaa().accounts({ writeAuthority: payer.publicKey, encodedVaa: encoded.publicKey }).instruction()] });
  return { groups, close, accounts, encodedVaa: encoded.publicKey, guardianSetIndex, vaaBytes: vaa.length, which, ids };
}

/** PriceUpdateV2, read the way oracle::check_price reads it. */
export function readPriceUpdate(info) {
  const d = info.data;
  return {
    owner: info.owner.toBase58(),
    len: d.length,
    verification: d[40],
    feedId: Buffer.from(d.subarray(41, 73)).toString("hex"),
    price: Number(d.readBigInt64LE(73)) * 10 ** d.readInt32LE(89),
    conf: Number(d.readBigUInt64LE(81)) * 10 ** d.readInt32LE(89),
    publishTime: Number(d.readBigInt64LE(93)),
    lamports: info.lamports,
  };
}
