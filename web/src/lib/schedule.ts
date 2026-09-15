// Parser for Pyth's market schedule string, e.g.
// "America/New_York;0930-1600,0930-1600,0930-1600,0930-1600,0930-1600,C,C;0907/C,1127/0930-1300"
// = timezone ; Mon..Sun sessions ; MMDD holiday overrides.
// A session is "C" (closed), "O" (open all day) or ranges "HHMM-HHMM" joined by "&".

type Range = [number, number]; // minutes from local midnight, [start, end)

export interface Schedule {
  tz: string;
  weekly: Range[][]; // index 0 = Monday
  holidays: Map<string, Range[]>; // "MMDD"
}

function parseSession(s: string): Range[] {
  const t = s.trim();
  if (!t || t === "C") return [];
  if (t === "O") return [[0, 1440]];
  return t.split("&").map((r) => {
    const [a, b] = r.split("-");
    const m = (x: string) => Number(x.slice(0, 2)) * 60 + Number(x.slice(2, 4));
    return [m(a), m(b)] as Range;
  });
}

export function parseSchedule(s: string): Schedule {
  const [tz, weekly = "", holidays = ""] = s.split(";");
  const days = weekly.split(",").map(parseSession);
  while (days.length < 7) days.push([]);
  const h = new Map<string, Range[]>();
  for (const e of holidays.split(",").filter(Boolean)) {
    const [d, sess] = e.split("/");
    h.set(d, parseSession(sess ?? "C"));
  }
  return { tz: tz || "America/New_York", weekly: days, holidays: h };
}

interface Wall {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  dow: number; // 0 = Monday
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function wallClock(ms: number, tz: string): Wall {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
    });
    fmtCache.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const dows = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow: dows.indexOf(p.weekday) };
}

/** UTC ms for a wall-clock time in tz. */
function zonedToUtc(y: number, mo: number, d: number, minutes: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, 0, minutes);
  const offsetAt = (ms: number) => {
    const w = wallClock(ms, tz);
    return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - Math.floor(ms / 60000) * 60000;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return t;
}

function sessionsFor(s: Schedule, w: Wall): Range[] {
  const key = String(w.mo).padStart(2, "0") + String(w.d).padStart(2, "0");
  return s.holidays.get(key) ?? s.weekly[w.dow] ?? [];
}

export interface MarketState {
  open: boolean;
  /** Next session start (if closed) — UTC ms. */
  nextOpen: number | null;
  /** Current session end (if open) — UTC ms. */
  closesAt: number | null;
}

export function marketState(s: Schedule, now = Date.now()): MarketState {
  const w = wallClock(now, s.tz);
  const nowMin = w.h * 60 + w.mi;
  for (const [a, b] of sessionsFor(s, w)) {
    if (nowMin >= a && nowMin < b) {
      return { open: true, nextOpen: null, closesAt: zonedToUtc(w.y, w.mo, w.d, b, s.tz) };
    }
  }
  // Scan forward up to 14 days for the next session start.
  for (let k = 0; k < 15; k++) {
    const probe = wallClock(now + k * 86400000, s.tz);
    const ranges = sessionsFor(s, probe).slice().sort((x, y) => x[0] - y[0]);
    for (const [a] of ranges) {
      if (k === 0 && a <= nowMin) continue;
      return { open: false, nextOpen: zonedToUtc(probe.y, probe.mo, probe.d, a, s.tz), closesAt: null };
    }
  }
  return { open: false, nextOpen: null, closesAt: null };
}
