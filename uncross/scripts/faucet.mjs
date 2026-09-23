// Test-token faucet for the devnet venue.
//
// A stranger arriving at the dashboard has an empty wallet and no way to fill
// it: devnet SOL needs a public faucet, and the fixture ticker and quote mints
// are ours — nobody else can mint them at any price. Without this service they
// can watch an auction and nothing more. One POST gives a wallet everything it
// needs to place one order: a little SOL for fees and order rent, some shares
// of the ticker, and some fixture dollars.
//
//   POST /faucet        {"pubkey": "...", "ticker": "AAPLx"}
//   POST /auction/open  {"pubkey": "...", "ticker": "QQQx"}
//   GET  /health
//
// The signing keys stay here, in this process's environment (Railway), and
// never go near a browser bundle or a Vercel function. Three independent
// limits stop it being drained: one grant per wallet per cooldown, a per-IP
// hourly count, and hard global caps on both grants and SOL paid out. When a
// cap is hit the service refuses rather than degrading quietly.

import http from "node:http";
import anchor from "@coral-xyz/anchor";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToCheckedInstruction,
} from "@solana/spl-token";
import fs from "node:fs";
import path from "node:path";
import {
  loadKeypair,
  loadFixture,
  loadTickers,
  getProgram,
  auctionPda,
  vaultTickerAta,
  vaultQuoteAta,
  makeConnection,
  getAccountsBatched,
  tokenAmountOf,
  tickerAta,
  quoteAta,
  sendV0,
  rpcHosts,
  TICKER_PROGRAM,
  QUOTE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
} from "./lib.mjs";

const { PublicKey, SystemProgram, LAMPORTS_PER_SOL } = anchor.web3;

const opt = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[name.toUpperCase().replace(/-/g, "_")] ?? fallback;
};

const PORT = Number(opt("port", process.env.PORT ?? 8080));
/** SOL per grant: order rent (~0.002) plus fees, with room for several orders. */
const SOL_PER_GRANT = Number(opt("sol", 0.02));
/** Ticker tokens per grant, in whole token units (8 dp on the fixture mints). */
const SHARES_PER_GRANT = Number(opt("shares", 12));
/** Fixture dollars per grant (6 dp), enough to buy a few shares of anything listed. */
const QUOTE_PER_GRANT = Number(opt("quote", 6000));
/** One grant per wallet per this long. */
const PUBKEY_COOLDOWN_MS = Number(opt("cooldown-mins", 180)) * 60_000;
/**
 * Per-IP grants allowed per hour.
 *
 * Deliberately loose. Browsers reach this through the site's /api/faucet
 * rewrite, so the address seen here is the proxy's, not the participant's —
 * measured: direct requests arrive as the real client, proxied ones as a
 * Vercel edge. A tight limit would therefore refuse real participants at a
 * shared address while stopping nobody. What actually bounds the damage is
 * the per-wallet cooldown and the global caps below, and the worst case they
 * allow is someone wasting a capped amount of devnet SOL.
 */
const IP_PER_HOUR = Number(opt("ip-per-hour", 500));
/** Hard ceilings for the life of the process. */
const MAX_GRANTS = Number(opt("max-grants", 300));
const MAX_SOL = Number(opt("max-sol", 1.5));
/**
 * Tickers every grant funds, whatever was asked for: the event runs more than
 * one auction and a participant must be able to sell in all of them.
 */
const EVENT_TICKERS = (opt("event-tickers", "AAPLx,IBMx") || "").split(",").map((s) => s.trim()).filter(Boolean);

/** Browsers that may call this. */
const ORIGINS = (opt("origins", "https://uncross.0xo.in,http://localhost:3100") || "").split(",").map((s) => s.trim());

const deploy = loadKeypair("deploy"); // mint authority for both fixture mints
// Whose SOL goes out, and who pays the ATA rent. wallet2 is the bot's funder
// and is drained by it; for an event, point this at a wallet with a balance
// that will still be there in twelve hours (FUNDER=deploy).
const funder = loadKeypair(opt("funder", "wallet2"));
const fx = loadFixture();
const tickers = loadTickers();
const connection = makeConnection();

