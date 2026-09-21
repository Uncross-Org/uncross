"use client";

// The community auction, counted down.
//
// One scheduled cross that real people fill, rather than the bot. Before it,
// this counts down; during it, it says the book is open and links straight to
// the ticker; afterwards it becomes a link to what happened, because the
// auction stays on chain as a permanent record.
//
// The event's details live in uncross/scripts/event.json, copied into the site
// by scripts/build-app.sh — the same file the script that opens the auction
// reads, so the page and the chain cannot disagree about when it starts.

import { useEffect, useState } from "react";
import event from "@/lib/uncross/event.json";

const START = new Date(event.startsAt).getTime();
const ENDS = START + event.windowMins * 60_000;

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(s / 86400),
    h: Math.floor((s % 86400) / 3600),
    m: Math.floor((s % 3600) / 60),
    s: s % 60,
  };
}

export function EventBanner() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!event.live) return null;
  // Server render and first paint agree by showing the date, not a countdown:
  // a timer that differs between the two flashes the wrong number.
  const phase = now == null ? "pending" : now < START ? "before" : now < ENDS ? "during" : "after";
  const t = now == null ? null : parts(START - now);

  const when = new Date(START).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });

  return (
    <aside className="border-b border-line bg-accent-soft">
      <div className="mx-auto flex max-w-[1200px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:px-8">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="eyebrow text-accent">{event.name}</span>
          {phase === "during" ? (
            <span className="text-[15px] font-semibold text-text">
              The {event.ticker} book is open now — orders close in{" "}
              <span className="num">{parts(ENDS - (now ?? 0)).m}m</span>
            </span>
          ) : phase === "after" ? (
            <span className="text-[15px] font-semibold text-text">It crossed. See what real orders did to one price.</span>
          ) : (
            <span className="text-[15px] text-text-2">
              <span className="font-semibold text-text">{event.ticker}</span> · {when} · {event.blurb}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          {phase === "before" && t && (
            <span className="num text-[15px] font-semibold tabular-nums text-text">
              {t.d > 0 ? `${t.d}d ` : ""}
              {String(t.h).padStart(2, "0")}:{String(t.m).padStart(2, "0")}:{String(t.s).padStart(2, "0")}
            </span>
          )}
          <a
            href={`/app?ticker=${event.ticker}`}
            className="inline-flex items-center rounded-lg bg-cta-bg px-4 py-2 text-[14px] font-semibold text-cta-fg transition hover:brightness-110"
          >
            {phase === "during" ? "Place an order →" : phase === "after" ? "See the result →" : "Open the app →"}
          </a>
        </div>
      </div>
    </aside>
  );
}
