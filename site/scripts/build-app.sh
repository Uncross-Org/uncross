#!/bin/sh
# Rebuilds the trading dashboard (web/) into site/public/app so the Next site
# serves it at /app. The dashboard is a separate Vite app; Vercel only uploads
# site/, so its built output is committed here rather than built on deploy.
# It is built without VITE_DEVNET_RPC on purpose: that value would be inlined
# into the browser bundle, and the dedicated endpoint's URL carries an API key.
set -e
cd "$(dirname "$0")/../../web"
# One ticker registry, copied rather than imported: Vercel uploads site/ only.
cp ../uncross/scripts/tickers.json src/tickers.json
cp ../uncross/scripts/tickers.json ../site/lib/uncross/tickers.json
npx tsc --noEmit -p .
npx vite build --base=/app/ --outDir ../site/public/app --emptyOutDir
