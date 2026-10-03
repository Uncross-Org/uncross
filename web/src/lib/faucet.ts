// What the faucet service (uncross/scripts/faucet.mjs) says about itself.
//
// Read once per page and shared: the footer's status line, the "Get test
// tokens" card and the open-an-auction card all need it, and each asking on
// its own timer would triple the polling for one answer.

import { useEffect, useState } from "react";
import { FAUCET_URL } from "../config";
import { fmtSol } from "./format";

/** A wallet the faucet spends from, measured against what one request costs it. */
export interface PayerHealth {
  address: string;
  /** Balance as read from chain, SOL. */
  sol: number;
  /** Most one request can cost this wallet, SOL. */
  perRequestSol: number;
  /** How many such requests the balance covers. */
  requestsLeft: number;
  canPay: boolean;
}

export interface FaucetHealth {
  capacityLeft?: { grants: number; sol: number };
  /** Pays the SOL and token-account rent of a grant. Absent on an older faucet. */
  funder?: PayerHealth;
  /** Pays the rent of an auction opened on demand. */
  opener?: PayerHealth;
  /** The window and freeze an on-demand auction is opened with. */
  window?: { slots: number; freezeSlots: number };
  /** One grant per wallet per this long. */
  cooldownMins?: number;
}

const listeners = new Set<(h: FaucetHealth | null) => void>();
let last: FaucetHealth | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function load() {
  fetch(`${FAUCET_URL}/api/faucet/health`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((h: FaucetHealth | null) => {
      last = h;
      for (const l of listeners) l(h);
    });
}

/** The faucet's health, polled every minute while anything on the page shows it. */
export function useFaucetHealth(): FaucetHealth | null {
  const [h, setH] = useState<FaucetHealth | null>(last);
  useEffect(() => {
    listeners.add(setH);
    if (listeners.size === 1) {
      load();
      timer = setInterval(() => !document.hidden && load(), 60_000);
    }
    return () => {
      listeners.delete(setH);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return h;
}

/** Re-read now — after a grant, so the count and the card agree with what just happened. */
export const refreshFaucetHealth = load;

/** Why the faucet cannot fund a new wallet right now, in words, or null if it can. */
export function faucetBlocked(h: FaucetHealth | null): string | null {
  if (!h) return null;
  if (h.funder && !h.funder.canPay) {
    return `The faucet's funding wallet is out of devnet SOL: it holds ${fmtSol(h.funder.sol)} SOL and one request needs up to ${fmtSol(h.funder.perRequestSol)} SOL. It can't fund wallets until it is topped up.`;
  }
  const cap = h.capacityLeft;
  if (cap && (cap.grants <= 0 || cap.sol <= 0)) return "The faucet has reached its limit for now, so it can't fund new wallets.";
  return null;
}
