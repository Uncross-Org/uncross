// The one action a newcomer needs.
//
// The fixture mints belong to this venue, so a wallet that has just connected
// cannot get shares or quote dollars anywhere — not from a public faucet, not
// by swapping. Without this button a visitor can watch an auction and nothing
// else. One click asks the faucet service for devnet SOL, shares and fixture
// dollars, and the order form below it comes alive.
//
// It shows itself when the connected wallet is short of anything it needs, and
// says plainly what arrived. The faucet's own refusals (already funded, too
// many requests, cap reached, wallet empty) are written for a person to read,
// so they are shown as they come back. When the faucet's health already says
// it cannot pay, the card says so before anyone clicks, rather than letting a
// click fail.

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { FAUCET_URL, type TickerConfig } from "../config";
import { faucetBlocked, refreshFaucetHealth, type FaucetHealth } from "../lib/faucet";
import { fmtMinutes } from "../lib/format";
import { EVENT_TICKERS } from "../lib/reserved";

// The books one grant covers: the event tickers, which are what the faucet
// mints for every grant. Read from event.json so this card and the faucet
// cannot name different tickers.
const EVENT_LIST = EVENT_TICKERS;

const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

interface Props {
  tk: TickerConfig;
  /** Null while balances are still loading. */
  sol: number | null;
  tickerRaw: bigint | null;
  quoteRaw: bigint | null;
  health: FaucetHealth | null;
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onFunded: () => void;
}

export function GetTestTokens({ tk, sol, tickerRaw, quoteRaw, health, notify, onFunded }: Props) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // The faucet's last refusal, kept on the card: a toast is gone in seconds,
  // and "it can't pay" is the one thing a stuck newcomer needs to read.
  const [refused, setRefused] = useState<string | null>(null);

  if (!wallet.publicKey) return null;
  // Enough SOL for an order's rent and fees, and something on both sides of the
  // book: short of any of these, the order form cannot be used.
  const needsSol = sol != null && sol < 0.005;
  const needsTicker = (tickerRaw ?? 0n) === 0n;
  const needsQuote = (quoteRaw ?? 0n) === 0n;
  const stillLoading = sol == null;
  if (stillLoading || (!needsSol && !needsTicker && !needsQuote && !done)) return null;

  async function get() {
    if (!wallet.publicKey) return;
    setBusy(true);
    try {
      const res = await fetch(`${FAUCET_URL}/api/faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubkey: wallet.publicKey.toBase58(), ticker: tk.symbol }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const why = body?.error ?? "the faucet couldn't be reached just now — try again in a moment";
        if (res.status === 503) setRefused(why);
        throw new Error(why);
      }
      setRefused(null);
      const g = body.granted ?? {};
      // Say everything the grant contained, from the faucet's own answer. One
      // grant covers every event ticker, and someone told only about the book
      // they are looking at goes back to the faucet before the second one —
      // and is refused, because they were already funded.
      const tickers: string[] = Array.isArray(g.tickers) && g.tickers.length ? g.tickers : [tk.symbol];
      const shares = tickers.map((s) => `${g.shares} ${s}`).join(tickers.length > 2 ? ", " : " and ");
      notify(
        "ok",
        `Funded: ${g.sol ? `${g.sol} SOL, ` : ""}${shares}${tickers.length > 1 ? "," : ""} and ${Number(g.quote).toLocaleString("en-US")} test USDC`,
        body.signature,
      );
      setDone(true);
      // Balances poll on their own timer; ask for them now so the form unlocks.
      onFunded();
    } catch (e) {
      notify("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      refreshFaucetHealth();
    }
  }

  const missing = [needsSol && "devnet SOL", needsTicker && `${tk.symbol} shares`, needsQuote && "test dollars"].filter(Boolean);
  // What the faucet actually sends: the ticker being viewed, then the event's.
  const granted = [tk.symbol, ...EVENT_LIST].filter((s, i, all) => all.indexOf(s) === i);
  // Health decides whether the button works; a refusal only adds the words,
  // so a wallet topped up since then is not locked out until a reload.
  const blocked = faucetBlocked(health);
  const message = blocked
    ? `${blocked} Ask in the chat and we'll fund this wallet by hand.`
    : refused && refused.charAt(0).toUpperCase() + refused.slice(1);

  return (
    <section className="card faucet-card" aria-label="Get test tokens">
      <div className="faucet-head">
        <h2>New here? Get test tokens</h2>
        {done && !busy && <span className="tag tag-live">funded</span>}
      </div>
      <p className="fine">
        {missing.length
          ? `This wallet needs ${missing.join(", ")} before it can place an order. Everything on devnet is a test token — none of it is worth anything.`
          : "This wallet is funded. Place an order below."}
      </p>
      {message && (
        <p className="fine warn-text faucet-blocked" role="status">
          {message}
        </p>
      )}
      <button className="btn btn-primary faucet-btn" onClick={get} disabled={busy || !!blocked}>
        {busy ? "Sending…" : blocked ? "Faucet unavailable right now" : done ? "Get more test tokens" : "Get test tokens"}
      </button>
      <p className="fine muted">
        Sends devnet SOL for fees, {joinAnd(granted)} shares to sell and test dollars to buy with. One grant per wallet
        {health?.cooldownMins ? ` every ${fmtMinutes(health.cooldownMins)}` : " per cooldown"}.
      </p>
    </section>
  );
}