// Every listed ticker, not just the ten on cadence. universe.json is built from
// the verified xStocks list and the fixture mints; without it the faucet falls
// back to the ten it always knew, so an old checkout still runs.
const UNIVERSE_PATH = path.join(import.meta.dirname, "universe.json");
const universe = fs.existsSync(UNIVERSE_PATH) ? JSON.parse(fs.readFileSync(UNIVERSE_PATH, "utf8")).tickers : [];
const BY_SYMBOL = new Map(universe.map((t) => [t.symbol, t]));
for (const t of tickers.tickers) BY_SYMBOL.set(t.symbol, { ...(BY_SYMBOL.get(t.symbol) ?? {}), ...t, active: true });
const lookup = (symbol) => BY_SYMBOL.get(symbol) ?? null;

const log = (...a) => console.log(new Date().toISOString(), ...a);

const grantedAt = new Map(); // pubkey -> ms
const ipHits = new Map(); // ip -> [ms, ...]
const stats = { since: Date.now(), grants: 0, solPaid: 0, refused: {}, failed: 0 };
const refuse = (why) => {
  stats.refused[why] = (stats.refused[why] ?? 0) + 1;
};

/**
 * Everything a wallet needs to trade in every auction of the event, in one
 * transaction.
 *
 * One grant has to cover the whole sequence. The event runs AAPLx and then
 * IBMx back to back, and a wallet holding only the first ticker's shares can
 * buy in the second auction but never sell in it — which it would discover
 * after the first cross, when the moment has passed and asking for help is
 * the only way out. So shares are minted for every ticker in EVENT_TICKERS as
 * well as whichever one was asked for.
 */
async function grant(owner, requested) {
  const quoteMint = new PublicKey(fx.quoteMint);
  // The requested ticker first, then the event's, without duplicates.
  const symbols = [requested.symbol, ...EVENT_TICKERS].filter((s, i, all) => all.indexOf(s) === i);
  const tks = symbols.map(lookup).filter((t) => t?.devnetMint);

  const keys = [owner, quoteAta(owner, quoteMint), ...tks.map((t) => tickerAta(owner, new PublicKey(t.devnetMint)))];
  const [sol, q, ...tokenAccounts] = await getAccountsBatched(connection, keys);

  const ixs = [];
  const lamports = Math.round(SOL_PER_GRANT * LAMPORTS_PER_SOL);
  // Top up rather than pay blindly: a wallet that already has SOL only needs
  // the tokens, and the cap should be spent on wallets that are actually empty.
  const solNeeded = (sol?.lamports ?? 0) < lamports;
  if (solNeeded) ixs.push(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: owner, lamports }));

  ixs.push(
    createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, quoteAta(owner, quoteMint), owner, quoteMint, QUOTE_PROGRAM, ASSOCIATED_TOKEN_PROGRAM),
  );

  const shareRaw = BigInt(Math.round(SHARES_PER_GRANT * 1e8));
  const quoteRaw = BigInt(Math.round(QUOTE_PER_GRANT * 1e6));
  const funded = [];
  tks.forEach((t, i) => {
    const mint = new PublicKey(t.devnetMint);
    ixs.push(
      createAssociatedTokenAccountIdempotentInstruction(funder.publicKey, tickerAta(owner, mint), owner, mint, TICKER_PROGRAM, ASSOCIATED_TOKEN_PROGRAM),
    );
    if (tokenAmountOf(tokenAccounts[i]) < shareRaw) {
      ixs.push(createMintToCheckedInstruction(mint, tickerAta(owner, mint), deploy.publicKey, shareRaw, 8, [], TICKER_PROGRAM));
    }
    funded.push(t.symbol);
  });

  if (tokenAmountOf(q) < quoteRaw) {
    ixs.push(createMintToCheckedInstruction(quoteMint, quoteAta(owner, quoteMint), deploy.publicKey, quoteRaw, 6, [], QUOTE_PROGRAM));
  }

  const r = await sendV0(connection, funder, [deploy], ixs, { cuLimit: 400_000 });
  return { sig: r.sig, sol: solNeeded ? SOL_PER_GRANT : 0, funded };
}

