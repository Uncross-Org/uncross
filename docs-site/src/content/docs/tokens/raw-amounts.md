---
title: "Raw amounts and splits"
description: "Why the program stores raw token amounts, never display amounts."
---

:::note[Planned page]
This page is part of the proposed structure and has not been written yet.
:::

**Will cover**

- Scaled-UI multiplier: one raw token is m shares; issuers use it for splits (SPACEX 5×, OPENAI 1.486× scheduled).
- Limits are per raw token; the app converts to per share. Effective multiplier and its scheduled change.

**Sources:** docs/phase2.md · oracle.rs effective_multiplier · web/src/lib/units.ts
