export function HowItWorks() {
  return (
    <details className="card how">
      <summary>How it works</summary>
      <ol>
        <li>
          <b>Orders collect for a few minutes.</b> Your funds are locked in the auction's own account, not held by anyone.
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
          <b>When NASDAQ is closed there's no live reference</b> — Pyth stops updating. That's exactly when a thin market needs a fair
          price, and the auction book itself becomes that price. When a live Pyth price exists it's only used to break ties.
        </li>
        <li>
          <b>Anyone can finish an auction.</b> Running the cross and settling are open to every wallet; unfilled funds always come back.
        </li>
      </ol>
    </details>
  );
}
