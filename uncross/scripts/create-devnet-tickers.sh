#!/usr/bin/env bash
# Creates devnet fixture mints for the expanded ticker set, each replicating its
# real mainnet xStock: Token-2022, 8 decimals, the same eight extensions as
# AAPLx (docs/devnet-fixture.md), and the real mint's live scaled-UI multiplier
# read from mainnet on 16 September 2026. Appends "<sym>Mint" to
# scripts/devnet-fixture.json. Idempotent per symbol: skips ones already there.
#
#   RPC_URL=<devnet endpoint> scripts/create-devnet-tickers.sh
set -euo pipefail
cd "$(dirname "$0")"
DEPLOY="$HOME/.config/solana/uncross/deploy.json"
W2=$(solana-keygen pubkey "$HOME/.config/solana/uncross/wallet2.json")
URL="${RPC_URL:-https://api.devnet.solana.com}"
addr() { python3 -c "import json,sys; print(json.load(sys.stdin)['commandOutput']['address'])"; }
have() { python3 -c "import json,sys; sys.exit(0 if '$1' in json.load(open('devnet-fixture.json')) else 1)"; }

# symbol|name|multiplier (live mainnet value)
while IFS='|' read -r sym name mult; do
  key="$(echo "$sym" | tr 'A-Z' 'a-z')Mint"
  if have "$key"; then echo "$sym: already in fixture, skipping"; continue; fi
  echo "== $sym (multiplier $mult) =="
  MINT=$(spl-token create-token --program-2022 --decimals 8 --enable-freeze \
    --default-account-state initialized --enable-permanent-delegate --enable-transfer-hook \
    --enable-pause --enable-confidential-transfers manual --enable-metadata \
    --ui-amount-multiplier "$mult" --mint-authority "$(solana-keygen pubkey "$DEPLOY")" \
    --fee-payer "$DEPLOY" -u "$URL" --output json | addr)
  spl-token initialize-metadata "$MINT" "$name (devnet fixture)" "$sym-fx" "https://example.com/$sym-fixture.json" --fee-payer "$DEPLOY" -u "$URL" >/dev/null
  spl-token create-account "$MINT" --fee-payer "$DEPLOY" -u "$URL" >/dev/null
  spl-token mint "$MINT" 1000 --mint-authority "$DEPLOY" --fee-payer "$DEPLOY" -u "$URL" >/dev/null
  spl-token create-account "$MINT" --owner "$W2" --fee-payer "$DEPLOY" -u "$URL" >/dev/null
  python3 - "$key" "$MINT" <<'PY'
import json,sys
p='devnet-fixture.json'; d=json.load(open(p)); d[sys.argv[1]]=sys.argv[2]; json.dump(d,open(p,'w'),indent=2); open(p,'a').write("\n")
PY
  echo "$sym fixture mint: $MINT"
done <<'LIST'
NVDAx|NVIDIA xStock|1.001701196801074
TSLAx|Tesla xStock|1
GOOGLx|Alphabet xStock|1.0023772500603487
MSTRx|MicroStrategy xStock|1
HOODx|Robinhood xStock|1
XOMx|Exxon Mobil xStock|1.017648970535191
JPMx|JPMorgan Chase xStock|1.0139174713894084
ORCLx|Oracle xStock|1.009318667481834
LIST
