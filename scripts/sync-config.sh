#!/usr/bin/env bash
# Copies config/*.json to app/public/config/ and, when site/app/ exists, to site/app/config/
# (a fee change needs no rebuild, SPEC.md §4.6).
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
targets=("$root/app/public/config")
[ -d "$root/site/app" ] && targets+=("$root/site/app/config")
for t in "${targets[@]}"; do
  mkdir -p "$t"
  cp "$root"/config/*.json "$t/"
  echo "synced config to $t"
done
