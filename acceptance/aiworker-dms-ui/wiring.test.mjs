// Acceptance for aiworker/03-dms-ui.md (SPEC.md 2.0). Run from the repository root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? (['node_modules', 'dist', '.git'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));

test('routes and screens', () => {
  const src = walk('app/src/ui').filter((f) => /\.(ts|html)$/.test(f)).map((f) => read(f)).join('\n');
  for (const r of ['#/write', '#/mine', '#/checkin', '#/open', '#/open/demo', '#/drill', '#/drill/report', '#/guide', '#/privacy', '#/about']) assert.ok(src.includes(r), `route ${r}`);
  for (const k of ['rhythm.consequence', 'guardians.mandatory_trade', 'guardians.ack_phrase', 'mine.headroom_sentence', 'seal.saved_checkbox', 'cancel.consequence', 'heartbeat.title', 'heartbeat.tradeoff', 'price.monthly', 'recipients.title', 'handover.link_label', 'owner_code.title', 'drill.ribbon', 'checkin.not_owner', 'away.title', 'archive.warning']) assert.ok(src.includes(k), `i18n key ${k} used`);
  assert.match(src, /requireCrt:\s*true/);
  assert.match(src, /claim/);
  assert.match(src, /prefers-reduced-motion|reduced-motion|matchMedia/);
});

test('design system of SPEC.md §8', () => {
  const tokens = read('app', 'src', 'ui', 'tokens.css');
  for (const t of ['--paper', '--sheet', '--ink', '--ink-soft', '--line', '--seal', '--seal-ink', '--gold', '--ok', '--warn', '--danger']) assert.ok(tokens.includes(t), `token ${t}`);
  assert.match(tokens, /prefers-color-scheme:\s*dark/);
  for (const c of ['button', 'sheet', 'field', 'stepper', 'ring', 'seal', 'constellation', 'ribbon', 'dialog', 'toast']) {
    assert.ok(walk('app/src/ui/components').some((f) => path.basename(f).startsWith(c)), `component ${c}`);
  }
  assert.ok(walk('app/src/ui/illustrations').filter((f) => /\.(ts|svg)$/.test(f)).length >= 5, 'five illustrations');
  const pkg = JSON.parse(read('app', 'package.json'));
  assert.ok(Object.keys(pkg.devDependencies || {}).some((d) => /^@fontsource(-variable)?\//.test(d)), 'self-hosted serif from @fontsource');
  assert.ok(walk('site/app').some((f) => f.endsWith('.woff2')), 'font shipped with the build');
});

test('handover guides for the ten places', () => {
  const [en, fr, de] = ['en', 'fr', 'de'].map((l) => JSON.parse(read('app', 'src', 'i18n', `${l}.json`)));
  const places = [...new Set(Object.keys(en).filter((k) => /^guide\.[a-z_]+\.step\d+$/.test(k)).map((k) => k.split('.')[1]))];
  assert.ok(places.length >= 10, `ten places, found ${places.length}`);
  for (const p of places) for (const j of [fr, de]) assert.ok(j[`guide.${p}.step1`], `guide ${p} in all languages`);
});

test('no hard-coded user-facing strings outside i18n (heuristic)', () => {
  const files = walk('app/src').filter((f) => /\.ts$/.test(f) && !f.includes('/i18n/') && !/\.test\.ts$/.test(f));
  const offenders = [];
  for (const f of files) {
    for (const [i, line] of read(f).split('\n').entries()) {
      if (/console\.|https?:\/\/|querySelector|getElementById|import |from '|aria-|data-|\/\/|\* /.test(line)) continue;
      const m = line.match(/(['"`])([A-ZÀ-Ü][a-zà-ü]+ [a-zà-ü]+[^'"`]*)\1/);
      if (m && !/^(text\/|application\/)/.test(m[2])) offenders.push(`${f}:${i + 1}: ${m[2].slice(0, 40)}`);
    }
  }
  assert.deepEqual(offenders, [], 'hard-coded strings found');
});

test('built app is static and self-contained', () => {
  assert.ok(exists('site', 'app', 'index.html'));
  assert.ok(exists('site', 'app', 'config', 'testnet.json'), 'config synced into the build');
  assert.ok(exists('site', 'app', 'deployments', 'testnet-runners.json'), 'CRT runner list vendored');
  const built = walk('site/app').filter((f) => /\.(js|html|css)$/.test(f)).map((f) => read(f)).join('\n');
  const external = [...new Set([...built.matchAll(/https?:\/\/[a-z0-9.-]+/gi)].map((m) => m[0].toLowerCase()))];
  const allowed = /ckb\.dev|chainsolution\.net|joy\.id|joyid\.dev|w3\.org|localhost|127\.0\.0\.1|nervos\.org|github\.com|faucet/;
  for (const u of external) assert.match(u, allowed, `external reference ${u}`);
  assert.doesNotMatch(built, /googletagmanager|google-analytics|plausible|sentry\.io|fonts\.googleapis/);
});

test('docs', () => {
  assert.ok(exists('docs', 'app.md'));
  assert.match(read('CHANGELOG.md'), /app|ui/i);
});
