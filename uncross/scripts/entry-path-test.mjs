// The whole entry path, as a stranger experiences it, with no help from us.
//
// Makes a wallet that has never existed before, asks the faucet for tokens over
// HTTP exactly as the dashboard does, then places a real order into the live
// auction signing and paying for itself — no co-signer, no keeper, no funder.
// Finally it reads the auction back from chain and checks the order is in the
// book. Anything that needs a human is a failure, and it says so.
//
//   node scripts/entry-path-test.mjs --faucet http://localhost:8099 --ticker AAPLx

import anchor from "@coral-xyz/anchor";
import {
  loadTickers,
  loadFixture,
  loadIdl,
  makeConnection,
  decodeAuction,
  orderPda,
  tickerAta,
  quoteAta,
  vaultTickerAta,
  vaultQuoteAta,
  sendV0,
  getAccountsBatched,
  tokenAmountOf,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "./lib.mjs";
import { listAuctions as listAuctionsIndexed } from "./auction-index.mjs";

const { BN } = anchor;
const { Keypair, PublicKey, SystemProgram } = anchor.web3;

const opt = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const FAUCET = opt("faucet", "http://localhost:8099");
const SYMBOL = opt("ticker", "AAPLx");
const SIDE = opt("side", "buy");

const steps = [];
const step = (name, ok, detail) => {
  steps.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) {
    console.log("\nENTRY PATH: FAIL");
    process.exit(1);
  }
};

const connection = makeConnection();
const fx = loadFixture();
const tk = loadTickers().tickers.find((t) => t.symbol === SYMBOL);
if (!tk) throw new Error(`unknown ticker ${SYMBOL}`);
const mint = new PublicKey(tk.devnetMint);
const quoteMint = new PublicKey(fx.quoteMint);

// 1. A wallet nobody has ever seen.
const user = Keypair.generate();
console.log(`fresh wallet ${user.publicKey.toBase58()}\nfaucet ${FAUCET}\nticker ${SYMBOL}\n`);

// 2. Ask the faucet, over HTTP, exactly as the browser does.
const t0 = Date.now();
let res, body;
try {
  res = await fetch(`${FAUCET}/faucet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pubkey: user.publicKey.toBase58(), ticker: SYMBOL }),
  });
  body = await res.json();
} catch (e) {
  step("faucet reachable", false, e.message);
}
step("faucet responded", res.ok, `${res.status} ${body?.signature ? body.signature.slice(0, 16) + "…" : JSON.stringify(body).slice(0, 120)}`);

// 3. The wallet really holds what it was promised.
const [sol, tAcc, qAcc] = await getAccountsBatched(connection, [
  user.publicKey,
  tickerAta(user.publicKey, mint),
  quoteAta(user.publicKey, quoteMint),
]);
const solBal = (sol?.lamports ?? 0) / 1e9;
const shares = Number(tokenAmountOf(tAcc)) / 1e8;
const quote = Number(tokenAmountOf(qAcc)) / 1e6;
step("wallet has SOL", solBal > 0.005, `${solBal} SOL`);
step("wallet has shares", shares > 0, `${shares} ${SYMBOL}`);
step("wallet has quote", quote > 0, `${quote} fixture USDC`);

// 4. A live auction to join.
const slot = await connection.getSlot("confirmed");
const auctions = await listAuctionsIndexed(connection, new PublicKey(loadIdl().address ?? tk.programId ?? ""), mint).catch(() => null);
const program = new anchor.Program(loadIdl(), new anchor.AnchorProvider(connection, new anchor.Wallet(user), { commitment: "confirmed" }));
const ID = program.programId;
const list = auctions ?? (await listAuctionsIndexed(connection, ID, mint));
const open = list.find((a) => a.status === "open" && slot < a.closeSlot - a.freezeSlots - 30 && slot >= a.openSlot);
step("an auction is open and accepting orders", !!open, open ? `${open.pubkey.toBase58()} closes in ${open.closeSlot - slot} slots` : "none taking orders right now");

// 5. Place the order: signed and paid for by the stranger alone.
const fresh = decodeAuction((await connection.getAccountInfo(open.pubkey, "confirmed")).data);
const idx = fresh.orderCount;
const refPrice = Number(fresh.indicativePrice) > 0 ? Number(fresh.indicativePrice) : 300_000_000;
const perShare = SIDE === "buy" ? refPrice * 1.01 : refPrice * 0.99;
const price = BigInt(Math.round(perShare));
const qty = BigInt(Math.round(0.5 * 1e8));
const escrow = (qty * price + 99_999_999n) / 100_000_000n;

const ix = await program.methods
  .placeOrder(SIDE === "buy" ? { buy: {} } : { sell: {} }, new BN(price.toString()), new BN(qty.toString()), idx)
  .accountsStrict({
    owner: user.publicKey,
    auction: open.pubkey,
    order: orderPda(ID, open.pubkey, idx),
    vaultTicker: vaultTickerAta(open.pubkey, mint),
    vaultQuote: vaultQuoteAta(open.pubkey, quoteMint),
    ownerTickerAta: tickerAta(user.publicKey, mint),
    ownerQuoteAta: quoteAta(user.publicKey, quoteMint),
    tickerMint: mint,
    quoteMint,
    tickerTokenProgram: TICKER_PROGRAM,
    quoteTokenProgram: QUOTE_PROGRAM,
    systemProgram: SystemProgram.programId,
  })
  .instruction();

let sig = null;
try {
  // payer = the user, signers = the user. Nobody else touches this.
  const r = await sendV0(connection, user, [], [ix]);
  sig = r.sig;
} catch (e) {
  step("order placed by the wallet itself", false, (e.logs ?? []).find((l) => l.includes("Error")) ?? e.message);
}
step("order placed by the wallet itself", !!sig, sig);

// 6. It is really in the book.
const after = decodeAuction((await connection.getAccountInfo(open.pubkey, "confirmed")).data);
const mineInBook = after.orders?.some?.((o) => o.active && !o.cancelled) ?? after.orderCount > fresh.orderCount;
step("order is in the book on chain", after.orderCount > fresh.orderCount && mineInBook, `orderCount ${fresh.orderCount} → ${after.orderCount}`);

console.log(`\nENTRY PATH: PASS — ${((Date.now() - t0) / 1000).toFixed(1)}s from empty wallet to order in the book`);
console.log(`wallet ${user.publicKey.toBase58()}`);
console.log(`auction ${open.pubkey.toBase58()}`);
