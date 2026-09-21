"use client";

// The community auction, counted down — both books, not just the one running.
//
// Two auctions run back to back. A visitor arriving during the first needs to
// see that a second follows, or they leave after the first cross without
// knowing there was more. So the banner always shows the sequence, marks which
// book is live, and counts down to whatever happens next.
//
// The details live in uncross/scripts/event.json, copied into the site by
// scripts/build-app.sh — the same file the script that opens the auctions
// reads, so the page and the chain cannot disagree about when they start.

import { useEffect, useState } from "react";
import event from "@/lib/uncross/event.json";

interface Leg {
  ticker: string;
  startsAt: string;
  windowMins: number;
  note?: string;
}

const LEGS: Leg[] = (event.auctions ?? []) as Leg[];
const startOf = (l: Leg) => new Date(l.startsAt).getTime();
const endOf = (l: Leg) => startOf(l) + l.windowMins * 60_000;
const FIRST = LEGS.length ? startOf(LEGS[0]) : 0;
const LAST = LEGS.length ? endOf(LEGS[LEGS.length - 1]) : 0;

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d > 0 ? `${d}d ` : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function EventBanner() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!event.live || LEGS.length === 0) return null;

  const liveLeg = now == null ? null : LEGS.find((l) => now >= startOf(l) && now < endOf(l)) ?? null;
  const nextLeg = now == null ? null : LEGS.find((l) => now < startOf(l)) ?? null;
  const over = now != null && now >= LAST;

  const when = new Date(FIRST).toLocaleString("en-US", {
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
      <div className="mx-auto flex max-w-[1200px] flex-col gap-2 px-4 py-3 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="eyebrow text-accent">{event.name}</span>
            {liveLeg ? (
              <span className="text-[15px] font-semibold text-text">
                The {liveLeg.ticker} book is open — orders close in{" "}
                <span className="num">{clock(endOf(liveLeg) - (now ?? 0))}</span>
              </span>
            ) : over ? (
              <span className="text-[15px] font-semibold text-text">Both books crossed. See what real orders did to one price.</span>
            ) : (
              <span className="text-[15px] text-text-2">
                <span className="font-semibold text-text">{LEGS.map((l) => l.ticker).join(" then ")}</span> · {when} · {event.blurb}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {!over && nextLeg && now != null && (
              <span className="num text-[15px] font-semibold tabular-nums text-text">
                {liveLeg ? `${nextLeg.ticker} in ` : ""}
                {clock(startOf(nextLeg) - now)}
              </span>
            )}
            <a
              href={`/app?ticker=${(liveLeg ?? nextLeg ?? LEGS[0]).ticker}`}
              className="inline-flex items-center rounded-lg bg-cta-bg px-4 py-2 text-[14px] font-semibold text-cta-fg transition hover:brightness-110"
            >
              {liveLeg ? "Place an order →" : over ? "See the result →" : "Open the app →"}
            </a>
          </div>
        </div>

        {/* The sequence, always visible: arriving during the first book should
            never be the reason someone misses the second. */}
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-text-2">
          {LEGS.map((l, i) => {
            const isLive = liveLeg?.ticker === l.ticker;
            const done = now != null && now >= endOf(l);
            return (
              <li key={l.ticker} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden="true" className="text-muted">→</span>}
                <span
                  className={`num rounded-md px-2 py-0.5 ${
                    isLive ? "bg-accent text-cta-fg font-semibold" : done ? "text-muted line-through" : "border border-line text-text-2"
                  }`}
                >
                  {l.ticker}
                </span>
                <span className="num text-muted">
                  {new Date(startOf(l)).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false })}–
                  {new Date(endOf(l)).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false })} UTC
                </span>
              </li>
            );
          })}
          <li className="text-muted">· one grant of test tokens covers both</li>
        </ol>
      </div>
    </aside>
  );
}
