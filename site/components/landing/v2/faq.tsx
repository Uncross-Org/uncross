"use client";

// Precision: what it does and what it doesn't, as questions. The words are
// unchanged. The mechanics are the template's FAQ block — one question open at
// a time, dashed grid lines framing the open one and running past its edges —
// on our tokens. Under prefers-reduced-motion the answer appears without
// animating its height.

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Container } from "@/components/container";
import { SectionHead } from "@/components/landing/sections";

const FAQ = [
  {
    q: "Why does it run on devnet?",
    a: "Because devnet is where the issuer's powers can be tested. On mainnet only the issuer can pause AAPLx or change its multiplier. Here the mints are built to match the real AAPLx and IBMx extension for extension, with authorities we hold, so both were run for real in the middle of an auction. Balances are test tokens; the liquidity evidence on this page comes from live mainnet reads.",
  },
  {
    q: "Does the cross price prove anything about price discovery?",
    a: "No, and the page says so beside the number. Devnet orders come from our test bot, which prices them around Pyth, so a cross landing near Pyth shows the bot following its instructions. What the cross does demonstrate is the mechanism: one price, every order filled at it, escrow conserved to the unit.",
  },
  {
    q: "Does Uncross use Pyth to set the price?",
    a: "No. The price is the one that trades the most shares. Pyth only breaks an exact tie, and only when its price is fresh. On devnet there is no live Pyth price, so that rule has run only in unit tests built from the real mainnet account's bytes.",
  },
  {
    q: "What can the token issuer do to my escrow?",
    a: "Pause the token, which freezes settlement and share refunds until it lifts, though dollar refunds still work. And move or burn tokens from any account, escrow included, through a permanent delegate built into these mints.",
  },
  {
    q: "Why aren't PreStocks supported?",
    a: "Every PreStocks mint charges a 0.5% fee on every transfer, and it is active now. Escrow would receive less than was recorded, so settlement would come up short. Custody works; the fee is the problem.",
  },
  {
    q: "Does the Pyth feed stop after the 4pm close?",
    a: "Not in the window measured. Checked every five minutes for 10h38m, through the close and the overnight, the AAPL feed's latest print was at most 14 seconds old at all 80 checks — while its own schedule called the market closed. Weekends were not measured.",
  },
];

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

/** A dashed hairline that runs past the box it frames, fading at its ends. */
export function GridLine({ axis, className = "", offset = "100px" }: { axis: "x" | "y"; className?: string; offset?: string }) {
  const horizontal = axis === "x";
  return (
    <div
      aria-hidden="true"
      style={
        {
          "--offset": offset,
          "--dash": "5px",
          "--fade-stop": "90%",
          maskComposite: "exclude",
        } as React.CSSProperties
      }
      className={
        (horizontal
          ? "absolute left-[calc(var(--offset)/2*-1)] h-px w-[calc(100%+var(--offset))] bg-[linear-gradient(to_right,var(--line-strong),var(--line-strong)_50%,transparent_0,transparent)] bg-[length:var(--dash)_1px] [mask:linear-gradient(to_left,var(--bg)_var(--fade-stop),transparent),linear-gradient(to_right,var(--bg)_var(--fade-stop),transparent),linear-gradient(black,black)]"
          : "absolute top-[calc(var(--offset)/2*-1)] h-[calc(100%+var(--offset))] w-px bg-[linear-gradient(to_bottom,var(--line-strong),var(--line-strong)_50%,transparent_0,transparent)] bg-[length:1px_var(--dash)] [mask:linear-gradient(to_top,var(--bg)_var(--fade-stop),transparent),linear-gradient(to_bottom,var(--bg)_var(--fade-stop),transparent),linear-gradient(black,black)]") +
        " [mask-composite:exclude] z-10 " +
        className
      }
    />
  );
}

export function FaqV2() {
  const reduced = usePrefersReducedMotion();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Container as="section" id="faq" className="py-16 md:py-24">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <SectionHead eyebrow="Precision" title="What it does, and what it doesn't." />
        <div className="flex flex-col gap-2">
          {FAQ.map(({ q, a }, i) => {
            const on = open === i;
            return (
              <div key={q} className={`relative rounded-lg transition-colors ${on ? "bg-surface" : "hover:bg-raise"}`}>
                {on && (
                  <div className="pointer-events-none absolute inset-0">
                    <GridLine axis="x" className="-top-px" />
                    <GridLine axis="x" className="-bottom-px" />
                    <GridLine axis="y" className="-left-px" />
                    <GridLine axis="y" className="-right-px left-auto" />
                  </div>
                )}
                <button
                  type="button"
                  aria-expanded={on}
                  onClick={() => setOpen(on ? null : i)}
                  className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left text-[17px] font-semibold text-text"
                >
                  {q}
                  <span
                    aria-hidden="true"
                    className={`num shrink-0 text-xl text-muted ${reduced ? "" : "transition-transform"} ${on ? "rotate-45" : ""}`}
                  >
                    +
                  </span>
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div
                      initial={reduced ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={reduced ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: reduced ? 0 : 0.18, ease: "easeInOut" }}
                      className="overflow-hidden"
                    >
                      <p className="max-w-[62ch] px-4 pb-4 text-[15px] text-text-2">{a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </Container>
  );
}
