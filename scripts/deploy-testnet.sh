#!/usr/bin/env bash
set -euo pipefail

# Deploy a keyless testnet instance and create the six accounts used by demo.sh.
# near-cli-rs 0.31 commands in this file were checked with the corresponding
# near subcommand --help output. The generated accounts are saved to the legacy
# keychain because that is also what demo.sh uses for transaction signing.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN="${DRY_RUN:-0}"
SEASON_SEC="${SEASON_SEC:-60}"
if [[ "$DRY_RUN" == "1" ]]; then
  MASTER="${MASTER:-example.testnet}"
else
  : "${MASTER:?MASTER is required (an existing funded testnet account)}"
fi

if ! [[ "$SEASON_SEC" =~ ^[0-9]+$ ]] || (( SEASON_SEC < 30 )); then
  printf 'SEASON_SEC must be an integer of at least 30 seconds\n' >&2
  exit 1
fi

print_command() {
  printf '+ '
  printf '%q ' "$@"
  printf '\n'
}

run_command() {
  print_command "$@"
  if [[ "$DRY_RUN" != "1" ]]; then
    "$@"
  fi
}

run_build() {
  printf '+ (cd contract && cargo near build non-reproducible-wasm)\n'
  if [[ "$DRY_RUN" != "1" ]]; then
    (cd contract && cargo near build non-reproducible-wasm)
  fi
}

create_account() {
  run_command near account create-account fund-myself "$1" "$2 NEAR" \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$MASTER" \
    network-config testnet sign-with-legacy-keychain send
}

STAMP="$(date +%s)"
CONTRACT="tide-${STAMP}.${MASTER}"
WASM="$ROOT_DIR/contract/target/near/tide.wasm"
BOAT_NAMES=(ana ben cy dee eve greedy)
BOATS=()
for name in "${BOAT_NAMES[@]}"; do
  BOATS+=("${name}-${STAMP}.${MASTER}")
done

run_build

# The contract account is funded first, then its generated key is used to deploy
# and initialize. The genesis balances are 10,000,000 TIDE per demo account.
create_account "$CONTRACT" 5
for boat in "${BOATS[@]}"; do
  create_account "$boat" 1
done

GENESIS_JSON="["
for boat in "${BOATS[@]}"; do
  GENESIS_JSON+="[\"${boat}\",\"10000000000000000000000000\"],"
done
GENESIS_JSON="${GENESIS_JSON%,}]"
INIT_JSON="{\"genesis\":${GENESIS_JSON},\"season_len_sec\":${SEASON_SEC},\"faucet_amount\":\"100000000000000000000000\"}"

run_command near contract deploy "$CONTRACT" use-file "$WASM" \
  with-init-call new json-args "$INIT_JSON" prepaid-gas "100 Tgas" \
  attached-deposit "0 NEAR" network-config testnet sign-with-legacy-keychain send

# A newly created account has one full-access key. Delete every key returned by
# the CLI, then verify the account is empty. The dry-run placeholder keeps the
# command sequence visible without making a network call.
if [[ "$DRY_RUN" == "1" ]]; then
  run_command near account list-keys "$CONTRACT" network-config testnet now
  run_command near account delete-keys "$CONTRACT" public-keys \
    ed25519:11111111111111111111111111111111 network-config testnet \
    sign-with-legacy-keychain send
  run_command near account list-keys "$CONTRACT" network-config testnet now
  printf 'CONTRACT IS KEYLESS: %s (dry run; verification skipped)\n' "$CONTRACT"
else
  KEY_OUTPUT="$(near account list-keys "$CONTRACT" network-config testnet now 2>&1)"
  printf '%s\n' "$KEY_OUTPUT"
  CONTRACT_KEYS="$(printf '%s\n' "$KEY_OUTPUT" | grep -oE 'ed25519:[1-9A-HJ-NP-Za-km-z]+' || true)"
  if [[ -z "$CONTRACT_KEYS" ]]; then
    printf 'No contract access keys were returned; refusing to claim keyless state.\n' >&2
    exit 1
  fi
  for key in $CONTRACT_KEYS; do
    run_command near account delete-keys "$CONTRACT" public-keys "$key" \
      network-config testnet sign-with-legacy-keychain send
  done
  KEY_OUTPUT="$(near account list-keys "$CONTRACT" network-config testnet now 2>&1)"
  printf '%s\n' "$KEY_OUTPUT"
  if printf '%s\n' "$KEY_OUTPUT" | grep -qE 'ed25519:[1-9A-HJ-NP-Za-km-z]+'; then
    printf 'Contract still has an access key; refusing to continue.\n' >&2
    exit 1
  fi
  printf 'CONTRACT IS KEYLESS: %s\n' "$CONTRACT"
fi

if [[ "$DRY_RUN" == "1" ]]; then
  printf 'DRY_RUN: would write web/config.js and scripts/.env.demo\n'
else
  {
    printf 'window.TIDE_CONFIG = { network: "testnet", contract: "%s", boats: [' "$CONTRACT"
    for boat in "${BOATS[@]}"; do
      printf '"%s",' "$boat"
    done
    printf '] };\n'
  } > web/config.js

  {
    printf 'CONTRACT=%q\n' "$CONTRACT"
    for i in "${!BOAT_NAMES[@]}"; do
      printf '%s=%q\n' "${BOAT_NAMES[$i]}" "${BOATS[$i]}"
    done
  } > scripts/.env.demo
fi

printf 'Explorer: https://testnet.nearblocks.io/address/%s\n' "$CONTRACT"
printf '%s\n' 'Open web/index.html for demo mode. For live mode use web/index.html?contract=<id>.'
printf '%s\n' 'Run ./scripts/demo.sh to drive the six-account ritual after deployment.'
