#!/usr/bin/env bash
# Builds the web app into site/app/ and packs site/ into dist/dead-man-switch-site-<version>.tar.gz.
# Run from anywhere; needs .refs/crt (CRT clone) and `npm ci` done in app/.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

# 1. refuse placeholders (FILL_ME, placeholder, not a ckt1/ckb1 address)
node -e '
  const fs = require("node:fs");
  let bad = 0;
  for (const [net, prefix, required] of [["testnet", "ckt1", true], ["mainnet", "ckb1", false]]) {
    const c = JSON.parse(fs.readFileSync(`config/${net}.json`, "utf8"));
    if (!required && c.enabled === false) continue;
    const a = String(c.organiser_address || "");
    if (!a.startsWith(prefix) || !/^[a-z0-9]+$/.test(a) || /fill_me|placeholder|replace|todo|xxx/i.test(a)) {
      console.error(`config/${net}.json: organiser_address is a placeholder or not a ${prefix} address (FILL_ME). Set it, see docs/manual-steps.md step 1.`);
      bad = 1;
    }
  }
  process.exit(bad);
'

# 2. vendor CRT files, build app/, sync config, copy into site/app/ (npm run build does all four)
[ -d "$root/.refs/crt" ] || git clone --depth 1 --branch main https://github.com/psawyerberlin/ckb-revocable-timelock "$root/.refs/crt"
( cd app && npm run build )
bash scripts/sync-config.sh

# 3. BUILD record
version="$(node -p 'require("./app/package.json").version')"
commit="$(git rev-parse HEAD 2>/dev/null || echo unknown)"
crt_commit="$(git -C "$root/.refs/crt" rev-parse HEAD 2>/dev/null || echo unknown)"
printf 'commit %s\ncrt %s\nversion %s\ndate %s\n' "$commit" "$crt_commit" "$version" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > site/app/BUILD

# 4. no external references (same check as the acceptance test)
node -e '
  const fs = require("node:fs"), path = require("node:path");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const built = walk("site/app").filter((f) => /\.(js|html|css)$/.test(f)).map((f) => fs.readFileSync(f, "utf8")).join("\n");
  const urls = [...new Set([...built.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0].toLowerCase()))];
  const allowed = /ckb\.dev|chainsolution\.net|joy\.id|joyid\.dev|w3\.org|localhost|127\.0\.0\.1|nervos\.org|github\.com|faucet/;
  const bad = urls.filter((u) => !allowed.test(u));
  if (bad.length) { console.error("external references in site/app: " + bad.join(", ")); process.exit(1); }
  if (/googletagmanager|google-analytics|plausible|sentry\.io|fonts\.googleapis/.test(built)) { console.error("analytics or font CDN reference in site/app"); process.exit(1); }
'

# 5. archive
mkdir -p dist
out="dist/dead-man-switch-site-$version.tar.gz"
tar -czf "$out" site
echo "built site/app ($commit), archive $out"
