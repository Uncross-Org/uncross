import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import BN from "bn.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idl from "../idl/uncross.json";
import { orderPda, type Auction, type Side } from "./auction";
import type { OrderAccount } from "./order";

export const tickerAta = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_2022_PROGRAM_ID);
export const quoteAta = (owner: PublicKey, mint: PublicKey) => getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID);

const programCache = new WeakMap<Connection, Program>();
/** Anchor Program used only to encode instructions (never to fetch Auction). */
export function getProgram(conn: Connection): Program {
  let p = programCache.get(conn);
  if (!p) {
    const readonlyWallet = {
      publicKey: PublicKey.default,
      signTransaction: async () => {
        throw new Error("read-only");
      },
      signAllTransactions: async () => {
        throw new Error("read-only");
      },
    };
    const provider = new AnchorProvider(conn, readonlyWallet as never, { commitment: "confirmed" });
    p = new Program(idl as Idl, provider);
    programCache.set(conn, p);
  }
  return p;
}

const common = (a: Auction) => ({
  auction: a.address,
  vaultTicker: a.vaultTicker,
  vaultQuote: a.vaultQuote,
  tickerMint: a.tickerMint,
  quoteMint: a.quoteMint,
  tickerTokenProgram: a.tickerTokenProgram,
  quoteTokenProgram: a.quoteTokenProgram,
});

export async function placeOrderIxs(
  program: Program,
  a: Auction,
  owner: PublicKey,
  side: Side,
  limitPrice: bigint,
  quantity: bigint,
  orderIndex: number,
): Promise<TransactionInstruction[]> {
  const tAta = getAssociatedTokenAddressSync(a.tickerMint, owner, true, a.tickerTokenProgram);
  const qAta = getAssociatedTokenAddressSync(a.quoteMint, owner, true, a.quoteTokenProgram);
  const ix = await program.methods
    .placeOrder(side === "buy" ? { buy: {} } : { sell: {} }, new BN(limitPrice.toString()), new BN(quantity.toString()), orderIndex)
    .accountsStrict({
      owner,
      order: orderPda(program.programId, a.address, orderIndex),
      ownerTickerAta: tAta,
      ownerQuoteAta: qAta,
      systemProgram: SystemProgram.programId,
      ...common(a),
    })
    .instruction();
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, tAta, owner, a.tickerMint, a.tickerTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID),
    createAssociatedTokenAccountIdempotentInstruction(owner, qAta, owner, a.quoteMint, a.quoteTokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID),
    ix,
  ];
}

export async function cancelOrderIx(program: Program, a: Auction, owner: PublicKey, orderIndex: number) {
  return program.methods
    .cancelOrder()
    .accountsStrict({
      owner,
      order: orderPda(program.programId, a.address, orderIndex),
      ownerTickerAta: getAssociatedTokenAddressSync(a.tickerMint, owner, true, a.tickerTokenProgram),
      ownerQuoteAta: getAssociatedTokenAddressSync(a.quoteMint, owner, true, a.quoteTokenProgram),
      ...common(a),
    })
    .instruction();
}

/** pythFeed: the ticker's PriceUpdateV2 account, or null → SystemProgram ("no oracle"). */
export async function computeClearingIx(program: Program, a: Auction, caller: PublicKey, pythFeed: string | null) {
  return program.methods
    .computeClearing()
    .accountsStrict({
      caller,
      auction: a.address,
      tickerMint: a.tickerMint,
      pythPriceFeed: pythFeed ? new PublicKey(pythFeed) : SystemProgram.programId,
    })
    .instruction();
}

export async function settleIx(program: Program, a: Auction, caller: PublicKey, orders: OrderAccount[], mode: "settle" | "refund") {
  const indices = orders.map((o) => o.orderIndex);
  const remaining = orders.flatMap((o) => [
    { pubkey: o.address, isWritable: true, isSigner: false },
    { pubkey: getAssociatedTokenAddressSync(a.tickerMint, o.owner, true, a.tickerTokenProgram), isWritable: true, isSigner: false },
    { pubkey: getAssociatedTokenAddressSync(a.quoteMint, o.owner, true, a.quoteTokenProgram), isWritable: true, isSigner: false },
  ]);
  const m = mode === "refund" ? program.methods.cancelAndRefund(indices) : program.methods.settleBatch(indices);
  return m
    .accountsStrict({ caller, ...common(a) })
    .remainingAccounts(remaining)
    .instruction();
}

// ---------------------------------------------------------------- sending

export class TxError extends Error {
  logs?: string[];
  code?: string;
  constructor(message: string, logs?: string[], code?: string) {
    super(message);
    this.logs = logs;
    this.code = code;
  }
}

