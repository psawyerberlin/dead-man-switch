// Acceptance for aiworker/01-dms-core.md. Run from the repository root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? (['node_modules', 'dist', '.git'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));

test('project and dependencies', () => {
  const pkg = JSON.parse(read('app', 'package.json'));
  for (const s of ['dev', 'build', 'test', 'typecheck', 'lint']) assert.ok(pkg.scripts?.[s], `script ${s}`);
  assert.match(pkg.scripts.build, /site\/app|copy/);
  const deps = Object.keys(pkg.dependencies || {});
  const allowed = /^(@crt\/client|@ckb-ccc\/.*|@noble\/.*|marked|dompurify|micromark.*|isomorphic-dompurify|@joyid\/.*)$/;
  for (const d of deps) assert.match(d, allowed, `runtime dependency ${d} not allowed by SPEC.md §7`);
  assert.ok(exists('app', 'public', 'deployments', 'SOURCE'));
  assert.ok(exists('config', 'testnet.json'));
  assert.ok(exists('config', 'mainnet.json'));
  const t = JSON.parse(read('config', 'testnet.json'));
  for (const k of ['organiser_fee_ckb', 'organiser_address', 'default_t', 'default_n', 'rhythms_months', 'max_vault_bytes', 'faucet_url']) assert.ok(k in t, `config key ${k}`);
  assert.equal(JSON.parse(read('config', 'mainnet.json')).enabled, false);
});

test('core modules and constants', () => {
  for (const m of ['bundle', 'vault', 'calendar', 'i18n', 'price']) assert.ok(exists('app', 'src', 'core', `${m}.ts`), `core/${m}.ts`);
  const src = walk('app/src/core').map((f) => read(f)).join('\n');
  assert.match(src, /DMS-v1/);
  assert.match(src, /AES-GCM/);
  assert.match(src, /generateKit/);
  assert.match(src, /VALARM/);
  assert.match(src, /dead-man-switch/);
  assert.doesNotMatch(src, /skipVerif|insecure|allowUnverified|noVerify/i);
});

test('i18n files: three languages, identical key sets, fixed vocabulary', () => {
  const langs = ['en', 'fr', 'de'].map((l) => [l, JSON.parse(read('app', 'src', 'i18n', `${l}.json`))]);
  const keys = langs.map(([, j]) => Object.keys(j).sort().join('\n'));
  assert.equal(keys[0], keys[1], 'en and fr differ in keys');
  assert.equal(keys[0], keys[2], 'en and de differ in keys');
  const [en, fr, de] = langs.map(([, j]) => j);
  assert.equal(en['word.vault'], 'vault'); assert.equal(fr['word.vault'], 'coffre'); assert.equal(de['word.vault'], 'Tresor');
  assert.equal(en['word.guardians'], 'guardians'); assert.equal(fr['word.guardians'], 'gardiens'); assert.equal(de['word.guardians'], 'Wächter');
  for (const j of [en, fr, de]) for (const k of ['rhythm.consequence', 'guardians.mandatory_trade', 'guardians.ack_phrase', 'mine.headroom_sentence', 'seal.saved_checkbox', 'cancel.consequence']) assert.ok(j[k], `key ${k}`);
});

test('opener is built as a single self-contained bundle', () => {
  assert.ok(exists('app', 'src', 'opener'));
  const src = walk('app/src/opener').map((f) => read(f)).join('\n');
  assert.match(src, /crtApplication/);
  assert.match(src, /onKey/);
  assert.match(src, /crt-application/);
  assert.match(src, /createObjectURL/);
  assert.match(src, /sanitize|DOMPurify|purify|safe/i);
  const cfg = walk('app').filter((f) => /vite\.config.*\.(ts|js|mts|mjs)$/.test(f)).map((f) => read(f)).join('\n');
  assert.match(cfg, /opener/);
  assert.match(cfg, /iife|inlineDynamicImports/);
});

test('docs', () => {
  assert.ok(exists('docs', 'formats.md'));
  assert.ok(exists('app', 'README.md'));
  assert.match(read('CHANGELOG.md'), /core|vault/i);
  assert.ok(exists('DECISIONS.md'));
});
