#!/bin/zsh
# Wallet runway check. Silent unless a line begins with WARN.
# Lives in the repo because the scratchpad it used to live in was wiped at
# 05:04 UTC on 22 September, taking this and every other harness with it.
set -e
here="${0:A:h}"
source ~/.config/solana/uncross/rpc.env
RPC_URLS="$HELIUS_DEVNET" node "$here/wallet-watch.mjs" "$@" 2>&1 | sed 's/api-key=[^&" ]*/***/g'
