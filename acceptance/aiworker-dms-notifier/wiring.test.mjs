// Acceptance for aiworker/02-dms-notifier.md. Run from the repository root.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const exists = (...p) => fs.existsSync(path.join(ROOT, ...p));
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? (['node_modules', 'dist', '.git'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : [path.join(dir, e.name)]));

test('package and dependencies', () => {
  const pkg = JSON.parse(read('notifier', 'package.json'));
  for (const s of ['build', 'start', 'test', 'typecheck', 'lint']) assert.ok(pkg.scripts?.[s], `script ${s}`);
  const allowed = /^(@crt\/client|@ckb-ccc\/.*|@noble\/.*|nodemailer)$/;
  for (const d of Object.keys(pkg.dependencies || {})) assert.match(d, allowed, `runtime dependency ${d} not allowed by SPEC.md §9`);
  assert.ok(exists('notifier', 'package-lock.json'));
});

test('modules and the interfaces of the spec', () => {
  for (const m of ['env', 'store', 'crypto', 'api', 'watcher', 'mail', 'log', 'main']) assert.ok(exists('notifier', 'src', `${m}.ts`), `src/${m}.ts`);
  const src = walk('notifier/src').filter((f) => f.endsWith('.ts')).map((f) => read(f)).join('\n');
  assert.match(src, /node:sqlite/);
  assert.match(src, /node:http/);
  assert.match(src, /DMS-v2\/link/);
  assert.match(src, /interface Chain\b/);
  assert.match(src, /interface Mailer\b/);
  assert.match(src, /interface Clock\b/);
  for (const r of ['/claim', '/switch/', '/confirm/', '/stop/', '/health']) assert.ok(src.includes(r), `route ${r}`);
  assert.match(src, /List-Unsubscribe/);
  assert.match(src, /outbox/);
  assert.match(src, /recoverOnline|recoverK/);
  assert.doesNotMatch(src, /express|fastify|koa|hapi/i, 'no web framework');
});

test('emails in three languages with identical keys', () => {
  const [en, fr, de] = ['en', 'fr', 'de'].map((l) => JSON.parse(read('notifier', 'src', 'i18n', `${l}.json`)));
  const k = (j) => Object.keys(j).sort().join('\n');
  assert.equal(k(en), k(fr)); assert.equal(k(en), k(de));
  assert.ok(Object.keys(en).length >= 20, 'emails and pages need their strings');
});

test('environment example carries no secrets', () => {
  const env = read('notifier', '.env.example');
  for (const v of ['NOTIFIER_DATA_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'APP_URL', 'RPC_TESTNET', 'NETWORKS']) assert.match(env, new RegExp(`^${v}=`, 'm'), v);
  assert.doesNotMatch(env, /^NOTIFIER_DATA_KEY=[0-9a-f]{64}\s*$/m, 'no real key in the example');
  assert.match(env, /^SMTP_PASS=\s*$/m, 'SMTP_PASS stays empty in the example');
});

test('container and docs', () => {
  const df = read('notifier', 'Dockerfile');
  assert.match(df, /node:22/); assert.match(df, /USER node/); assert.match(df, /HEALTHCHECK/);
  const c = read('notifier', 'compose.yaml');
  assert.match(c, /dms-notifier/); assert.match(c, /external: true/); assert.match(c, /\/data/);
  assert.doesNotMatch(c, /^\s*ports:/m, 'the notifier publishes no port');
  assert.ok(exists('docs', 'notifier.md'));
  assert.match(read('CHANGELOG.md'), /notifier|messenger/i);
  assert.match(read('.gitignore'), /\.env\b/);
});
