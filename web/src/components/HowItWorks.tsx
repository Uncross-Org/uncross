export function HowItWorks() {
  return (
    <details className="card how">
      <summary>How it works</summary>
      <ol>
        <li>
          <b>Orders collect over one auction window</b> (7,000 slots, roughly half an hour on devnet). Your funds are locked in the auction's own account, not held by anyone.
        </li>
        <li>
          <b>At the cross, everyone trades at one price</b> — the price where the most shares change hands. A buyer never pays above their
          limit, a seller never gets below theirs, and many do better.
        </li>
        <li>
          <b>No racing, no front-running.</b> Arriving first doesn't win; your limit does. The last stretch is a freeze: orders still come
          in, but nobody can pull theirs to game the price.
        </li>
        <li>
          <b>The book sets the price.</b> An outside price could only ever break a tie between equally good clearing prices, and only
          if a fresh Pyth price were on chain at the cross. There is no live Pyth price for these tickers, so every cross clears on
          the book alone.
        </li>
        <li>
          <b>Anyone can finish an auction.</b> Running the cross and settling are open to every wallet; unfilled funds always come back.
        </li>
      </ol>
    </details>
  );
}
