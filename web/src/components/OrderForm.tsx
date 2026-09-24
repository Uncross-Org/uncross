import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useMemo, useState } from "react";
import type { TickerConfig } from "../config";
import type { Balances } from "../hooks";
import { fetchAuction, type Auction, type Phase, type Side } from "../lib/auction";
import { fmtPrice, fmtShares, fmtUsd } from "../lib/format";
import { errorMessage, getProgram, placeOrderIxs, sendIxs, TxError } from "../lib/tx";
import { escrowForBuy, perShareToProgram, quoteToUsd, rawToShares, sharesToRaw } from "../lib/units";

interface Props {
  tk: TickerConfig;
  auction: Auction | null;
  phase: Phase | null;
  m: number | null;
  balances: Balances;
  quoteSymbol: string;
  suggestions: { label: string; price: number }[];
  notify: (kind: "ok" | "err", text: string, sig?: string) => void;
  onPlaced: () => void;
}

export function OrderForm({ tk, auction, phase, m, balances, quoteSymbol, suggestions, notify, onPlaced }: Props) {
  const { connection } = useConnection();
  const wallet = useWallet();
  const { setVisible } = useWalletModal();
  const [side, setSide] = useState<Side>("buy");
  const [priceStr, setPriceStr] = useState("");
  const [sharesStr, setSharesStr] = useState("");
  const [busy, setBusy] = useState(false);

  const price = Number(priceStr);
  const shares = Number(sharesStr);
  const accepting = phase === "open" || phase === "freeze";

  const calc = useMemo(() => {
    if (!m || !auction || !(price > 0) || !(shares > 0)) return null;
    const rawQty = sharesToRaw(shares, m);
    const limit = perShareToProgram(price, m);
    if (rawQty <= 0n || limit <= 0n) return null;
    const escrowRaw = side === "buy" ? escrowForBuy(rawQty, limit, auction.tickerDecimals) : rawQty;
    const notional = quoteToUsd(escrowForBuy(rawQty, limit, auction.tickerDecimals));
    return { rawQty, limit, escrowRaw, notional, sharesExact: rawToShares(rawQty, m) };
  }, [m, auction, price, shares, side]);

  const tickerBal = balances.tickerRaw != null && m ? rawToShares(balances.tickerRaw, m) : null;
  const quoteBal = balances.quoteRaw != null ? quoteToUsd(balances.quoteRaw) : null;
  const short =
    calc && wallet.publicKey
      ? side === "buy"
        ? (balances.quoteRaw ?? 0n) < calc.escrowRaw
        : (balances.tickerRaw ?? 0n) < calc.escrowRaw
      : false;
  const lowSol = wallet.publicKey && balances.sol != null && balances.sol < 0.005;

  let blocker: string | null = null;
  if (!tk.mint) blocker = `${tk.symbol} isn't listed on this network yet`;
  else if (!auction) blocker = "No auction is open";
  else if (!accepting) blocker = phase === "upcoming" ? "Auction hasn't opened yet" : "This auction is closed to new orders";
  else if (!calc) blocker = null;
  else if (short) blocker = side === "buy" ? `Not enough ${quoteSymbol}` : `Not enough ${tk.symbol}`;

  async function submit() {
    if (!auction || !calc || !wallet.publicKey) return;
    setBusy(true);
    try {
      const program = getProgram(connection);
      let sig: string | null = null;
      for (let attempt = 0; attempt < 2 && !sig; attempt++) {
        const fresh = await fetchAuction(connection, auction.address);
        if (!fresh) throw new Error("Auction not found");
        const ixs = await placeOrderIxs(program, fresh, wallet.publicKey, side, calc.limit, calc.rawQty, fresh.orderCount);
        try {
          sig = await sendIxs(connection, wallet, ixs, 400_000);
        } catch (e) {
          if (attempt === 0 && e instanceof TxError && e.code === "OrderIndexMismatch") continue;
          throw e;
        }
      }
      notify("ok", `${side === "buy" ? "Buy" : "Sell"} ${fmtShares(calc.sharesExact)} ${tk.symbol} @ ${fmtPrice(price)} placed`, sig ?? undefined);
      setSharesStr("");
      onPlaced();
    } catch (e) {
      notify("err", errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card order-form" aria-label="Place an order">
      <div className="card-head">
        <h2>Place an order</h2>
      </div>
      <div className="seg seg-side" role="tablist" aria-label="Side">
        <button role="tab" aria-selected={side === "buy"} className={side === "buy" ? "on buy" : ""} onClick={() => setSide("buy")}>
          Buy
        </button>
        <button role="tab" aria-selected={side === "sell"} className={side === "sell" ? "on sell" : ""} onClick={() => setSide("sell")}>
          Sell
        </button>
      </div>

      <label className="field">
        <span>{side === "buy" ? "Max price" : "Min price"} per share</span>
        <div className="input-wrap">
          <span className="affix">$</span>
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label="Limit price per share in dollars"
          />
        </div>
      </label>
      {suggestions.length > 0 && (
        <div className="chips">
          {suggestions.map((s) => (
            <button
              key={s.label}
              // The first chip is the best anchor this ticker has: the Pyth
              // reference where a feed exists, otherwise what this book would
              // clear at. Mark it, so a newcomer knows where to start.
              className={`chip num${s === suggestions[0] ? " chip-primary" : ""}`}
              onClick={() => setPriceStr(s.price.toFixed(2))}
            >
              {s.label} {fmtPrice(s.price)}
            </button>
          ))}
        </div>
      )}
      {/* A ticker with no feed is the point of this venue, not a gap in it.
          Say so here, where someone is deciding what to type, rather than
          leaving them with an empty field and no explanation. */}
      {!tk.pythAccount && (
        <p className="fine muted">
          No oracle publishes {/^[AEIOU]/i.test(tk.underlying) ? "an" : "a"} {tk.underlying} price on Solana, so there is
          no reference to copy — the only price for {tk.symbol} is the one this book makes.{" "}
          Its past clearing prices are under Past crosses. Name the price you would actually trade at.
        </p>
      )}

      <label className="field">
        <span>Shares</span>
        <div className="input-wrap">
          <input
            inputMode="decimal"
            placeholder="0"
            value={sharesStr}
            onChange={(e) => setSharesStr(e.target.value.replace(/[^0-9.]/g, ""))}
            aria-label="Number of shares"
          />
          <span className="affix">{tk.symbol}</span>
        </div>
      </label>
      {side === "sell" && tickerBal != null && tickerBal > 0 && (
        <div className="chips">
          <button className="chip num" onClick={() => setSharesStr(String(Math.floor(tickerBal * 1e6) / 1e6))}>
            Max {fmtShares(tickerBal)}
          </button>
        </div>
      )}

      <dl className="summary num">
        {side === "buy" ? (
          <>
            <div>
              <dt>Max cost</dt>
              <dd>{calc ? fmtUsd(quoteToUsd(calc.escrowRaw)) : "—"}</dd>
            </div>
            <div>
              <dt>Locked until the cross</dt>
              <dd>{calc ? `${fmtUsd(quoteToUsd(calc.escrowRaw))} ${quoteSymbol}` : "—"}</dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>Min proceeds</dt>
              <dd>{calc ? fmtUsd(calc.notional) : "—"}</dd>
            </div>
            <div>
              <dt>Locked until the cross</dt>
              <dd>{calc ? `${fmtShares(calc.sharesExact)} ${tk.symbol}` : "—"}</dd>
            </div>
          </>
        )}
        <div className="muted">
          <dt>Balance</dt>
          <dd>
            {!wallet.publicKey
              ? "—"
              : side === "buy"
                ? quoteBal == null
                  ? `0 ${quoteSymbol}`
                  : `${fmtUsd(quoteBal)} ${quoteSymbol}`
                : `${fmtShares(tickerBal ?? 0)} ${tk.symbol}`}
          </dd>
        </div>
      </dl>
      <p className="fine">
        {side === "buy"
          ? "Everyone fills at one price. If it clears below your max, you pay less and the rest comes back."
          : "Everyone fills at one price. If it clears above your min, you receive more."}
        {phase === "freeze" && " Closing — orders placed now can't be cancelled."}
      </p>

      {!wallet.publicKey ? (
        <button className="btn btn-primary wide" onClick={() => setVisible(true)}>
          Connect wallet
        </button>
      ) : (
        <button
          className={`btn wide ${side === "buy" ? "btn-buy" : "btn-sell"}`}
          disabled={busy || !!blocker || !calc}
          onClick={submit}
        >
          {busy ? "Confirm in wallet…" : blocker ?? (calc ? `${side === "buy" ? "Buy" : "Sell"} ${fmtShares(calc.sharesExact)} ${tk.symbol}` : "Enter price and shares")}
        </button>
      )}
      {lowSol && <p className="fine warn-text">Low SOL balance. Each order needs ≈0.002 SOL for its account and fees.</p>}
    </section>
  );
}