const FRIENDLY: Record<string, string> = {
  OrderIndexMismatch: "Someone placed an order at the same moment. Please try again.",
  OutsideOpenWindow: "The order window is closed for this auction.",
  AuctionNotOpen: "This auction is no longer accepting orders.",
  OrderBookFull: "This auction's book is full (64 orders).",
  PastFreezeWindow: "Cancellations are closed during the freeze window.",
  AlreadyCancelled: "This order is already cancelled.",
  AlreadySettled: "This order is already settled.",
  AuctionNotClosed: "The auction window hasn't closed yet.",
  NotYetCleared: "Run the cross before settling.",
  SettlementPathLocked: "This auction is already being settled another way.",
  ZeroQuantity: "Quantity is too small.",
  ZeroPrice: "Enter a price above zero.",
};

function explain(logs: string[] | null | undefined, err: unknown): TxError {
  const l = logs ?? [];
  const code = l.map((x) => x.match(/Error Code: (\w+)/)?.[1]).find(Boolean);
  if (code) return new TxError(FRIENDLY[code] ?? code, l, code);
  const joined = l.join("\n");
  if (/insufficient funds|insufficient lamports/i.test(joined)) return new TxError("Insufficient balance for this order (tokens or SOL for fees).", l, "Insufficient");
  if (/paused/i.test(joined)) return new TxError("This token is currently paused by its issuer. Try again when it resumes.", l, "Paused");
  if (/already in use/i.test(joined)) return new TxError("Someone placed an order at the same moment. Please try again.", l, "OrderIndexMismatch");
  return new TxError(`Transaction failed: ${typeof err === "string" ? err : JSON.stringify(err)}`, l);
}

export function errorMessage(e: unknown): string {
  if (e instanceof TxError) return e.message;
  const msg = e instanceof Error ? e.message : String(e);
  if (/reject|declined|cancel/i.test(msg)) return "Cancelled in wallet.";
  return msg;
}

type Wallet = Pick<WalletContextState, "publicKey" | "sendTransaction" | "signAllTransactions">;

async function buildTx(conn: Connection, payer: PublicKey, ixs: TransactionInstruction[], cuLimit: number) {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: cuLimit }), ...ixs],
  }).compileToV0Message();
  return { tx: new VersionedTransaction(msg), blockhash, lastValidBlockHeight };
}

async function simulate(conn: Connection, tx: VersionedTransaction) {
  const sim = await conn.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: true, commitment: "confirmed" });
  if (sim.value.err) throw explain(sim.value.logs, sim.value.err);
}

// Confirms over plain HTTP. web3.js's confirmTransaction races a websocket
// against its own polling; on a rate-limited public RPC that can report a
// landed transaction as failed, and the mainnet proxy has no websocket at all.
async function confirmByPolling(conn: Connection, sig: string, lastValidBlockHeight: number): Promise<void> {
  for (;;) {
    const { value } = await conn.getSignatureStatuses([sig]);
    const st = value[0];
    if (st?.err) throw new TxError(`Transaction failed on-chain (${sig.slice(0, 8)}…)`);
    if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return;
    if ((await conn.getBlockHeight("confirmed")) > lastValidBlockHeight) {
      throw new TxError("The transaction expired before it landed. Please try again.");
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
}

/** v0 transaction + compute budget, simulated first (for readable errors), then signed by the wallet. */
export async function sendIxs(conn: Connection, wallet: Wallet, ixs: TransactionInstruction[], cuLimit = 400_000): Promise<string> {
  if (!wallet.publicKey) throw new Error("Connect a wallet first.");
  const { tx, lastValidBlockHeight } = await buildTx(conn, wallet.publicKey, ixs, cuLimit);
  await simulate(conn, tx);
  const sig = await wallet.sendTransaction(tx, conn, { skipPreflight: true, maxRetries: 3 });
  await confirmByPolling(conn, sig, lastValidBlockHeight);
  return sig;
}

/** Several transactions approved in one wallet prompt when supported, else one by one. */
export async function sendMany(conn: Connection, wallet: Wallet, groups: TransactionInstruction[][], cuLimit: number): Promise<string[]> {
  if (!wallet.publicKey) throw new Error("Connect a wallet first.");
  if (!wallet.signAllTransactions || groups.length === 1) {
    const out: string[] = [];
    for (const g of groups) out.push(await sendIxs(conn, wallet, g, cuLimit));
    return out;
  }
  const built = await Promise.all(groups.map((g) => buildTx(conn, wallet.publicKey!, g, cuLimit)));
  for (const b of built) await simulate(conn, b.tx);
  const signed = await wallet.signAllTransactions(built.map((b) => b.tx));
  const sigs: string[] = [];
  for (let i = 0; i < signed.length; i++) {
    const sig = await conn.sendRawTransaction(signed[i].serialize(), { skipPreflight: true, maxRetries: 3 });
    await confirmByPolling(conn, sig, built[i].lastValidBlockHeight);
    sigs.push(sig);
  }
  return sigs;
}
