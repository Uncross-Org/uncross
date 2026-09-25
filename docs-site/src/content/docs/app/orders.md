---
title: Orders page
description: Every order a wallet has placed on Uncross, on any ticker, and what each came to.
---

**Your orders**, in the tabs at the top of the app, lists every order your wallet has placed, on every ticker. Each row is one order and what it came to at its auction's clearing price.

The list is complete because it is read from your wallet's own order accounts, which are never closed. It refreshes every 10 seconds.

## Tabs

| Tab | Shows |
|---|---|
| **Open** | Orders in an auction that has not crossed yet (Open or Frozen) |
| **History** | Every order whose auction has crossed, or that you cancelled |
| **Fills** | Orders that traded, in full or in part |
| **Cancelled / unfilled** | Orders that traded nothing: Unfilled, Cancelled or Refunded. Everything they locked came back. |
| **All** | Every order |

## Columns

| Column | What it is |
|---|---|
| Placed | When the order was placed |
| Asset, Side | The ticker, and buy or sell |
| Status | One of the seven [order statuses](/mechanism/order-statuses/) |
| Limit | Your max or min price per share |
| Filled / asked | Shares that traded, out of shares asked |
| Clearing price | The auction's price |
| Paid / received | What a buy paid, or a sell received |
| Returned | What came back to you |
| Settled | When settlement landed |
| Links | The auction account and the transactions, on Explorer |

Dollar amounts show to the cent and share quantities to four places, so digits line up down each column. Hover over a figure for the exact amount the program settled, to the micro-dollar. Above the table, a line gives the number of orders shown and any filters applied. The figures come from the same place as [your receipt](/app/receipt/). **Copy link** makes a read-only link to this list that anyone can open without a wallet, and each auction links to its auction page. A row rebuilt from its settlement transaction, because its auction has since been closed, is marked.

<p class="sources">Sources: <code>web/src/components/OrdersPage.tsx</code>, <code>web/src/lib/settlement.ts</code>, <code>docs/numbers.md</code>.</p>