// ---------------------------------------------------------------- open an auction
//
// Most listed tickers are dormant: nothing opens their auctions on a cadence.
// Anyone can open one here. The rent (about 0.018 SOL) is paid by deploy, not
// the visitor, because a faucet grant is 0.02 SOL and a visitor who paid it
// themselves would have nothing left to place an order with. The payer is
// recorded in the auction, so close_auction returns the rent to deploy once the
// keeper has cleared and settled it.
//
// Limits, in the faucet's own shape: one open per wallet per cooldown, an
// hourly count per IP, and a cap on how many faucet-opened auctions can be live
// at once, which bounds the rent locked at any moment.
const CADENCE = Number(opt("cadence", 7000));
const FREEZE = Number(opt("freeze", 700));
const OPEN_COOLDOWN_MS = Number(opt("open-cooldown-mins", 15)) * 60_000;
const OPEN_IP_PER_HOUR = Number(opt("open-ip-per-hour", 30));
const OPEN_MAX_LIVE = Number(opt("open-max-live", 25));
const { program } = getProgram(deploy);
const PROGRAM_ID = program.programId;
const QUOTE = new PublicKey(fx.quoteMint);
const openedAt = new Map(); // pubkey -> ms
const openIpHits = new Map(); // ip -> [ms, ...]
const opened = []; // { auction, closeSlot }
const openStats = { opened: 0, refused: {} };
let lastSlot = 0;
const liveOpens = () => opened.filter((o) => o.closeSlot > lastSlot).length;
const mintLocks = new Map();
const refuseOpen = (why) => { openStats.refused[why] = (openStats.refused[why] ?? 0) + 1; };

/** A live auction already running for this mint, if there is one. */
async function liveAuctionFor(mint, slot) {
  const r = await connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    dataSlice: { offset: 8, length: 16 }, // open_slot, close_slot
    filters: [{ dataSize: 2880 }, { memcmp: { offset: 80, bytes: mint.toBase58() } }],
  });
  const live = r
    .map((x) => ({ auction: x.pubkey.toBase58(), openSlot: Number(x.account.data.readBigUInt64LE(0)), closeSlot: Number(x.account.data.readBigUInt64LE(8)) }))
    .filter((a) => a.closeSlot > slot)
    .sort((a, b) => b.openSlot - a.openSlot);
  return live[0] ?? null;
}

