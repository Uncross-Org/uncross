// A listed ticker with nothing running. Most of the thousand-odd listed xStocks
// are like this, and it must read as available, not as a dead market: a book
// with nothing in it looks broken, a ticker waiting to be opened does not.
//
// Opening is one click and costs the visitor nothing. The faucet service opens
// the auction and pays its rent, which comes back to it when the auction
// closes — so the visitor keeps their whole faucet grant for trading.

import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useState } from "react";
import { FAUCET_URL, type TickerConfig } from "../config";
import type { FaucetHealth } from "../lib/faucet";
import { fmtApproxDuration, fmtInt } from "../lib/format";

interface Props {
  tk: TickerConfig;
  halted: boolean;
  /** The faucet's health: the window it opens auctions with, and whether its wallet can pay the rent. */
  health: FaucetHealth | null;
  /** The venue's own window, read from chain — used when the faucet doesn't say. */
  fallbackWindowSlots: number | null;
  slotMs: number;
  slotMeasured: boolean;
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onOpened: (auction: string) => void;
}

/** "about 27 minutes", from slots and the slot time just measured; null until it has been measured. */
const lasts = (slots: number | null | undefined, slotMs: number, measured: boolean) =>
  slots && slots > 0 && measured ? fmtApproxDuration(slots * slotMs) : null;

export function OpenAuction({ tk, halted, health, fallbackWindowSlots, slotMs, slotMeasured, notify, onOpened }: Props) {
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [busy, setBusy] = useState(false);

  async function open() {
    if (!wallet.publicKey) return setVisible(true);
    setBusy(true);
    try {
      const res = await fetch(`${FAUCET_URL}/api/auction/open`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pubkey: wallet.publicKey.toBase58(), ticker: tk.symbol }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.auction) throw new Error(body?.error ?? `could not open an auction (${res.status})`);
      const took = lasts(body.closeSlot - body.openSlot, slotMs, slotMeasured);
      notify(
        "ok",
        body.existing
          ? `${tk.symbol} already has an auction running — showing it`
          : `${tk.symbol} auction opened — it takes orders for ${took ?? `${fmtInt(body.closeSlot - body.openSlot)} slots`}`,
        body.sig,
      );
      onOpened(body.auction);
    } catch (e) {
      notify("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const windowSlots = health?.window?.slots ?? fallbackWindowSlots;
  const duration = lasts(windowSlots, slotMs, slotMeasured);
  const cannotPay = !!health?.opener && !health.opener.canPay;

  return (
    <section className="card open-auction" aria-label={`Open an auction for ${tk.symbol}`}>
      <div className="open-head">
        <span className="tag tag-listed">Listed</span>
        <h2>No auction is running for {tk.symbol}</h2>
      </div>
      <p className="open-copy">
        {tk.name} is listed here but nobody has opened a book yet. Open one and anyone can place orders in it for{" "}
        {duration ?? "one auction window"}; at the close everyone who can trade fills at one price.
      </p>
      {duration && windowSlots ? (
        <p className="fine muted num">
          {fmtInt(windowSlots)} slots at ~{(slotMs / 1000).toFixed(2)} s a slot, measured over devnet&apos;s last ten minutes.
        </p>
      ) : null}
      {halted ? (
        <p className="fine warn-text">xStocks has marked {tk.symbol} trading-halted, so no auction can be opened for it.</p>
      ) : cannotPay && health?.opener ? (
        <p className="fine warn-text" role="status">
          Opening is unavailable right now: the venue wallet that pays an auction&apos;s rent holds {health.opener.sol.toFixed(4)} SOL
          and one auction needs {health.opener.perRequestSol.toFixed(4)} SOL. It needs a devnet SOL top-up.
        </p>
      ) : (
        <>
          <button className="btn btn-primary open-btn" onClick={open} disabled={busy}>
            {busy ? "Opening…" : wallet.publicKey ? `Open an auction for ${tk.symbol}` : "Connect a wallet to open one"}
          </button>
          <p className="fine muted">
            Opening costs you nothing. The venue pays the auction&apos;s rent
            {health?.opener ? ` — about ${health.opener.perRequestSol.toFixed(3)} SOL —` : ""} and gets it back when the auction
            closes, so your test tokens are all yours to trade with.
          </p>
        </>
      )}
    </section>
  );
}
