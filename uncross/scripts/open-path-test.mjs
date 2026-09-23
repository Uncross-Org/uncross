// A stranger opens an auction on a dormant ticker and trades in it, from one
// faucet grant and nothing else.
//
//   1. a wallet that has never existed asks the faucet for tokens
//   2. it asks the faucet to open an auction on a ticker nobody is running
//   3. it places an order in that auction, signed and paid for by itself
//   4. the chain confirms the order is in the book, that deploy paid the
//      auction's rent, and what the visitor actually spent
//
// Anything that needs a human is a failure.
//   RPC_URLS=... node scripts/open-path-test.mjs --faucet http://localhost:8099 --ticker QQQx
import anchor from "@coral-xyz/anchor";
import fs from "node:fs";
import { loadFixture, loadIdl, makeConnection, decodeAuction, orderPda, tickerAta, quoteAta, vaultTickerAta, vaultQuoteAta, sendV0, loadKeypair, TICKER_PROGRAM, QUOTE_PROGRAM } from "./lib.mjs";
const { Keypair, PublicKey, SystemProgram } = anchor.web3;
const BN = anchor.BN;
const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };
const FAUCET = arg("faucet", "http://localhost:8099");
const TICKER = arg("ticker", "QQQx");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (name, ok, detail) => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) { console.log("\nOPEN PATH: FAIL"); process.exit(1); } };

const connection = makeConnection();
const fx = loadFixture();
const universe = JSON.parse(fs.readFileSync(new URL("./universe.json", import.meta.url), "utf8")).tickers;
const tk = universe.find((t) => t.symbol === TICKER);
step(`${TICKER} is listed and dormant`, !!tk && !tk.active, tk ? `devnet mint ${tk.devnetMint}` : "not in universe.json");
const mint = new PublicKey(tk.devnetMint), quoteMint = new PublicKey(fx.quoteMint);
const user = Keypair.generate();
const deploy = loadKeypair("deploy").publicKey;
console.log(`fresh wallet ${user.publicKey.toBase58()}`);

// 1. faucet
const g = await (await fetch(`${FAUCET}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey: user.publicKey.toBase58(), ticker: TICKER }) })).json();
step("faucet granted", !!g.ok, g.ok ? `${g.granted.sol} SOL, ${g.granted.tickers.join("+")}` : g.error);
step(`the grant includes ${TICKER}`, g.granted.tickers.includes(TICKER));
let solAfterGrant = 0;
for (let i = 0; i < 20 && !solAfterGrant; i++) { solAfterGrant = await connection.getBalance(user.publicKey, "confirmed"); if (!solAfterGrant) await sleep(1500); }

// 2. open
const deployBefore = await connection.getBalance(deploy, "confirmed");
const o = await (await fetch(`${FAUCET}/auction/open`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pubkey: user.publicKey.toBase58(), ticker: TICKER }) })).json();
step("the faucet opened an auction", !!o.ok && !!o.auction, o.ok ? `${o.auction} slots ${o.openSlot}..${o.closeSlot}${o.existing ? " (already running)" : ""}` : o.error);
const auction = new PublicKey(o.auction);
let info = null;
for (let i = 0; i < 20 && !info; i++) { info = await connection.getAccountInfo(auction, "confirmed"); if (!info) await sleep(1500); }
const a0 = decodeAuction(info.data);
step("the auction's recorded payer is deploy, not the visitor", a0.hasPayer && a0.payer.equals(deploy), `payer ${a0.payer?.toBase58?.()}`);
const deployAfterOpen = await connection.getBalance(deploy, "confirmed");

// 3. order, signed and paid for by the visitor alone
const program = new anchor.Program(loadIdl(), new anchor.AnchorProvider(connection, new anchor.Wallet(user), { commitment: "confirmed" }));
const ID = program.programId;
const idx = a0.orderCount;
const price = 100_000_000n, qty = 50_000_000n; // $100 limit, 0.5 shares — any price; nothing else is in this book
const ix = await program.methods
  .placeOrder({ buy: {} }, new BN(price.toString()), new BN(qty.toString()), idx)
  .accountsStrict({
    owner: user.publicKey, auction, order: orderPda(ID, auction, idx),
    vaultTicker: vaultTickerAta(auction, mint), vaultQuote: vaultQuoteAta(auction, quoteMint),
    ownerTickerAta: tickerAta(user.publicKey, mint), ownerQuoteAta: quoteAta(user.publicKey, quoteMint),
    tickerMint: mint, quoteMint, tickerTokenProgram: TICKER_PROGRAM, quoteTokenProgram: QUOTE_PROGRAM, systemProgram: SystemProgram.programId,
  })
  .instruction();
let sig = null;
try { sig = (await sendV0(connection, user, [], [ix])).sig; } catch (e) { step("order placed by the visitor's own wallet", false, (e.logs ?? []).find((l) => /Error/.test(l)) ?? e.message); }
step("order placed by the visitor's own wallet", !!sig, sig);

// 4. on chain
const a1 = decodeAuction((await connection.getAccountInfo(auction, "confirmed")).data);
step("the order is in the book", a1.orderCount === idx + 1, `${a1.orderCount} order(s)`);
const solEnd = await connection.getBalance(user.publicKey, "confirmed");
console.log(`\nvisitor SOL: granted ${(solAfterGrant / 1e9).toFixed(6)}, left ${(solEnd / 1e9).toFixed(6)}, spent ${((solAfterGrant - solEnd) / 1e9).toFixed(6)} (order rent + fee)`);
console.log(`deploy paid to open: ${((deployBefore - deployAfterOpen) / 1e9).toFixed(6)} SOL`);
console.log(`\nOPEN PATH: PASS — auction ${o.auction} closes at slot ${o.closeSlot}`);
fs.writeFileSync("/tmp/open-path-auction.txt", `${o.auction}\n${o.closeSlot}\n`);
process.exit(0);