async function openFor(tk) {
  const mint = new PublicKey(tk.devnetMint);
  const slot = await connection.getSlot("confirmed");
  lastSlot = slot;
  const existing = await liveAuctionFor(mint, slot);
  if (existing) return { ...existing, existing: true };
  const feed = tk.pythFeedId ? Buffer.from(tk.pythFeedId.replace(/^0x/, ""), "hex") : Buffer.alloc(32);
  const auction = auctionPda(PROGRAM_ID, mint, slot);
  const ix = await program.methods
    .initializeAuction(new anchor.BN(slot), new anchor.BN(slot + CADENCE), new anchor.BN(FREEZE), new anchor.BN(CADENCE), Array.from(feed))
    .accountsStrict({
      payer: deploy.publicKey,
      auction,
      tickerMint: mint,
      quoteMint: QUOTE,
      vaultTicker: vaultTickerAta(auction, mint),
      vaultQuote: vaultQuoteAta(auction, QUOTE),
      tickerTokenProgram: TICKER_PROGRAM,
      quoteTokenProgram: QUOTE_PROGRAM,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const r = await sendV0(connection, deploy, [], [ix]);
  opened.push({ auction: auction.toBase58(), closeSlot: slot + CADENCE });
  return { auction: auction.toBase58(), openSlot: slot, closeSlot: slot + CADENCE, sig: r.sig, existing: false };
}

async function openRoute(req, res, origin) {
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "?";
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2000) return json(res, 413, { error: "body too large" }, origin);
  }
  let pubkey, ticker;
  try {
    const parsed = JSON.parse(body || "{}");
    pubkey = String(parsed.pubkey ?? "");
    ticker = String(parsed.ticker ?? "");
  } catch {
    refuseOpen("bad json");
    return json(res, 400, { error: "expected JSON {pubkey, ticker}" }, origin);
  }
  try {
    const k = new PublicKey(pubkey);
    if (!PublicKey.isOnCurve(k.toBytes())) throw new Error("not a wallet");
  } catch {
    refuseOpen("bad pubkey");
    return json(res, 400, { error: "connect a wallet first — that is not a valid wallet address" }, origin);
  }
  const tk = lookup(ticker);
  if (!tk?.devnetMint) {
    refuseOpen("bad ticker");
    return json(res, 400, { error: `${ticker} is not a listed ticker` }, origin);
  }

  const last = openedAt.get(pubkey);
  if (last && Date.now() - last < OPEN_COOLDOWN_MS) {
    refuseOpen("wallet cooldown");
    const mins = Math.ceil((OPEN_COOLDOWN_MS - (Date.now() - last)) / 60_000);
    return json(res, 429, { error: `this wallet opened an auction recently — try again in ${mins} minutes`, retryInMins: mins }, origin);
  }
  const hour = Date.now() - 3_600_000;
  const hits = (openIpHits.get(ip) ?? []).filter((t) => t > hour);
  if (hits.length >= OPEN_IP_PER_HOUR) {
    refuseOpen("ip limit");
    return json(res, 429, { error: "too many auctions opened from this address — try again later" }, origin);
  }
  lastSlot = await connection.getSlot("confirmed").catch(() => lastSlot);
  if (liveOpens() >= OPEN_MAX_LIVE) {
    refuseOpen("live cap");
    return json(res, 503, { error: "the maximum number of on-demand auctions is running — try again when one closes" }, origin);
  }

  // One open per mint at a time: two clicks in the same slot would derive the
  // same auction address, and the second transaction would fail.
  const key = tk.devnetMint;
  while (mintLocks.get(key)) await mintLocks.get(key).catch(() => {});
  let release;
  mintLocks.set(key, new Promise((r) => (release = r)));
  try {
    const r = await openFor(tk);
    if (!r.existing) {
      openedAt.set(pubkey, Date.now());
      hits.push(Date.now());
      openIpHits.set(ip, hits);
      openStats.opened++;
      log(`opened ${ticker} ${r.auction} for ${pubkey.slice(0, 8)}… slots ${r.openSlot}..${r.closeSlot} — ${r.sig}`);
    } else {
      log(`${ticker} already has a live auction ${r.auction}; returned it to ${pubkey.slice(0, 8)}…`);
    }
    return json(res, 200, { ok: true, ticker, ...r, rentPaidBy: r.existing ? null : "venue" }, origin);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log(`open failed for ${ticker}: ${message}`);
    return json(res, 502, { error: "could not open that auction just now — try again in a moment" }, origin);
  } finally {
    mintLocks.delete(key);
    release();
  }
}

