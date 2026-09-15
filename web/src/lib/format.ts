const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (max: number, min = 0) => new Intl.NumberFormat("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });

export const fmtUsd = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : usd2.format(n));
export const fmtPrice = (n: number | null | undefined) =>
  n == null || !Number.isFinite(n) ? "—" : "$" + num(n < 10 ? 4 : 2, 2).format(n);
export const fmtShares = (n: number | null | undefined) => {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  return num(a >= 1000 ? 2 : a >= 1 ? 4 : 6).format(n);
};
export const fmtPct = (n: number) => (n > 0 ? "+" : "") + num(2, 2).format(n) + "%";
export const fmtInt = (n: number) => num(0).format(n);

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}

const etTime = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
const etDay = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const etShort = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", minute: "2-digit" });
const localDT = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const fmtEt = (ms: number) => `${etTime.format(ms)} ET`;
export const fmtEtDay = (ms: number) => etDay.format(ms);
export const fmtEtShort = (ms: number) => `${etShort.format(ms)} ET`;
export const fmtLocal = (ms: number) => localDT.format(ms);
export const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
