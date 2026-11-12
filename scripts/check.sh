#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

python3 sim/tide_sim.py
python3 sim/tide_supply.py
(cd contract && cargo test --lib)

if [[ -f web/check-sim.cjs ]]; then
  node web/check-sim.cjs
else
  printf '%s\n' 'NOTICE: web/check-sim.cjs does not exist yet; skipping web simulation check.'
fi

printf '%s\n' 'ALL CHECKS PASSED'
