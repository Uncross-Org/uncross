// The community auction, from inside the app — both books, not just the one
// running.
//
// Two auctions run back to back. Someone arriving during the first needs to
// know a second follows, and which book they are currently looking at, or
// they leave after the first cross without realising there was more.

import { useEffect, useState } from "react";
import event from "../event.json";
import type { TickerSymbol } from "../config";

interface Leg {
  ticker: string;
  startsAt: string;
  windowMins: number;
  note?: string;
}

const LEGS: Leg[] = (event.auctions ?? []) as Leg[];
const startOf = (l: Leg) => new Date(l.startsAt).getTime();
const endOf = (l: Leg) => startOf(l) + l.windowMins * 60_000;
const LAST = LEGS.length ? endOf(LEGS[LEGS.length - 1]) : 0;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h > 0 ? `${h}h ` : ""}${m}m ${String(s % 60).padStart(2, "0")}s`;
};

interface Props {
  ticker: TickerSymbol;
  onGo: (t: TickerSymbol) => void;
}

export function EventBar({ ticker, onGo }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!event.live || LEGS.length === 0 || now > LAST + 45 * 60_000) return null;

  const live = LEGS.find((l) => now >= startOf(l) && now < endOf(l)) ?? null;
  const next = LEGS.find((l) => now < startOf(l)) ?? null;
  const here = live?.ticker === ticker;

  return (
    <div className={`event-bar${live ? " event-bar-live" : ""}`}>
      <span className="event-dot" aria-hidden />
      <span className="event-text">
        {live ? (
          <>
            <strong>{live.ticker} community auction is open.</strong> Orders close in{" "}
            <span className="num">{clock(endOf(live) - now)}</span>.
            {next && (
              <>
                {" "}
                <span className="muted">
                  {next.ticker} follows immediately, {clock(startOf(next) - now)} from now.
                </span>
              </>
            )}
          </>
        ) : next ? (
          <>
            <strong>{next.ticker} community auction</strong> starts in <span className="num">{clock(startOf(next) - now)}</span>
            <span className="muted"> · {LEGS.map((l) => l.ticker).join(" then ")}, one grant covers both</span>
          </>
        ) : (
          <strong>Both community auctions have crossed.</strong>
        )}
      </span>
      {live && !here && (
        <button className="event-go" onClick={() => onGo(live.ticker as TickerSymbol)}>
          Go to {live.ticker} →
        </button>
      )}
      {!live && next && next.ticker !== ticker && (
        <button className="event-go" onClick={() => onGo(next.ticker as TickerSymbol)}>
          Go to {next.ticker} →
        </button>
      )}
    </div>
  );
}
