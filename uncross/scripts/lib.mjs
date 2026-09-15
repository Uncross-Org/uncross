import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

const { AnchorProvider, Program, Wallet, BN } = anchor;
const { Connection, Keypair, PublicKey } = anchor.web3;

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..");

export function loadKeypair(name) {
  const p = path.join(os.homedir(), ".config/solana/uncross", `${name}.json`);
  const secret = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}

export function loadFixture() {
  const p = path.join(PROJECT_ROOT, "scripts/devnet-fixture.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return {
    tickerMint: new PublicKey(raw.tickerMint),
    quoteMint: new PublicKey(raw.quoteMint),
    deployTickerAta: new PublicKey(raw.deployTickerAta),
    deployQuoteAta: new PublicKey(raw.deployQuoteAta),
    wallet2QuoteAta: new PublicKey(raw.wallet2QuoteAta),
    wallet2TickerAta: new PublicKey(raw.wallet2TickerAta),
  };
}

export function loadIdl() {
  const p = path.join(PROJECT_ROOT, "target/idl/uncross.json");
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

export function getProgram(payerKeypair) {
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed",
  );
  const wallet = new Wallet(payerKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  const program = new Program(idl, provider);
  return { program, connection, provider };
}

export function auctionPda(programId, tickerMint, openSlot) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("auction"),
      tickerMint.toBuffer(),
      new BN(openSlot).toArrayLike(Buffer, "le", 8),
    ],
    programId,
  );
  return pda;
}

export function orderPda(programId, auction, orderIndex) {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("order"),
      auction.toBuffer(),
      new BN(orderIndex).toArrayLike(Buffer, "le", 2),
    ],
    programId,
  );
  return pda;
}

export function vaultTickerAta(auction, tickerMint) {
  return getAssociatedTokenAddressSync(
    tickerMint,
    auction,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
}

export function vaultQuoteAta(auction, quoteMint) {
  return getAssociatedTokenAddressSync(
    quoteMint,
    auction,
    true,
    TOKEN_PROGRAM_ID,
  );
}

export const TICKER_PROGRAM = TOKEN_2022_PROGRAM_ID;
export const QUOTE_PROGRAM = TOKEN_PROGRAM_ID;

export function log(label, value) {
  console.log(`${label}:`, value);
}

export async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
