"use client";

// Motion primitives, reusing the library the template already ships (motion,
// formerly framer-motion) rather than inventing new effects.
//
// The rule here is one effect per section, quiet, never layered: a section
// rises slightly as it enters, the liquidity figures count up once, the hero
// staggers in on load. Nothing loops, nothing bounces.
//
// Every effect has a static equivalent under prefers-reduced-motion — not a
// faster version of the animation, but the finished state rendered directly.
// The page at rest is the page fully readable: sections are never parked at
// opacity 0 waiting for an observer that might not fire.

import { useEffect, useRef, useState } from "react";
import { motion, useInView } from "motion/react";

const EASE = [0.22, 0.61, 0.36, 1] as const;

/**
 * Read the preference from the media query directly.
 *
 * motion's own useReducedMotion() reads its MotionConfig context, whose
 * reducedMotion setting defaults to "never" — so it reported false even when
 * the media query was true, and every "reduced" branch here silently never
 * ran. Measured: with prefers-reduced-motion emulated, matchMedia reported
 * true and the CSS @media rules applied, while the hook still returned false
 * and left all six sections at opacity 0.
 */
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/**
 * A section that rises as it comes into view, once. Under reduced motion it
 * renders in its final state with no transition at all.
 */
export function Reveal({
  children,
  delay = 0,
  className = "",
  as = "div",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section";
}) {
  const reduced = usePrefersReducedMotion();
  const Component = as === "section" ? motion.section : motion.div;

  if (reduced) {
    const Plain = as === "section" ? "section" : "div";
    // The inline style is not decoration, it is the fix. useReducedMotion() is
    // false while rendering on the server, so the animated branch renders
    // first and motion writes opacity:0 inline. On hydration this branch takes
    // over, but it is the same tag in the same position, so React reuses the
    // DOM node — and a branch that sets no style leaves the server's
    // opacity:0 in place forever. Reduced-motion readers saw blank sections.
    return (
      <Plain className={className} data-reveal="static" style={{ opacity: 1, transform: "none" }}>
        {children}
      </Plain>
    );
  }

  return (
    <Component
      data-reveal="animated"
      className={className}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.15, margin: "0px 0px -80px 0px" }}
      transition={{ duration: 0.5, ease: EASE, delay }}
    >
      {children}
    </Component>
  );
}

/** Hero children entering on load, one after another. */
export function Stagger({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduced = usePrefersReducedMotion();
  // Explicit reset for the same reason as Reveal: the server renders the
  // animated branch, and React reuses the node on hydration.
  if (reduced)
    return (
      <div className={className} data-reveal="static" style={{ opacity: 1, transform: "none" }}>
        {children}
      </div>
    );

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="shown"
      variants={{ shown: { transition: { staggerChildren: 0.08 } } }}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const reduced = usePrefersReducedMotion();
  if (reduced)
    return (
      <div className={className} data-reveal="static" style={{ opacity: 1, transform: "none" }}>
        {children}
      </div>
    );

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 12 },
        shown: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A measured figure counting up when it first comes into view. The final value
 * is what matters, so under reduced motion — or before the animation runs —
 * the finished number is what is rendered.
 */
export function CountUp({
  value,
  decimals = 2,
  prefix = "",
  suffix = "",
  duration = 900,
  className = "",
}: {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  duration?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const [shown, setShown] = useState(value);
  const started = useRef(false);

  useEffect(() => {
    if (reduced || !inView || started.current) return;
    started.current = true;
    const from = 0;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / duration);
      // Ease out: fast first, settling onto the real figure.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(step);
      else setShown(value);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [inView, reduced, value, duration]);

  useEffect(() => {
    if (reduced) setShown(value);
  }, [reduced, value]);

  return (
    <span ref={ref} className={className}>
      {prefix}
      {shown.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}
      {suffix}
    </span>
  );
}
