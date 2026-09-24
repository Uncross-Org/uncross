// "Copy link": the page as it is now, with the wallet in the link, so anyone
// can open the same receipt, orders or portfolio read-only without a wallet.

import { useState } from "react";

export function CopyLink({ wallet, label = "Copy link" }: { wallet: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    const u = new URL(window.location.href);
    u.searchParams.set("wallet", wallet);
    u.searchParams.delete("theme");
    try {
      await navigator.clipboard.writeText(u.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt("Copy this link", u.toString());
    }
  }
  return (
    <button className="btn btn-ghost sm copy-link" onClick={copy} title="A read-only link anyone can open, no wallet needed">
      {copied ? "Link copied" : label}
    </button>
  );
}
