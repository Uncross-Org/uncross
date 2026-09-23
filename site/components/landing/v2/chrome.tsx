"use client";

// Navbar and footer for the redesign. The nav is full-width at the top of the
// page and, once the page has scrolled, becomes a narrower floating bar with a
// blurred ground — the resizable-navbar's mechanics, on our tokens, without
// its 40% squeeze (our items would not fit). The Devnet badge is visible,
// unapologetic, and never hidden behind a hover or a link. Under reduced
// motion the bar changes state without animating.

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Container } from "@/components/container";
import { ModeToggle } from "@/components/mode-toggle";
import { PROGRAM_ID, explorerAddr } from "@/lib/uncross/config";
import { BrandMark } from "@/components/brand-mark";

const GITHUB = "https://github.com/Uncross-Org/uncross";
const LINKS = [
  ["#how", "How it works"],
  ["#pyth", "Pyth"],
  ["#live", "Live"],
  ["#faq", "FAQ"],
] as const;

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function Wordmark() {
  return (
    <span className="display flex items-center gap-2.5 text-[22px] leading-none font-bold text-text" style={{ fontStretch: "125%" }}>
      <BrandMark className="h-[20px] w-[24px] shrink-0" />
      Uncross
    </span>
  );
}

export function NavbarV2() {
  const reduced = usePrefersReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 80);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <div className="sticky top-0 z-40 w-full" style={{ top: "env(safe-area-inset-top, 0px)" }}>
      <motion.nav
        aria-label="Site"
        animate={{
          maxWidth: scrolled ? "72rem" : "100%",
          y: scrolled ? 12 : 0,
          borderRadius: scrolled ? 16 : 0,
          backgroundColor: scrolled ? "color-mix(in oklab, var(--bg) 82%, transparent)" : "color-mix(in oklab, var(--bg) 100%, transparent)",
          boxShadow: scrolled ? "0 12px 40px -20px rgba(11,14,20,0.35), 0 0 0 1px var(--line)" : "0 0 0 0 transparent",
        }}
        transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 32 }}
        style={{ backdropFilter: scrolled ? "blur(12px)" : "none", WebkitBackdropFilter: scrolled ? "blur(12px)" : "none" }}
        className="mx-auto w-full"
      >
        <Container className="flex h-16 items-center justify-between gap-4">
          <Link href="/" aria-label="Uncross home">
            <Wordmark />
          </Link>

          <div className="hidden gap-7 text-sm text-text-2 md:flex">
            {LINKS.map(([href, label]) => (
              <a key={href} href={href} className="hover:text-text">
                {label}
              </a>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <span className="num hidden rounded-md border border-line px-2.5 py-1.5 text-xs tracking-[0.06em] text-text-2 uppercase sm:inline">
              Devnet
            </span>
            <ModeToggle />
            <Link
              href="/app"
              className="hidden rounded-lg bg-cta-bg px-4 py-2.5 text-sm font-semibold text-cta-fg transition active:scale-[0.98] sm:inline-block"
            >
              Open the app →
            </Link>
            <button
              type="button"
              aria-expanded={menu}
              aria-label={menu ? "Close menu" : "Open menu"}
              onClick={() => setMenu((m) => !m)}
              className="num rounded-md border border-line px-2.5 py-1.5 text-xs text-text-2 md:hidden"
            >
              {menu ? "close" : "menu"}
            </button>
          </div>
        </Container>
        {menu && (
          <Container className="flex flex-col gap-1 border-t border-line pb-3 md:hidden">
            {LINKS.map(([href, label]) => (
              <a key={href} href={href} onClick={() => setMenu(false)} className="py-2.5 text-[15px] text-text-2">
                {label}
              </a>
            ))}
            <Link href="/app" className="mt-1 rounded-lg bg-cta-bg px-4 py-2.5 text-center text-sm font-semibold text-cta-fg">
              Open the app →
            </Link>
          </Container>
        )}
      </motion.nav>
    </div>
  );
}

const COLUMNS: { head: string; links: [string, string, boolean?][] }[] = [
  {
    head: "Product",
    links: [
      ["/app", "Open the app"],
      ["#how", "How it works"],
      ["#live", "Live auction"],
      ["#faq", "What it does and doesn't"],
    ],
  },
  {
    head: "Evidence",
    links: [
      ["#problem", "Liquidity, measured on mainnet"],
      ["#pyth", "The Pyth gate, applied live"],
      [`${GITHUB}/blob/main/docs/pyth.md`, "docs/pyth.md", true],
      [`${GITHUB}/blob/main/docs/data/pyth-aapl-watch-2026-09-15.log`, "the 80-check log", true],
    ],
  },
  {
    head: "Source",
    links: [
      [GITHUB, "GitHub", true],
      [`${GITHUB}/blob/main/README.md`, "README", true],
      [explorerAddr(PROGRAM_ID), "Program on the explorer", true],
    ],
  },
];

export function FooterV2() {
  return (
    <footer className="border-t border-line bg-raise">
      <Container className="py-12 md:py-16">
        <div className="grid gap-10 md:grid-cols-[1.2fr_1fr_1fr_1fr]">
          <div>
            <Wordmark />
            <p className="mt-4 max-w-[34ch] text-[13.5px] leading-relaxed text-text-2">
              A periodic uniform-price call auction for thin tokenized stocks. Everyone who wants to trade in the same
              few minutes fills at one price.
            </p>
            <div className="num mt-4 text-[12px] text-muted">
              program {PROGRAM_ID.slice(0, 4)}…{PROGRAM_ID.slice(-4)} · Solana devnet · Stocklana 2026
            </div>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.head}>
              <div className="eyebrow mb-4">{c.head}</div>
              <ul className="flex flex-col gap-2.5 text-[14px]">
                {c.links.map(([href, label, ext]) => (
                  <li key={href}>
                    <a
                      href={href}
                      target={ext ? "_blank" : undefined}
                      rel={ext ? "noreferrer" : undefined}
                      className="text-text-2 hover:text-text"
                    >
                      {label}
                      {ext ? " ↗" : ""}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="num mt-10 border-t border-line pt-6 text-[12px] text-muted">
          Devnet only, by design. Balances are test tokens; liquidity figures are live reads of mainnet pools.
        </p>
      </Container>
    </footer>
  );
}