const json = (res, code, body, origin) => {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
    ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer(async (req, res) => {
  const origin = ORIGINS.includes(req.headers.origin) ? req.headers.origin : null;
  const url = new URL(req.url, "http://localhost");

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      ...(origin ? { "access-control-allow-origin": origin, vary: "origin" } : {}),
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
      "access-control-max-age": "86400",
    });
    return res.end();
  }

  if (url.pathname === "/health") {
    // Echo how this caller is identified for rate limiting. Behind the site's
    // rewrite the hop chain matters: if every participant arrived as the same
    // proxy address, the per-IP limit would refuse the event at that count.
    const seenIp = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "?";
    return json(res, 200, {
      ok: true,
      youLookLike: seenIp,
      forwardedFor: String(req.headers["x-forwarded-for"] ?? "(none)"),
      upMins: Math.round((Date.now() - stats.since) / 60_000),
      grants: stats.grants,
      solPaid: Number(stats.solPaid.toFixed(4)),
      failed: stats.failed,
      refused: stats.refused,
      capacityLeft: { grants: MAX_GRANTS - stats.grants, sol: Number((MAX_SOL - stats.solPaid).toFixed(4)) },
      tickers: tickers.tickers.map((t) => t.symbol),
      listed: BY_SYMBOL.size,
      opens: { opened: openStats.opened, live: liveOpens(), capLive: OPEN_MAX_LIVE, refused: openStats.refused },
    }, origin);
  }

  if (url.pathname === "/auction/open" && req.method === "POST") return openRoute(req, res, origin);
  if (url.pathname !== "/faucet" || req.method !== "POST") return json(res, 404, { error: "not found" }, origin);

  // Railway terminates TLS in front of the process; the real client address is
  // the first hop in x-forwarded-for.
  const ip = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.socket.remoteAddress || "?";

  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 2000) return json(res, 413, { error: "body too large" }, origin);
  }

  let pubkey, ticker;
  try {
    const parsed = JSON.parse(body || "{}");
    pubkey = String(parsed.pubkey ?? "");
    ticker = String(parsed.ticker ?? tickers.tickers[0].symbol);
  } catch {
    refuse("bad json");
    return json(res, 400, { error: "expected JSON {pubkey, ticker}" }, origin);
  }

  let owner;
  try {
    owner = new PublicKey(pubkey);
    // A program address cannot sign, so it cannot be a participant's wallet.
    if (!PublicKey.isOnCurve(owner.toBytes())) throw new Error("not a wallet address");
  } catch {
    refuse("bad pubkey");
    return json(res, 400, { error: "that is not a valid wallet address" }, origin);
  }

  const tk = lookup(ticker);
  if (!tk?.devnetMint) {
    refuse("bad ticker");
    return json(res, 400, { error: `unknown ticker ${ticker}` }, origin);
  }

  if (stats.grants >= MAX_GRANTS || stats.solPaid >= MAX_SOL) {
    refuse("global cap");
    log(`refused ${pubkey.slice(0, 8)} — global cap reached (${stats.grants} grants, ${stats.solPaid.toFixed(3)} SOL)`);
    return json(res, 503, { error: "the faucet has reached its limit for now — ask in the chat and we will fund you by hand" }, origin);
  }

  const last = grantedAt.get(pubkey);
  if (last && Date.now() - last < PUBKEY_COOLDOWN_MS) {
    refuse("pubkey cooldown");
    const mins = Math.ceil((PUBKEY_COOLDOWN_MS - (Date.now() - last)) / 60_000);
    return json(res, 429, { error: `this wallet was already funded — try again in ${mins} minutes`, retryInMins: mins }, origin);
  }

  const hour = Date.now() - 3_600_000;
  const hits = (ipHits.get(ip) ?? []).filter((t) => t > hour);
  if (hits.length >= IP_PER_HOUR) {
    refuse("ip limit");
    return json(res, 429, { error: "too many requests from this address — try again later" }, origin);
  }

  // Reserve before sending, so two requests in flight cannot both pass the caps.
  grantedAt.set(pubkey, Date.now());
  hits.push(Date.now());
  ipHits.set(ip, hits);

  try {
    const { sig, sol, funded } = await grant(owner, tk);
    stats.grants++;
    stats.solPaid += sol;
    log(`funded ${pubkey.slice(0, 8)}…: ${sol} SOL, ${SHARES_PER_GRANT} each of ${funded.join("+")}, ${QUOTE_PER_GRANT} fixture USDC — ${sig}`);
    return json(res, 200, {
      ok: true,
      signature: sig,
      granted: { sol, shares: SHARES_PER_GRANT, quote: QUOTE_PER_GRANT, tickers: funded },
    }, origin);
  } catch (e) {
    // Let them retry: the reservation is only meaningful if the grant landed.
    grantedAt.delete(pubkey);
    stats.failed++;
    const message = e instanceof Error ? e.message : String(e);
    log(`failed ${pubkey.slice(0, 8)}…: ${message}`);
    return json(res, 502, { error: "the faucet could not fund that wallet just now — try again in a moment" }, origin);
  }
});

log(`faucet endpoints: ${rpcHosts().join(" -> ")}`);
log(`faucet up on :${PORT} — ${SOL_PER_GRANT} SOL + ${SHARES_PER_GRANT} shares + ${QUOTE_PER_GRANT} quote per grant`);
log(`caps: ${MAX_GRANTS} grants, ${MAX_SOL} SOL, ${IP_PER_HOUR}/IP/hour, ${PUBKEY_COOLDOWN_MS / 60000}min per wallet`);
log(`funder ${funder.publicKey.toBase58()}, mint authority ${deploy.publicKey.toBase58()}`);
log(`listed tickers: ${BY_SYMBOL.size}; on-demand auctions: ${CADENCE} slots, max ${OPEN_MAX_LIVE} live, ${OPEN_COOLDOWN_MS / 60000}min per wallet`);
server.listen(PORT);
