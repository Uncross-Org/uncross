// The narrative blocks of the landing page: the problem, how it works, what
// it's for, and the precision section.
//
// Every figure in here is measured and carries its source. Nothing claims more
// than the code does.

import { Container } from "@/components/container";
import { CountUp } from "./motion";

export function SectionHead({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede?: string;
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="display max-w-[22ch] text-[30px] leading-[1.05] font-semibold md:text-[44px]">{title}</h2>
      {lede && <p className="max-w-[60ch] text-base text-text-2 md:text-lg">{lede}</p>}
    </div>
  );
}

function Card({
  stat,
  statLabel,
  title,
  children,
  source,
}: {
  stat?: React.ReactNode;
  statLabel?: string;
  title: string;
  children: React.ReactNode;
  source: string;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-6">
      {stat && (
        <div className="display-tight num text-[42px] leading-none font-semibold md:text-[52px]">
          {stat}
          {statLabel && <span className="ml-1.5 text-[0.4em] font-medium tracking-normal text-muted">{statLabel}</span>}
        </div>
      )}
      <h3 className="text-[17px] leading-snug font-semibold">{title}</h3>
      <p className="text-[14.5px] text-text-2">{children}</p>
      <div className="num mt-auto pt-1 text-[11.5px] text-muted">{source}</div>
    </div>
  );
}

/**
 * The problem. The strongest fact here is IBMx: a reference price exists and
 * the trade does not. Phrased as the router declining to route, which is what
 * was measured — not "impossible to trade", which was not.
 */
export function Problem() {
  return (
    <Container as="section" id="problem" className="py-14 md:py-22">
      <SectionHead
        eyebrow="The problem"
        title="A price you can see is not a price you can trade."
        lede="Tokenized stocks quote around the clock. For the thin ones, the quote is the only part that works."
      />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <Card
          stat={<CountUp value={247.14} prefix="$" />}
          title="A price with no route behind it"
          source="Jupiter + DexScreener · 4:02 AM ET, 16 Sep"
        >
          That is the reference price Jupiter publishes for IBMx, which has a live pool holding $1,666. Ask it to
          actually buy and it returns no route — at $10,000, at $100, and at $1. The quote is real; the trade is not
          available at any size.
        </Card>
        <Card
          stat={<CountUp value={2.5} decimals={1} />}
          statLabel="%"
          title="Or a route that charges for being thin"
          source="Jupiter quote · $100 buy · 16 Sep"
        >
          JPMx fills a $100 buy 2.5% above its own reference price, then has no route at $1,000. XOMx fills $1,000 and
          runs out by $10,000. The cost of trading arrives as a cliff, not a slope.
        </Card>
        <Card stat="None" title="No on-chain IBM price at all" source="Pyth push-oracle accounts · shards 0–5">
          There is no Pyth price account for IBM on Solana. For IBMx the only price that can exist on-chain is one a
          book makes.
        </Card>
      </div>
    </Container>
  );
}

const STEPS = [
  { n: "stage 1", h: "Open", p: "A new auction opens for each ticker." },
  { n: "stage 2", h: "Orders", p: "Buy or sell, how many, at what price. Funds wait in escrow." },
  { n: "stage 3", h: "Freeze", p: "The final stretch. No more cancelling.", freeze: true },
  { n: "stage 4", h: "The cross", p: "One price: the one that trades the most shares." },
  { n: "stage 5", h: "Settle", p: "Everyone fills at that price. Unused escrow returns." },
];

const EXAMPLE = [
  { side: "Sell", limit: "$240.00", qty: "10", out: "All 10 sold at $247.50, $7.50 more than asked" },
  { side: "Buy", limit: "$250.00", qty: "10", out: "All 10 bought at $247.50, $25 returned" },
  { side: "Sell", limit: "$245.00", qty: "5", out: "Not filled; shares returned" },
  { side: "Buy", limit: "$243.00", qty: "8", out: "Not filled; money returned" },
];

