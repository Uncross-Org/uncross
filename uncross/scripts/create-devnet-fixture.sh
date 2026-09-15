#!/usr/bin/env bash
# Creates the devnet fixture mints used for Phase 1 testing.
#
# The ticker mint replicates, extension-for-extension, what docs/phase0.md Q1
# read live off the real AAPLx mint on mainnet: Token-2022, 8 decimals,
# permanent delegate, transfer hook present with no program set, pausable,
# default-account-state initialized, confidential transfers, metadata pointer
# + token metadata, scaled UI amount config. No transfer fee, matching AAPLx.
#
# The quote mint replicates real USDC's shape: legacy SPL Token, 6 decimals --
# the program has to handle two different token programs in the same auction,
# so the fixture must too.
#
# Deploy wallet ends up holding ticker-fixture tokens (it will place SELL
# orders) plus an empty quote ATA (to receive settlement proceeds). Wallet 2
# ends up holding quote-fixture tokens (it will place BUY orders) plus an
# empty ticker ATA (to receive filled shares). Both ATAs must exist ahead of
# time -- see PlaceOrder's account comments in lib.rs for why.
#
# Run after both devnet wallets are funded with SOL. Requires the CLI keypair
# to be set to the deploy wallet (see Anchor.toml [provider]).
set -euo pipefail

DEPLOY_KEYPAIR="$HOME/.config/solana/uncross/deploy.json"
WALLET2_KEYPAIR="$HOME/.config/solana/uncross/wallet2.json"
DEPLOY_ADDR=$(solana-keygen pubkey "$DEPLOY_KEYPAIR")
WALLET2_ADDR=$(solana-keygen pubkey "$WALLET2_KEYPAIR")

json_addr() { python3 -c "import json,sys; print(json.load(sys.stdin)['commandOutput']['address'])"; }

echo "== Creating ticker fixture mint (Token-2022, AAPLx-extension-identical) =="
TICKER_MINT=$(spl-token create-token --program-2022 \
  --decimals 8 \
  --enable-freeze \
  --default-account-state initialized \
  --enable-permanent-delegate \
  --enable-transfer-hook \
  --enable-pause \
  --enable-confidential-transfers manual \
  --enable-metadata \
  --ui-amount-multiplier 1 \
  --mint-authority "$DEPLOY_ADDR" \
  --fee-payer "$DEPLOY_KEYPAIR" \
  -u devnet \
  --output json | json_addr)
echo "Ticker fixture mint: $TICKER_MINT"

echo "== Initializing metadata on ticker fixture mint =="
spl-token initialize-metadata "$TICKER_MINT" \
  "Apple xStock (devnet fixture)" \
  "AAPLx-fx" \
  "https://example.com/aaplx-fixture-metadata.json" \
  --fee-payer "$DEPLOY_KEYPAIR" \
  -u devnet

echo "== Creating quote fixture mint (legacy SPL Token, USDC-shaped) =="
QUOTE_MINT=$(spl-token create-token \
  --decimals 6 \
  --mint-authority "$DEPLOY_ADDR" \
  --fee-payer "$DEPLOY_KEYPAIR" \
  -u devnet \
  --output json | json_addr)
echo "Quote fixture mint: $QUOTE_MINT"

echo "== Creating and funding token accounts =="
DEPLOY_TICKER_ATA=$(spl-token create-account "$TICKER_MINT" --owner "$DEPLOY_ADDR" --fee-payer "$DEPLOY_KEYPAIR" -u devnet --output json | json_addr)
spl-token mint "$TICKER_MINT" 1000 --mint-authority "$DEPLOY_KEYPAIR" --fee-payer "$DEPLOY_KEYPAIR" -u devnet

DEPLOY_QUOTE_ATA=$(spl-token create-account "$QUOTE_MINT" --owner "$DEPLOY_ADDR" --fee-payer "$DEPLOY_KEYPAIR" -u devnet --output json | json_addr)

WALLET2_QUOTE_ATA=$(spl-token create-account "$QUOTE_MINT" --owner "$WALLET2_ADDR" --fee-payer "$DEPLOY_KEYPAIR" -u devnet --output json | json_addr)
spl-token mint "$QUOTE_MINT" 100000 --mint-authority "$DEPLOY_KEYPAIR" --recipient-owner "$WALLET2_ADDR" --fee-payer "$DEPLOY_KEYPAIR" -u devnet

WALLET2_TICKER_ATA=$(spl-token create-account "$TICKER_MINT" --owner "$WALLET2_ADDR" --fee-payer "$DEPLOY_KEYPAIR" -u devnet --output json | json_addr)

echo "== Done =="
cat > "$(dirname "$0")/devnet-fixture.json" <<JSON
{
  "tickerMint": "$TICKER_MINT",
  "quoteMint": "$QUOTE_MINT",
  "deployTickerAta": "$DEPLOY_TICKER_ATA",
  "deployQuoteAta": "$DEPLOY_QUOTE_ATA",
  "wallet2QuoteAta": "$WALLET2_QUOTE_ATA",
  "wallet2TickerAta": "$WALLET2_TICKER_ATA"
}
JSON
echo "Wrote scripts/devnet-fixture.json"
cat "$(dirname "$0")/devnet-fixture.json"
