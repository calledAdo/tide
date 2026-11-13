#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 sim/tide_sim.py
python3 sim/tide_supply.py
(cd contract && cargo test --lib)

if [[ -f app/scripts/check-sim.cjs ]]; then
  node app/scripts/check-sim.cjs
else
  printf '%s\n' 'NOTICE: app/scripts/check-sim.cjs does not exist; skipping app simulation check.'
fi

printf '%s\n' 'ALL CHECKS PASSED'