export function HowItWorks() {
  return (
    <Container as="section" id="how" className="py-14 md:py-22">
      <SectionHead
        eyebrow="How it works"
        title="Collect, freeze, cross, settle. Every few minutes."
        lede="Orders do not trade the moment they arrive. They wait for each other, and then they all trade at once."
      />

      {/* A real sequence, so the numbering carries the order of events rather than decorating them. */}
      <ol className="mt-10 grid grid-cols-1 overflow-hidden rounded-xl border border-line sm:grid-cols-2 lg:grid-cols-5">
        {STEPS.map((s, i) => (
          <li
            key={s.h}
            className={`flex flex-col gap-2 border-line p-5 ${i < STEPS.length - 1 ? "border-b lg:border-r lg:border-b-0" : ""} ${
              s.freeze ? "hatch-freeze" : "bg-surface"
            }`}
          >
            <span className="num text-xs text-muted">{s.n}</span>
            <h3 className="text-base font-semibold">{s.h}</h3>
            <p className="text-sm text-text-2">{s.p}</p>
          </li>
        ))}
      </ol>

      <div className="mt-5 overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <caption className="px-4 pt-4 text-left text-[13px] text-muted">
            One auction, four orders, clearing at $247.50.
          </caption>
          <thead>
            <tr>
              {["Order", "Limit", "Shares", "At the cross of $247.50"].map((h) => (
                <th
                  key={h}
                  className="num border-b border-line px-4 py-3 text-left text-[11.5px] tracking-[0.06em] text-muted uppercase"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EXAMPLE.map((r) => (
              <tr key={r.out}>
                <td className={`border-t border-line px-4 py-3 font-semibold ${r.side === "Buy" ? "text-bid" : "text-ask"}`}>
                  {r.side}
                </td>
                <td className="num border-t border-line px-4 py-3">{r.limit}</td>
                <td className="num border-t border-line px-4 py-3">{r.qty}</td>
                <td className="border-t border-line px-4 py-3 text-text-2">{r.out}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 max-w-[62ch] text-sm text-text-2">
        Nobody trades at a worse price than they asked for, and nobody in an auction gets a worse price than anyone
        else in it.
      </p>
    </Container>
  );
}

export function WhatItsFor() {
  return (
    <Container as="section" className="py-14 md:py-22">
      <SectionHead eyebrow="What it's for" title="For trades a continuous pool handles badly." />
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-6">
          <h3 className="text-[17px] font-semibold">Thin tickers</h3>
          <p className="text-[14.5px] text-text-2">
            Names like IBMx, whose pool holds a few thousand dollars. Orders meet each other instead of walking a
            curve.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-6">
          <h3 className="text-[17px] font-semibold">Hours when the tape is thin</h3>
          <p className="text-[14.5px] text-text-2">
            The reference price keeps printing overnight, but with no session marker you cannot tell a thin print from
            a liquid one. A book that clears on its own orders does not need to.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 rounded-xl border border-line bg-surface p-6">
          <h3 className="text-[17px] font-semibold">Same price, same moment</h3>
          <p className="text-[14.5px] text-text-2">
            Everyone who trades in one auction trades at one price, whatever they each bid or asked.
          </p>
        </div>
      </div>
    </Container>
  );
}

const FAQ = [
  {
    q: "Is this real money?",
    a: "No. It runs on Solana devnet, on mints built to match the real AAPLx and IBMx extension for extension. That is what made it possible to test an issuer pausing the token mid-auction and changing its multiplier — things only the issuer can do on mainnet.",
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
    a: "Not in the window measured. Across 82 samples the AAPL feed published continuously for 10h38m, through the close and the overnight, the oldest print at any check being 14 seconds — while its own schedule called the market closed. Weekends were not measured.",
  },
];

export function Faq() {
  return (
    <Container as="section" id="faq" className="py-14 md:py-22">
      <div className="grid gap-10 lg:grid-cols-[1fr_1.6fr]">
        <SectionHead eyebrow="Precision" title="What it does, and what it doesn't." />
        <div>
          {FAQ.map(({ q, a }) => (
            <details key={q} className="group border-t border-dashed border-line py-4 first:border-t-0">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-[17px] font-semibold">
                {q}
                <span className="num shrink-0 text-xl text-muted transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2.5 max-w-[62ch] text-[15px] text-text-2">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </Container>
  );
}
