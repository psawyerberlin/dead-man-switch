// Acceptance for aiworker/03-dms-e2e.md. Run from the repository root. No devnet here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));

test('scenario script', () => {
  const s = read('test', 'e2e', 'scenario.mjs');
  for (const k of [/devnet-e2e\.sh/, /check.?in|renew/i, /cancel/i, /file:\/\//, /PASS|FAIL/]) assert.match(s, k);
});
test('build and deployment', () => {
  const b = read('scripts', 'build-site.sh');
  assert.match(b, /set -euo pipefail/);
  assert.match(b, /site\/app/);
  assert.match(b, /tar/);
  assert.match(read('site', 'DEPLOY.md'), /connect-src/);
  assert.match(read('config', 'testnet.json'), /organiser_address/);
});
test('the manual step is short', () => {
  const ms = read('docs', 'manual-steps.md');
  assert.match(ms, /organiser_address/);
  assert.match(ms, /build-site\.sh/);
  assert.ok(ms.split('\n').filter((l) => /^\s*(\d+\.|-)\s/.test(l)).length <= 6, 'at most six items');
  assert.match(read('DECISIONS.md'), /PASS|devnet/i);
});
