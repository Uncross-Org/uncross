// Places a handful of orders into each open devnet auction so the venue has a
// realistic book and history. Prices sit around the real-world reference:
// Pyth's mainnet AAPL price, and IBMx's Jupiter price (IBM has no Pyth feed on
// Solana). Orders come from the 42 test owners of devnet-multibatch.mjs; this
// mints fixture tokens and tops up SOL for them as needed. Devnet only.
//
//   node scripts/devnet-activity.mjs          one pass
//   node scripts/devnet-activity.mjs --loop   every 60s
import anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
} from "@solana/spl-token";
import {
  loadKeypair,
  loadKeypairArray,
  loadFixture,
  loadTickers,
  getProgram,
  decodeAuction,
  orderPda,
  tickerAta,
  quoteAta,
  vaultTickerAta,
  vaultQuoteAta,
  getAccountsBatched,
  tokenAmountOf,
  sendV0,
  withRetry,
  sleep,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "./lib.mjs";
import { listAuctions as listAuctionsIndexed } from "./auction-index.mjs";

const { BN } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const deploy = loadKeypair("deploy"); // mint authority + fee payer
const funder = loadKeypair("wallet2"); // SOL and ATA rent for owners
const fx = loadFixture();
const { program, connection } = getProgram(deploy);
const ID = program.programId;
// Via the shared loader so the owners can come from KEYPAIR_MB_OWNERS on a
// host with no ~/.config/solana.
const owners = loadKeypairArray("mb-owners");
const mainnet = new Connection("https://api.mainnet-beta.solana.com", "confirmed");
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Reference prices for seeding: Pyth's live mainnet account where one exists,
// otherwise the real token's Jupiter price. Either way the orders are ours,
// priced around a reference — the site says so beside every cross.
async function pythPrice(account) {
  const i = await withRetry(() => mainnet.getAccountInfo(new PublicKey(account)));
  return Number(i.data.readBigInt64LE(73)) * 10 ** i.data.readInt32LE(89);
}

async function jupiterPrice(mint) {
  const res = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`).then((r) => r.json());
  return res.find((t) => t.id === mint)?.usdPrice;
}

const TICKERS = loadTickers().tickers.map((t) => ({
  symbol: t.symbol,
  mint: new PublicKey(t.devnetMint),
  ref: t.pythAccount ? () => pythPrice(t.pythAccount) : () => jupiterPrice(t.mainnetMint),
}));

async function multiplier(mint) {
  const info = (await withRetry(() => connection.getParsedAccountInfo(mint))).value.data.parsed.info;
  const cfg = info.extensions?.find((e) => e.extension === "scaledUiAmountConfig")?.state;
  if (!cfg) return 1;
  return Date.now() / 1000 >= cfg.newMultiplierEffectiveTimestamp ? Number(cfg.newMultiplier) : Number(cfg.multiplier);
}

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

async function fundOwner(owner, mint, side, rawQty, escrow) {
  const [sol, t, q] = await getAccountsBatched(connection, [owner.publicKey, tickerAta(owner.publicKey, mint), quoteAta(owner.publicKey, fx.quoteMint)]);
  const ixs = [];
  if ((sol?.lamports ?? 0) < 0.003 * LAMPORTS_PER_SOL) {
    ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: 0.01 * LAMPORTS_PER_SOL }));
  }
  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, tickerAta(owner.publicKey, mint), owner.publicKey, mint, TICKER_PROGRAM, ASSOCIATED_TOKEN_PROGRAM),
    createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, quoteAta(owner.publicKey, fx.quoteMint), owner.publicKey, fx.quoteMint, QUOTE_PROGRAM, ASSOCIATED_TOKEN_PROGRAM),
  );
  if (side === "sell" && tokenAmountOf(t) < rawQty) {
    ixs.push(createMintToCheckedInstruction(mint, tickerAta(owner.publicKey, mint), deploy.publicKey, rawQty * 2n, 8, [], TICKER_PROGRAM));
  }
  if (side === "buy" && tokenAmountOf(q) < escrow) {
    ixs.push(createMintToCheckedInstruction(fx.quoteMint, quoteAta(owner.publicKey, fx.quoteMint), deploy.publicKey, escrow * 2n, 6, [], QUOTE_PROGRAM));
  }
  await sendV0(connection, funder, [deploy], ixs, { cuLimit: 200_000 });
}

async function seed(tk) {
  const slot = await withRetry(() => connection.getSlot("confirmed"));
  // Shared index read, not getProgramAccounts: that method is rate-limited
  // into uselessness on the public devnet endpoint with several consumers on
  // one address. See scripts/auction-index.mjs.
  const open = (await listAuctionsIndexed(connection, ID, tk.mint)).find(
    (a) => a.status === "open" && slot < a.closeSlot - a.freezeSlots - 60 && slot >= a.openSlot,
  );
  if (!open || open.orderCount >= 6) return;

  const ref = await tk.ref();
  if (!ref) return log(`${tk.symbol}: no reference price, skipping`);
  const m = await multiplier(tk.mint);
  const n = 4 + Math.floor(Math.random() * 4);
  log(`${tk.symbol}: seeding ${n} orders into ${open.pubkey.toBase58()} around $${ref.toFixed(2)}/share`);

  for (let k = 0; k < n; k++) {
    const side = k % 2 === 0 ? "buy" : "sell";
    const perShare = ref * (1 + 0.006 * gauss() + (side === "buy" ? 0.002 : -0.002));
    const shares = Math.max(0.2, Math.round((0.3 + Math.random() * 2.7) * 100) / 100);
    const price = BigInt(Math.round(perShare * m * 1e6));
    const qty = BigInt(Math.round((shares / m) * 1e8));
    const escrow = (qty * price + 99_999_999n) / 100_000_000n;
    const owner = owners[Math.floor(Math.random() * owners.length)];
    await fundOwner(owner, tk.mint, side, qty, escrow);

    const idx = decodeAuction((await withRetry(() => connection.getAccountInfo(open.pubkey, "confirmed"))).data).orderCount;
    const ix = await program.methods
      .placeOrder(side === "buy" ? { buy: {} } : { sell: {} }, new BN(price.toString()), new BN(qty.toString()), idx)
      .accountsStrict({
        owner: owner.publicKey,
        auction: open.pubkey,
        order: orderPda(ID, open.pubkey, idx),
        vaultTicker: vaultTickerAta(open.pubkey, tk.mint),
        vaultQuote: vaultQuoteAta(open.pubkey, fx.quoteMint),
        ownerTickerAta: tickerAta(owner.publicKey, tk.mint),
        ownerQuoteAta: quoteAta(owner.publicKey, fx.quoteMint),
        tickerMint: tk.mint,
        quoteMint: fx.quoteMint,
        tickerTokenProgram: TICKER_PROGRAM,
        quoteTokenProgram: QUOTE_PROGRAM,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    try {
      await sendV0(connection, deploy, [owner], [ix]);
      log(`  ${side} ${shares} @ $${perShare.toFixed(2)}`);
    } catch (e) {
      log(`  order failed: ${(e.logs ?? []).find((l) => l.includes("Error Code")) ?? e.message}`);
    }
  }
}

do {
  for (const tk of TICKERS) {
    try {
      await seed(tk);
    } catch (e) {
      log(`${tk.symbol}: ${e.message}`);
    }
  }
  if (process.argv.includes("--loop")) await sleep(60_000);
} while (process.argv.includes("--loop"));
