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
  rpcStatsLine,
  tokenAccountRent,
  isInsufficientFunds,
  FEE_ALLOWANCE_LAMPORTS,
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
// A bare fetch to a public RPC has no default timeout: on at least one host
// (Railway) a request to api.mainnet-beta.solana.com never resolved or
// rejected, so the bot sat silent indefinitely rather than retrying or
// logging an error. Every mainnet call now goes through a fetch that aborts
// at 10s (which withRetry treats as retryable) and rotates across a short
// list of public endpoints, the way the site's MAINNET_READ_RPCS already does.
const MAINNET_RPCS = ["https://api.mainnet-beta.solana.com", "https://solana-rpc.publicnode.com"];
const timeoutFetch = (url, opts) => fetch(url, { ...opts, signal: AbortSignal.timeout(10_000) });
const mainnetConns = MAINNET_RPCS.map((u) => new Connection(u, { commitment: "confirmed", fetch: timeoutFetch }));
let mainnetIdx = 0;
async function mainnetCall(fn) {
  let last;
  for (let k = 0; k < mainnetConns.length; k++) {
    const i = (mainnetIdx + k) % mainnetConns.length;
    try {
      const r = await fn(mainnetConns[i]);
      mainnetIdx = i;
      return r;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}
const log = (...a) => console.log(new Date().toISOString(), ...a);

// Reference prices for seeding: Pyth's live mainnet account where one exists,
// otherwise the real token's Jupiter price. Either way the orders are ours,
// priced around a reference — the site says so beside every cross.
async function pythPrice(account) {
  const i = await withRetry(() => mainnetCall((c) => c.getAccountInfo(new PublicKey(account))));
  return Number(i.data.readBigInt64LE(73)) * 10 ** i.data.readInt32LE(89);
}

async function jupiterPrice(mint) {
  const res = await withRetry(() =>
    fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()),
  );
  return res.find((t) => t.id === mint)?.usdPrice;
}

// Throttles. Every order leaves an Order account on chain whose rent never
// comes back (the program closes auctions, not orders), so seeding is the one
// standing cost of the venue. --tickers limits which books are seeded,
// --orders the count per auction (a range, "2-3", or a single number).
const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ONLY_TICKERS = opt("tickers", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const [ORDERS_MIN, ORDERS_MAX] = opt("orders", "4-7")
  .split("-")
  .map(Number)
  .reduce((r, n) => (r.length ? [r[0], n] : [n, n]), []);
// Auctions this bot must not touch. The community event's whole claim is that
// real people filled that book, and it is false the moment this bot puts an
// order in it. Set SKIP_AUCTIONS (or --skip-auctions) to the event auction's
// address. It needs no undoing: the exclusion stops mattering once that
// auction closes.
const SKIP_AUCTIONS = new Set(
  (process.env.SKIP_AUCTIONS ?? opt("skip-auctions", "") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
// The same exclusion, one level up, and the one that actually holds.
// SKIP_AUCTIONS can only be set once the auction exists and its address is
// known — which leaves a gap between opening the event book and the setting
// taking effect, and this bot seeds a new book within a minute. A ticker needs
// no address, so this can be set well beforehand: nothing this bot does can
// reach either event book, whatever the timing. SKIP_AUCTIONS stays as the
// narrower backstop.
const SKIP_TICKERS = new Set(
  (process.env.SKIP_TICKERS ?? opt("skip-tickers", "") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

const TICKERS = loadTickers()
  .tickers.filter((t) => (ONLY_TICKERS.length === 0 || ONLY_TICKERS.includes(t.symbol)) && !SKIP_TICKERS.has(t.symbol))
  .map((t) => ({
    symbol: t.symbol,
    mint: new PublicKey(t.devnetMint),
    ref: t.pythAccount ? () => pythPrice(t.pythAccount) : () => jupiterPrice(t.mainnetMint),
  }));

// Printed at startup so the exclusion is checkable from the logs. An exclusion
// you cannot see is one you are trusting rather than verifying, and this one
// carries the event's central claim.
log(`seeding ${TICKERS.map((t) => t.symbol).join(",") || "(nothing)"}`);
if (SKIP_TICKERS.size) log(`leaving ${[...SKIP_TICKERS].join(",")} to real participants`);

async function multiplier(mint) {
  const info = (await withRetry(() => connection.getParsedAccountInfo(mint))).value.data.parsed.info;
  const cfg = info.extensions?.find((e) => e.extension === "scaledUiAmountConfig")?.state;
  if (!cfg) return 1;
  return Date.now() / 1000 >= cfg.newMultiplierEffectiveTimestamp ? Number(cfg.newMultiplier) : Number(cfg.multiplier);
}

// ---------------------------------------------------------------- can it pay?
//
// Two wallets pay for every seeded order: wallet2 (the funder) tops up the
// owner's SOL and creates its token accounts, and deploy pays the order's
// transaction fee. When wallet2 ran dry the bot kept going, every order failed
// in simulation with InsufficientFundsForRent, and the log said only
// "simulation failed" once per ticker — every book sat empty with nothing to
// say why. Now each wallet's real balance is read before a pass and before each
// order, against what that order costs, and an empty wallet pauses seeding
// with one line naming the wallet, its balance and what it needs.

/** SOL sent to an owner that is running low, so it can pay its order's rent. */
const OWNER_TOPUP_LAMPORTS = 0.01 * LAMPORTS_PER_SOL;
const OWNER_LOW_LAMPORTS = 0.003 * LAMPORTS_PER_SOL;

class CannotPay extends Error {
  constructor(who, kp, have, need) {
    super(`${who} ${kp.publicKey.toBase58()} holds ${have / LAMPORTS_PER_SOL} SOL; one order needs up to ${need / LAMPORTS_PER_SOL} SOL`);
    this.who = who;
  }
}

/** The most one order can cost the funder: a top-up, both token accounts, the fee. */
async function worstOrderLamports(mint) {
  const [t, q] = await Promise.all([tokenAccountRent(connection, mint, TICKER_PROGRAM), tokenAccountRent(connection, fx.quoteMint, QUOTE_PROGRAM)]);
  return OWNER_TOPUP_LAMPORTS + t + q + FEE_ALLOWANCE_LAMPORTS;
}

let paused = null; // the reason seeding is paused, or null
let pausedPasses = 0;
function pause(reason) {
  // Said when it starts and then every tenth pass (~10 minutes), so it is in
  // any recent window of the logs, without repeating every minute.
  if (paused !== reason || pausedPasses % 10 === 0) log(`PAUSED — not seeding: ${reason}. Every book stays empty until it is topped up.`);
  paused = reason;
  pausedPasses++;
}
function resume() {
  if (paused) log("resumed — the paying wallets can cover an order again");
  paused = null;
  pausedPasses = 0;
}

/** Can both paying wallets cover one more order on the costliest ticker? Null if so, else why not. */
async function cannotPayReason() {
  const worst = Math.max(...(await Promise.all(TICKERS.map((t) => worstOrderLamports(t.mint)))));
  const [f, d] = await Promise.all([withRetry(() => connection.getBalance(funder.publicKey, "confirmed")), withRetry(() => connection.getBalance(deploy.publicKey, "confirmed"))]);
  if (f < worst) return new CannotPay("funder wallet2", funder, f, worst).message;
  if (d < FEE_ALLOWANCE_LAMPORTS) return new CannotPay("fee payer deploy", deploy, d, FEE_ALLOWANCE_LAMPORTS).message;
  return null;
}

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

async function fundOwner(owner, mint, side, rawQty, escrow) {
  const [sol, t, q] = await getAccountsBatched(connection, [owner.publicKey, tickerAta(owner.publicKey, mint), quoteAta(owner.publicKey, fx.quoteMint)]);
  const ixs = [];
  // What this order costs the funder, exactly, so an empty funder is caught
  // here with a reason instead of in simulation as InsufficientFundsForRent.
  let cost = FEE_ALLOWANCE_LAMPORTS;
  if ((sol?.lamports ?? 0) < OWNER_LOW_LAMPORTS) {
    ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner.publicKey, lamports: OWNER_TOPUP_LAMPORTS }));
    cost += OWNER_TOPUP_LAMPORTS;
  }
  if (!t) cost += await tokenAccountRent(connection, mint, TICKER_PROGRAM);
  if (!q) cost += await tokenAccountRent(connection, fx.quoteMint, QUOTE_PROGRAM);
  const have = await withRetry(() => connection.getBalance(funder.publicKey, "confirmed"));
  if (have < cost) throw new CannotPay("funder wallet2", funder, have, cost);
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
  await sendV0(connection, funder, [deploy], ixs, { cuLimit: 200_000 }).catch((e) => {
    if (isInsufficientFunds(e)) throw new CannotPay("funder wallet2", funder, have, cost);
    throw e;
  });
}

async function seed(tk) {
  const slot = await withRetry(() => connection.getSlot("confirmed"));
  // Shared index read, not getProgramAccounts: that method is rate-limited
  // into uselessness on the public devnet endpoint with several consumers on
  // one address. See scripts/auction-index.mjs.
  const open = (await listAuctionsIndexed(connection, ID, tk.mint)).find(
    (a) => a.status === "open" && slot < a.closeSlot - a.freezeSlots - 60 && slot >= a.openSlot,
  );
  if (!open) return;
  // Each book gets a fixed number of orders, chosen once from its address, and
  // a pass only tops it up to that. Drawing a fresh count every pass and
  // seeding whenever the book held fewer than the maximum gave a book seeded
  // with 2 another 2-3 on the next pass: 32 orders an hour against ~22
  // intended, and each order locks 0.0012 SOL of rent that never comes back.
  const target = ORDERS_MIN + (open.pubkey.toBytes()[0] % (ORDERS_MAX - ORDERS_MIN + 1));
  if (open.orderCount >= target) return;
  if (SKIP_AUCTIONS.has(open.pubkey.toBase58())) {
    return log(`${tk.symbol}: leaving ${open.pubkey.toBase58()} to real participants`);
  }

  const ref = await tk.ref();
  if (!ref) return log(`${tk.symbol}: no reference price, skipping`);
  const m = await multiplier(tk.mint);
  const n = target - open.orderCount;
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
      if (isInsufficientFunds(e)) {
        throw new Error(`order failed for want of SOL (owner ${owner.publicKey.toBase58()} or fee payer deploy ${deploy.publicKey.toBase58()}): ${e.message}`);
      }
      log(`  order failed: ${(e.logs ?? []).find((l) => l.includes("Error Code")) ?? e.message}`);
    }
  }
}

// One rpcStats line every ~5 passes (~5 minutes at the 60s loop interval),
// so a soak run's request rate and 429 count can be read straight off the
// deployed logs.
let pass = 0;
do {
  const why = await cannotPayReason().catch((e) => {
    log(`could not read the paying wallets' balances: ${e.message}`);
    return null;
  });
  if (why) pause(why);
  else {
    resume();
    for (const tk of TICKERS) {
      try {
        await seed(tk);
      } catch (e) {
        if (e instanceof CannotPay) {
          // The rest of the pass would fail the same way.
          pause(e.message);
          break;
        }
        log(`${tk.symbol}: ${e.message}`);
      }
    }
  }
  pass++;
  if (pass % 5 === 0) log(rpcStatsLine("activity"));
  if (process.argv.includes("--loop")) await sleep(60_000);
} while (process.argv.includes("--loop"));
