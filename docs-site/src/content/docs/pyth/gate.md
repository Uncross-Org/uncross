---
title: "The on-chain gate"
description: "Eight conditions a Pyth price must meet before the auction may use it."
---

:::note[Planned page]
This page is part of the proposed structure and has not been written yet.
:::

**Will cover**

- The eight conditions, each with why it exists.
- What happens on failure: the auction clears from the book alone; a stale price is never substituted.
- Recorded per auction: oracle_gate code and oracle_publish_time. The full code table (0–10).
- Per-share to per-raw-token conversion with the mint's effective multiplier.

**Sources:** uncross/programs/uncross/src/oracle.rs · docs/pyth.md §4
