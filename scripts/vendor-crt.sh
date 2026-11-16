#!/usr/bin/env bash
# Copies CRT's deployment and runner files into app/public/deployments/ and records the CRT commit.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
crt="${CRT_DIR:-$root/.refs/crt}"
out="$root/app/public/deployments"
[ -d "$crt/deployments" ] || { echo "missing $crt/deployments (clone the CRT repository to .refs/crt)" >&2; exit 1; }
mkdir -p "$out"
for net in testnet mainnet; do
  [ -f "$crt/deployments/$net.json" ] || { echo "missing $crt/deployments/$net.json" >&2; exit 1; }
  cp "$crt/deployments/$net.json" "$out/$net.json"
  src="$crt/deployments/$net-runners.json"
  if [ -f "$src" ]; then
    node -e '
      const fs = require("node:fs");
      const j = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const list = Array.isArray(j) ? j : j.runners;
      if (!Array.isArray(list)) { console.error("runner list is neither an array nor {runners: [...]}"); process.exit(1); }
      fs.writeFileSync(process.argv[2], JSON.stringify(list, null, 2) + "\n");
    ' "$src" "$out/$net-runners.json"
  else
    echo "[]" > "$out/$net-runners.json"
  fi
done
# the testnet rehearsal deployment (fire drills, GRACE 600 s), when CRT has it
if [ -f "$crt/deployments/testnet-drill.json" ]; then
  cp "$crt/deployments/testnet-drill.json" "$out/testnet-drill.json"
  if [ -f "$crt/deployments/testnet-drill-runners.json" ]; then cp "$crt/deployments/testnet-drill-runners.json" "$out/testnet-drill-runners.json"; else echo "[]" > "$out/testnet-drill-runners.json"; fi
fi
git -C "$crt" rev-parse HEAD > "$out/SOURCE"
echo "vendored CRT $(cat "$out/SOURCE") into $out"
