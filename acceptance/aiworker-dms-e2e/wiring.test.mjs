// Acceptance for aiworker/04-dms-e2e.md (SPEC.md 2.0). Run from the repository root. No devnet here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('scenario script', () => {
  const s = read('test', 'e2e', 'scenario.mjs');
  for (const k of [/devnet-e2e\.sh/, /claim/, /check.?in|renew/i, /cancel/i, /file:\/\//, /PASS|FAIL/, /smtp/i, /notifier/i, /grace|alarm/i, /link/])
    assert.match(s, k);
});

test('build and deployment', () => {
  const b = read('scripts', 'build-site.sh');
  assert.match(b, /set -euo pipefail/);
  assert.match(b, /site\/app/);
  assert.match(b, /tar/);
  assert.match(b, /FILL_ME|placeholder/i);
  const c = read('deploy', 'Caddyfile.snippet');
  assert.match(c, /dead-man-switch\.chainsolution\.net/);
  assert.match(c, /\/sites\/dead-man-switch/);
  assert.match(c, /reverse_proxy\s+dms-notifier:8787/);
  assert.match(c, /Content-Security-Policy/);
  assert.match(c, /connect-src 'self'/);
  assert.match(c, /frame-src https:\/\/\*\.joy\.id/);
  const d = read('deploy', 'README.md');
  assert.match(d, /~\/src\/dead-man-switch\/site:\/sites\/dead-man-switch:ro/);
  assert.match(d, /caddy validate/);
  assert.match(d, /SPF|DKIM/);
  assert.match(read('config', 'testnet.json'), /organiser_address/);
});

test('the manual step is short', () => {
  const ms = read('docs', 'manual-steps.md');
  assert.match(ms, /organiser_address/);
  assert.match(ms, /build-site\.sh/);
  assert.match(ms, /dms-notifier\.env/);
  assert.match(ms, /drill/i);
  assert.doesNotMatch(ms, /\/path\/to\//, 'real paths, no placeholders');
  assert.ok(ms.split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length <= 6, 'at most six numbered items');
  assert.match(read('DECISIONS.md'), /PASS|devnet/i);
});
