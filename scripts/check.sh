#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

long_lines=$(find app/src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' \) \
  ! -name 'sim.js' -print0 | xargs -0 awk 'length($0) > 110 { count++ } END { print count + 0 }')
if [[ "$long_lines" -ne 0 ]]; then
  printf 'Long-line check failed: %s lines over 110 characters.\n' "$long_lines"
  exit 1
fi
printf 'Long-line check: %s\n' "$long_lines"

python3 sim/tide_sim.py
python3 sim/tide_supply.py
python3 sim/tide_reckoning.py
(cd contract && cargo test --lib)

if [[ -f app/scripts/check-sim.cjs ]]; then
  node app/scripts/check-sim.cjs
else
  printf '%s\n' 'NOTICE: app/scripts/check-sim.cjs does not exist; skipping app simulation check.'
fi

printf '%s\n' 'ALL CHECKS PASSED'
