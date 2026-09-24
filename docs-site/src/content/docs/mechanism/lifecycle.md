---
title: "Auction lifecycle"
description: "Open, orders and escrow, the freeze, the cross, settlement, refunds and rent reclaim."
---

:::note[Planned page]
This page is part of the proposed structure and has not been written yet.
:::

**Will cover**

- Timeline: open_slot → close_slot − freeze_slots → close_slot; keeper cadence 7,000 slots, freeze 700.
- Table: what you can and cannot do at each stage (place until close; cancel until the freeze; cross and settle permissionless).
- Batched settlement (7 orders per transaction with distinct owners), idempotent batches, one settle path per auction.
- Failure path (cancel_and_refund), close_auction rent reclaim and its refusals.

**Sources:** uncross/programs/uncross/src/lib.rs · docs/phase2.md · docs/railway.md · uncross/scripts/keeper.mjs
