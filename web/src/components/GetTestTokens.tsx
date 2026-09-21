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
// many requests, cap reached) are written for a person to read, so they are
// shown as they come back.

import { useWallet } from "@solana/wallet-adapter-react";
import { useState } from "react";
import { FAUCET_URL, type TickerConfig } from "../config";
import { RESERVED } from "../lib/reserved";

// The books one grant covers: the event tickers, which are what the faucet
// mints for every grant. Read from event.json so this card and the faucet
// cannot name different tickers.
const EVENT_LIST = [...RESERVED];

interface Props {
  tk: TickerConfig;
  /** Null while balances are still loading. */
  sol: number | null;
  tickerRaw: bigint | null;
  quoteRaw: bigint | null;
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onFunded: () => void;
}

export function GetTestTokens({ tk, sol, tickerRaw, quoteRaw, notify, onFunded }: Props) {
  const wallet = useWallet();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

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
      if (!res.ok) throw new Error(body?.error ?? `the faucet returned ${res.status}`);
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
    }
  }

  const missing = [needsSol && "devnet SOL", needsTicker && `${tk.symbol} shares`, needsQuote && "test dollars"].filter(Boolean);

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
      <button className="btn btn-primary faucet-btn" onClick={get} disabled={busy}>
        {busy ? "Sending…" : done ? "Get more test tokens" : "Get test tokens"}
      </button>
      <p className="fine muted">
        Sends devnet SOL for fees, {EVENT_LIST.length ? `${EVENT_LIST.join(" and ")} shares` : `${tk.symbol} shares`} to
        sell and test dollars to buy with. One grant per wallet every three hours
        {EVENT_LIST.length > 1 ? " — it covers both books, so you only need it once" : ""}.
      </p>
    </section>
  );
}
