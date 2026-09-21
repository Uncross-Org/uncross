// The community auction, from inside the app.
//
// Someone arriving from the announcement lands here, and needs to know two
// things immediately: whether the book is open yet, and that this ticker is
// the one. Before the event it counts down; while the window is open it says
// so and points at the ticker; afterwards it steps out of the way.

import { useEffect, useState } from "react";
import event from "../event.json";
import type { TickerSymbol } from "../config";

const START = new Date(event.startsAt).getTime();
const ENDS = START + event.windowMins * 60_000;

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

  if (!event.live || now > ENDS + 45 * 60_000) return null;

  const before = now < START;
  const during = !before && now < ENDS;
  const left = Math.max(0, (before ? START : ENDS) - now);
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const onTicker = ticker === event.ticker;

  return (
    <div className={`event-bar${during ? " event-bar-live" : ""}`}>
      <span className="event-dot" aria-hidden />
      <span className="event-text">
        {during ? (
          <>
            <strong>{event.ticker} community auction is open.</strong> Orders close in{" "}
            <span className="num">
              {m}m {String(s).padStart(2, "0")}s
            </span>
            . Everyone fills at one price.
          </>
        ) : (
          <>
            <strong>{event.ticker} community auction</strong> starts in{" "}
            <span className="num">
              {h > 0 ? `${h}h ` : ""}
              {m}m {String(s).padStart(2, "0")}s
            </span>
          </>
        )}
      </span>
      {!onTicker && (
        <button className="event-go" onClick={() => onGo(event.ticker as TickerSymbol)}>
          Go to {event.ticker} →
        </button>
      )}
    </div>
  );
}
