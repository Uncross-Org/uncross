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

interface Props {
  tk: TickerConfig;
  halted: boolean;
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onOpened: (auction: string) => void;
}

export function OpenAuction({ tk, halted, notify, onOpened }: Props) {
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
      notify("ok", body.existing ? `${tk.symbol} already has an auction running — showing it` : `${tk.symbol} auction opened — it takes orders for about 19 minutes`, body.sig);
      onOpened(body.auction);
    } catch (e) {
      notify("err", e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card open-auction" aria-label={`Open an auction for ${tk.symbol}`}>
      <div className="open-head">
        <span className="tag tag-listed">Listed</span>
        <h2>No auction is running for {tk.symbol}</h2>
      </div>
      <p className="open-copy">
        {tk.name} is listed here but nobody has opened a book yet. Open one and anyone can place orders in it for the next
        19 minutes; at the close everyone who can trade fills at one price.
      </p>
      {halted ? (
        <p className="fine warn-text">xStocks has marked {tk.symbol} trading-halted, so no auction can be opened for it.</p>
      ) : (
        <>
          <button className="btn btn-primary open-btn" onClick={open} disabled={busy}>
            {busy ? "Opening…" : wallet.publicKey ? `Open an auction for ${tk.symbol}` : "Connect a wallet to open one"}
          </button>
          <p className="fine muted">
            Opening costs you nothing. The venue pays the auction&apos;s rent — about 0.018 SOL — and gets it back when the
            auction closes, so your test tokens are all yours to trade with.
          </p>
        </>
      )}
    </section>
  );
}
