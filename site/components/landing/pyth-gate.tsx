"use client";

// The reference price as the program sees it.
//
// Reads the live mainnet AAPL account every ten seconds (through the
// same-origin proxy, which allows that one account only) and applies the same
// checks as read_fresh_price in programs/uncross/src/oracle.rs. What a reader
// sees here is the answer the on-chain gate would give for this print, and what
// the auction does either way.
//
// The server renders the build-time read, so the panel is readable with
// JavaScript off; the ages switch to live values once it runs.

import { useEffect, useState } from "react";
import { CLUSTER, ORACLE_MAX_AGE_SECS, PYTH_RECEIVER } from "@/lib/uncross/config";
import { decodePriceUpdate } from "@/lib/uncross/pyth";
import { fmtEt, fmtPrice } from "@/lib/uncross/format";
import { marketState, parseSchedule } from "@/lib/uncross/schedule";
import type { OracleSnapshot } from "@/lib/snapshot";

/** Mirrors MAX_CONF_BPS in oracle.rs: confidence no wider than 2% of price. */
const MAX_CONF_BPS = 200;
const FEED = CLUSTER.tickers.AAPLx;

interface Reading {
  price: number;
  conf: number;
  publishTime: number;
  feedId: string;
  verification: number;
  ownerOk: boolean;
}

const fromSnapshot = (o: OracleSnapshot): Reading => ({
  price: o.price,
  conf: o.conf,
  publishTime: o.publishTime,
  feedId: o.feedId,
  verification: o.verification,
  ownerOk: true,
});

async function readLive(): Promise<Reading> {
  const r = await fetch("/api/rpc", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getAccountInfo",
      params: [FEED.pythAccount, { encoding: "base64", commitment: "confirmed" }],
    }),
  });
  if (!r.ok) throw new Error(`proxy ${r.status}`);
  const body = (await r.json()) as { result?: { value?: { data: [string, string]; owner: string } } };
  const v = body.result?.value;
  if (!v) throw new Error("account not returned");
  const bytes = Uint8Array.from(atob(v.data[0]), (c) => c.charCodeAt(0));
  return { ...decodePriceUpdate(bytes), ownerOk: v.owner === PYTH_RECEIVER };
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-t border-line py-1.5 text-[12.5px] first:border-t-0">
      <span className="flex items-baseline gap-2">
        <span aria-hidden="true" className={`num font-semibold ${ok ? "text-bid" : "text-ask"}`}>
          {ok ? "✓" : "✗"}
        </span>
        <span className="text-text-2">{label}</span>
      </span>
      <span className="num text-right text-muted">
        {detail}
        <span className="sr-only">{ok ? " — passes" : " — fails"}</span>
      </span>
    </li>
  );
}

export function PythGate({ initial, builtAt }: { initial: OracleSnapshot | null; builtAt: number }) {
  const [reading, setReading] = useState<Reading | null>(initial ? fromSnapshot(initial) : null);
  const [live, setLive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(builtAt);

  useEffect(() => {
    let alive = true;
    const pull = async () => {
      try {
        const r = await readLive();
        if (!alive) return;
        setReading(r);
        setLive(true);
        setError(null);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void pull();
    const poll = setInterval(() => !document.hidden && void pull(), 10_000);
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    setNow(Date.now());
    return () => {
      alive = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (!reading) {
    return (
      <p className="max-w-[52ch] text-sm text-text-2">
        The Pyth account could not be read, so no reference price is shown. The auction does not need one: it clears on
        its own book either way.
      </p>
    );
  }

  const age = Math.max(0, Math.floor(now / 1000) - reading.publishTime);
  const confBps = reading.price > 0 ? (reading.conf / reading.price) * 10_000 : Infinity;
  const checks = [
    {
      ok: reading.feedId === FEED.pythFeedId,
      label: "Feed is the one this auction is bound to",
      detail: `${reading.feedId.slice(0, 8)}… Equity.US.AAPL/USD`,
    },
    { ok: reading.ownerOk, label: "Owned by the Pyth receiver program", detail: "rec5EK…tFJ" },
    { ok: reading.verification === 1, label: "Fully Wormhole-verified", detail: reading.verification === 1 ? "Full" : "not Full" },
    { ok: age <= ORACLE_MAX_AGE_SECS, label: "Fresh", detail: `${age}s old · limit ${ORACLE_MAX_AGE_SECS}s` },
    {
      ok: confBps <= MAX_CONF_BPS,
      label: "Confidence tight enough",
      detail: `±${fmtPrice(reading.conf)} · ${(confBps / 100).toFixed(3)}% · limit 2%`,
    },
  ];
  const failing = checks.find((c) => !c.ok);
  const scheduleOpen = initial?.schedule ? marketState(parseSchedule(initial.schedule), now).open : null;
  const publishing = age <= ORACLE_MAX_AGE_SECS;

  return (
    <div className="flex flex-col gap-3">
      {/* Two independent facts, side by side: whether the feed is printing, and
          whether Pyth's own schedule says the market is open. Measured, the
          first does not follow from the second. */}
      <span
        className={`w-fit rounded-[5px] px-2.5 py-1.5 font-mono text-xs leading-none tracking-[0.06em] uppercase ${
          // Amber means one thing across the site: outside the regular session.
          publishing && scheduleOpen === false ? "bg-amber-soft text-amber" : "bg-raise text-text-2"
        }`}
        suppressHydrationWarning
      >
        {publishing ? "Publishing" : "Not publishing"}
        {scheduleOpen === null ? "" : scheduleOpen ? " · schedule says open" : " · schedule says closed"}
      </span>
      <div className="display-tight num text-[34px] font-semibold md:text-[44px]">{fmtPrice(reading.price)}</div>
      <div className="num text-[13px] text-text-2">
        published {fmtEt(reading.publishTime * 1000)} · {live ? "read live" : "read when this page was built"}
        {error && live ? " · last read failed, showing the previous one" : ""}
      </div>

      <div>
        <div className="eyebrow mb-1">The program&apos;s gate, applied to this print</div>
        <ul className="flex flex-col">
          {checks.map((c) => (
            <Check key={c.label} {...c} />
          ))}
        </ul>
        <p className={`mt-2 text-[13px] font-semibold ${failing ? "text-ask" : "text-bid"}`}>
          {failing ? `This print would fail the gate: ${failing.label.toLowerCase()}.` : "This print would pass the gate."}
        </p>
      </div>

      <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-muted">
        Pyth never sets the price. It only chooses between prices the book already supports equally well, and only
        when a print passes. When the gate fails, the auction still clears on its own book, and a tie goes to the
        middle of the tied range. On this devnet venue Pyth&apos;s AAPL account is a stale devnet copy, so the gate
        fails at every cross.
      </p>
    </div>
  );
}
