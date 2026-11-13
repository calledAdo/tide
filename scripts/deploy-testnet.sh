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
CONTRACT_FUND="${CONTRACT_FUND:-3.5 NEAR}"
BOAT_FUND="${BOAT_FUND:-0.5 NEAR}"
if [[ "$DRY_RUN" == "1" ]]; then
  MASTER="${MASTER:-example.testnet}"
else
  : "${MASTER:?MASTER is required (an existing funded testnet account)}"
fi

if ! [[ "$SEASON_SEC" =~ ^[0-9]+$ ]] || (( SEASON_SEC < 30 )); then
  printf 'SEASON_SEC must be an integer of at least 30 seconds\n' >&2
  exit 1
fi

parse_near_amount() {
  local amount="$1"
  if [[ "$amount" =~ ^([0-9]+([.][0-9]+)?|[.][0-9]+)[[:space:]]+NEAR$ ]]; then
    printf '%s\n' "${BASH_REMATCH[1]}"
  else
    return 1
  fi
}

CONTRACT_FUND_NEAR="$(parse_near_amount "$CONTRACT_FUND")" || {
  printf 'CONTRACT_FUND must be a non-negative NEAR amount such as "3.5 NEAR"\n' >&2
  exit 1
}
BOAT_FUND_NEAR="$(parse_near_amount "$BOAT_FUND")" || {
  printf 'BOAT_FUND must be a non-negative NEAR amount such as "0.5 NEAR"\n' >&2
  exit 1
}

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
  run_command near account create-account fund-myself "$1" "$2" \
    autogenerate-new-keypair save-to-legacy-keychain sign-as "$MASTER" \
    network-config testnet sign-with-legacy-keychain send
}

check_master_balance() {
  local balance_output balance_near required_near

  if ! balance_output="$(near account view-account-summary "$MASTER" network-config testnet now 2>&1)"; then
    printf 'Warning: could not read %s balance; continuing without the balance check.\n' "$MASTER" >&2
    return 0
  fi

  balance_near="$(printf '%s\n' "$balance_output" |
    sed -E $'s/\033\\[[0-9;]*m//g' |
    awk '
      /Native account balance/ {
        for (i = 1; i <= NF; i++) {
          if ($i ~ /^[0-9]+([.][0-9]+)?$/ || $i ~ /^[.][0-9]+$/) {
            print $i
            exit
          }
        }
      }
    '
  )"
  if [[ -z "$balance_near" ]]; then
    printf 'Warning: could not parse %s balance; continuing without the balance check.\n' "$MASTER" >&2
    return 0
  fi

  required_near="$(awk -v total="$TOTAL_FUND_NEAR" 'BEGIN { printf "%.8f", total + 0.5 }')"
  if awk -v balance="$balance_near" -v required="$required_near" 'BEGIN { exit !(balance < required) }'; then
    printf 'Insufficient balance: %s has %s NEAR, but at least %s NEAR is required for funding and gas.\n' \
      "$MASTER" "$balance_near" "$required_near" >&2
    exit 1
  fi
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

TOTAL_FUND_NEAR="$(awk -v contract="$CONTRACT_FUND_NEAR" -v boat="$BOAT_FUND_NEAR" \
  -v boat_count="${#BOATS[@]}" 'BEGIN { printf "%.8f", contract + boat * boat_count }')"
printf 'Total funding: %s NEAR (%s contract + %s x %s boat)\n' \
  "$TOTAL_FUND_NEAR" "$CONTRACT_FUND" "${#BOATS[@]}" "$BOAT_FUND"
if [[ "$DRY_RUN" != "1" ]]; then
  check_master_balance
fi

# The contract account is funded first, then its generated key is used to deploy
# and initialize. The genesis balances are 10,000,000 TIDE per demo account.
create_account "$CONTRACT" "$CONTRACT_FUND"
for boat in "${BOATS[@]}"; do
  create_account "$boat" "$BOAT_FUND"
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
  printf 'DRY_RUN: would write scripts/.env.demo\n'
else
  {
    printf 'CONTRACT=%q\n' "$CONTRACT"
    for i in "${!BOAT_NAMES[@]}"; do
      printf '%s=%q\n' "${BOAT_NAMES[$i]}" "${BOATS[$i]}"
    done
  } > scripts/.env.demo
fi

printf 'Contract id: %s\n' "$CONTRACT"
printf '%s\n' 'Set CONTRACT in app/src/config.ts before deploying the app.'
printf 'Explorer: https://testnet.nearblocks.io/address/%s\n' "$CONTRACT"
printf '%s\n' 'Run ./scripts/demo.sh to drive the six-account ritual after deployment.'
