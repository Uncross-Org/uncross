# Chart libraries — what exists, and whether switching would help

Report only. No code has changed. Researched 23 Sept 2026; bundle sizes measured
from bundlephobia (core package, minified + gzip).

## The short answer

**Stay on lightweight-charts and fix the styling. The chart looks thin because
there is little data on it, not because of the library.** No library on this
list adds candles, and backfilling or interpolating them is ruled out.

---

## TradingView — the two products people mean

### Advanced Charts (the full "Charting Library")

The chart on tradingview.com itself: drawing tools, 100+ indicators, the exchange
look everyone recognises.

- **Custom data: yes.** It holds no market data. You connect your own through its
  Datafeed API (or the simpler UDF adapter). Our auction candles would work.
- **Free: yes, conditionally** — for companies building a *public, free* web
  product, with TradingView attribution kept visible.
- **Excluded use:** TradingView's own FAQ says it does not provide Advanced Charts
  *"for personal use, hobbies, studies, or testing."* A devnet hackathon project
  is arguably close to all four.
- **Access:** not a download. The code lives in a private GitHub repo; you request
  access, and the page directs enquiries to platforms@tradingview.com. It is aimed
  at brokers ("connected to the broker's back-end"). **No published approval
  timeline.**
- **Verdict:** the right product in principle, but unlikely to be approved before
  Friday, and at real risk of being refused for this use. Worth applying after the
  hackathon if the project continues as a real venue.

### TradingView widgets (Advanced Chart widget etc.)

**They cannot plot our data. Plainly: widgets show only TradingView's own symbols
and data, and there is no API for feeding in your own.** TradingView's widget FAQ
says so directly and points anyone with custom data to the libraries instead.
The Advanced Chart *widget* could never show an Uncross auction.

---

## Paid and open alternatives

| Library | Custom OHLCV | Looks like an exchange out of the box | Licence / cost | gzip |
|---|---|---|---|---|
| **lightweight-charts** *(current)* | Yes | **Yes — it is TradingView's own renderer** | Apache 2.0, free | **60 KB** |
| Highcharts Stock | Yes | Close — polished, with a range navigator | Commercial. From ~$833 per developer; SaaS team licences typically $3–7k/yr | 99 KB + stock module |
| amCharts 5 Stock | Yes | Close — has drawing tools and indicators | Free *with an amCharts logo on the chart*; one-time paid licence removes it | 92 KB + stock plugin |
| Apache ECharts | Yes | No — general charting, needs substantial styling | Apache 2.0, free | 359 KB (tree-shakeable) |
| ApexCharts | Yes | No — dashboard-style | Free under $2M annual revenue; paid above | 260 KB |

Notes:
- Highcharts and amCharts sizes are the core packages; their stock modules add on
  top.
- **Only lightweight-charts and TradingView Advanced Charts actually look like an
  exchange by default.** Highcharts and amCharts get close with their stock
  modules. ECharts and ApexCharts look like dashboards and would need more work
  than what we have now.

---

## Honest assessment: library, or styling and data?

**Styling and data. Mostly data.**

- **Data density is the main cause.** One candle per auction, one auction about
  every 19 minutes, and the bot seeds only 4 of the 10 tickers with 2–3 orders
  each. On a recent AAPLx capture the chart held **four candles**. Four candles
  look empty in every library on this list, TradingView's included.
- **Styling is the second cause, and cheap to fix.** Blue/orange instead of
  green/red (item 3, queued); the OHLC legend and crosshair readout can be
  tightened; axis and grid weights tuned.
- **The library is not the limit.** lightweight-charts is the rendering engine
  behind TradingView's own charts. Switching to Highcharts or amCharts costs money
  or adds a logo, adds 40–300 KB, and shows the same four candles.

## Recommendation

**Keep lightweight-charts.** Do the styling now (green/red, legend, crosshair,
grid). The real lever for a fuller chart is **more real auctions** — a shorter
cadence or seeding more tickers — which is a product and rent-cost decision, not
a library one. Apply for TradingView Advanced Charts after Friday if the venue
continues past the hackathon.

## Sources

- [TradingView — Free Charting Libraries](https://www.tradingview.com/free-charting-libraries/)
- [TradingView — Advanced Charts](https://www.tradingview.com/advanced-charts/)
- [Advanced Charts documentation — Introduction](https://www.tradingview.com/charting-library-docs/latest/introduction/)
- [Advanced Charts — FAQ](https://www.tradingview.com/charting-library-docs/latest/getting_started/Frequently-Asked-Questions/)
- [Free Advanced Charts Agreement (PDF)](https://s3.amazonaws.com/tradingview/charting_library_license_agreement.pdf)
- [TradingView widgets — Data FAQ](https://www.tradingview.com/widget-docs/faq/data/)
- [Highcharts Stock licensing (ComponentSource)](https://www.componentsource.com/product/highstock/licensing)
- [Highcharts pricing (Vendr)](https://www.vendr.com/marketplace/highcharts-js)
- [amCharts 5 Stock Chart](https://www.amcharts.com/stock-chart/)
- [ApexCharts licence](https://github.com/apexcharts/apexcharts.js/blob/main/LICENSE)
- [Apache ECharts features](https://echarts.apache.org/en/feature.html)
