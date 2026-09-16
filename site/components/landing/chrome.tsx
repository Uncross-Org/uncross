// Navbar and footer for the landing page. The Devnet badge is visible,
// unapologetic, and never hidden behind a hover or a link.

import Link from "next/link";
import { Container } from "@/components/container";
import { ModeToggle } from "@/components/mode-toggle";
import { PROGRAM_ID } from "@/lib/uncross/config";

function Wordmark() {
  return (
    <span className="display flex items-center gap-2.5 text-[22px] leading-none font-bold" style={{ fontStretch: "125%" }}>
      <span
        aria-hidden="true"
        className="inline-block size-[18px] bg-linear-135 from-bid from-50% to-ask to-50%"
        style={{ clipPath: "polygon(0 0, 100% 0, 0 100%, 100% 100%)" }}
      />
      Uncross
    </span>
  );
}

export function Navbar() {
  return (
    <Container as="nav" className="flex h-16 items-center justify-between gap-4">
      <Link href="/" aria-label="Uncross home">
        <Wordmark />
      </Link>

      <div className="hidden gap-7 text-sm text-text-2 md:flex">
        <a href="#how" className="hover:text-text">
          How it works
        </a>
        <a href="#liquidity" className="hover:text-text">
          Liquidity
        </a>
        <a href="#live" className="hover:text-text">
          Live
        </a>
        <a href="#faq" className="hover:text-text">
          FAQ
        </a>
      </div>

      <div className="flex items-center gap-3">
        <span className="num hidden rounded-md border border-line px-2.5 py-1.5 text-xs tracking-[0.06em] text-text-2 uppercase sm:inline">
          Devnet
        </span>
        <ModeToggle />
        <Link
          href="/app"
          className="rounded-lg bg-cta-bg px-4 py-2.5 text-sm font-semibold text-cta-fg transition active:scale-[0.98]"
        >
          Open the app →
        </Link>
      </div>
    </Container>
  );
}

export function Footer() {
  return (
    <Container
      as="footer"
      className="num flex flex-wrap justify-between gap-4 py-10 text-[13px] text-muted md:py-14"
    >
      <span>
        Uncross · program {PROGRAM_ID.slice(0, 4)}…{PROGRAM_ID.slice(-4)} · Solana devnet
      </span>
      <span className="flex gap-5">
        <a className="hover:text-text-2" href="https://github.com/Uncross-Org/uncross" target="_blank" rel="noreferrer">
          GitHub
        </a>
        <span>Stocklana 2026</span>
      </span>
    </Container>
  );
}
