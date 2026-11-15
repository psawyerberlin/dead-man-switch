#!/usr/bin/env node
// dead-man-switch devnet end-to-end scenario (aiworker/04-dms-e2e.md, Phase 1). Written here, run by the maintainer.
//
// Usage (from the repository root, after the one-time setup below):
//   node test/e2e/scenario.mjs [options]
//   --no-devnet       do not run devnet-e2e.sh (a devnet with three runners is already up)
//   --down            stop the devnet (devnet-e2e.sh --down) at the end
//   --state DIR       state directory of devnet-e2e.sh (default .devnet/crt)
//   --csr DIR         CSR checkout passed to devnet-e2e.sh (default: its own default, .refs/crt/.refs/csr)
//   --rpc URL         devnet RPC (default http://127.0.0.1:18114)
//   --port N          notifier port (default 18787)
//   --smtp-port N     SMTP sink port (default 587: the notifier only speaks 465 or 587; 587 = STARTTLS)
//   --key HEX         owner private key (default: CSR's public devnet genesis key, as CRT's devnet scenario)
//   --chromium PATH   Chromium/Chrome binary for the opener (default $CHROMIUM_PATH, else playwright-core's own)
//   --help
//
// One-time setup: the CRT reference clone in .refs/crt with `npm ci && npm run build` in .refs/crt/client, CSR
// built as devnet-e2e.sh asks, the CRT service ELF and node lock built (.refs/crt/scripts/build-*.sh),
// `npm ci` in app/ and notifier/, `npm ci` here (test/e2e: smtp-server, mailparser, playwright-core, tsx) and a
// Chromium (`npx playwright-core install chromium`, or --chromium). Everything else is started by this script:
//   * the CRT devnet with three runners (bash .refs/crt/scripts/devnet-e2e.sh --runners 3);
//   * an SMTP sink (smtp-server, STARTTLS with a throwaway self-signed certificate) storing each message as
//     .devnet/mail/<n>.eml;
//   * the notifier as a child process (node --import tsx notifier/src/main.ts) with its SQLite in .devnet/notifier/.
// The notifier and the app only know the networks testnet and mainnet; the devnet is served to them under the
// name "testnet" (RPC_TESTNET = the devnet RPC, CRT_DEPLOYMENTS_DIR holding the devnet deployment as testnet.json).
// The notifier's own watcher runs every 5 minutes of wall-clock time, so every email step waits up to ~6 minutes.
//
// Steps (aiworker/04-dms-e2e.md): 1 letters, 2 claim/create/commits/arm/seal/vaults/put, 3 told-now email and
// confirm through its link, 4 check in, 5 deadline -> grace alarm -> release, 6 release emails, 7 open the vaults in
// headless Chromium over file://, 8 a second switch cancelled. Prints PASS/FAIL per step; exit code = failures.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const CRT_DIR = resolve(ROOT, '.refs/crt');
const DEVNET_E2E = resolve(CRT_DIR, 'scripts/devnet-e2e.sh');
const DEVNET_DIR = resolve(ROOT, '.devnet');
const requireHere = createRequire(join(HERE, 'package.json'));

// ---- the app core and CRT are TypeScript sources: run this file again under tsx -----------------------------------
if (process.env.DMS_E2E_TSX !== '1') {
  let loader;
  try { loader = pathToFileURL(requireHere.resolve('tsx')).href; }
  catch { console.error('tsx is missing: run `npm ci` in test/e2e first'); process.exit(2); }
  const r = spawnSync(process.execPath, ['--import', loader, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, DMS_E2E_TSX: '1' } });
  process.exit(r.status ?? 1);
}

// ---- options -------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = {
  devnet: true, down: false, state: resolve(DEVNET_DIR, 'crt'), csr: '', rpc: 'http://127.0.0.1:18114',
  port: 18787, smtpPort: 587, key: process.env.DMS_OWNER_KEY ?? '', chromium: process.env.CHROMIUM_PATH ?? '',
};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--help' || a === '-h') {
    const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
    console.log(src.slice(1, src.findIndex((l) => l.startsWith('import '))).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(0);
  } else if (a === '--no-devnet') opt.devnet = false;
  else if (a === '--down') opt.down = true;
  else if (a === '--state') opt.state = resolve(argv[++i]);
  else if (a === '--csr') opt.csr = resolve(argv[++i]);
  else if (a === '--rpc') opt.rpc = argv[++i];
  else if (a === '--port') opt.port = Number(argv[++i]);
  else if (a === '--smtp-port') opt.smtpPort = Number(argv[++i]);
  else if (a === '--key') opt.key = argv[++i];
  else if (a === '--chromium') opt.chromium = argv[++i];
  else { console.error(`unknown option ${a}`); process.exit(2); }
}

// ---- constants (as CRT's scripts/devnet-scenario.mjs) --------------------------------------------------------------
const DAY = 86400;
const GRACE = 86400; // CRT GRACE, 24 h
const ACCEL = 86.4; // chain seconds per block while time-travelling: 1000 blocks = one day
const HB = 1000; // guardian check interval (heartbeat blocks) of both switches
const RHYTHM = 'P1D'; // one day: the shortest term CRT's client builds; the messenger treats it as a short term
const NETWORK = 'testnet'; // the name the app and the notifier know the devnet by (see the header)
const TICK_WAIT_S = 420; // one watcher tick (300 s) plus margin
const API = `http://127.0.0.1:${opt.port}/api/v1`;
const APP_URL = `http://127.0.0.1:${opt.port}`; // so that the confirm links in the emails reach this notifier
const MAIL_DIR = resolve(DEVNET_DIR, 'mail');
const NOTIFIER_DIR = resolve(DEVNET_DIR, 'notifier');
const VAULT_DIR = resolve(DEVNET_DIR, 'vaults');
const SENDER = 'Patrick';
const OWNER_EMAIL = 'owner@example.org';
const LINK_1 = 'https://drive.example.org/s/vault-for-anna-7f3a';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const assert = (c, m) => { if (!c) throw new Error(`assertion failed: ${m}`); };

// ---- steps and report ----------------------------------------------------------------------------------------------
const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push({ name, ok: true, note: `${((Date.now() - t0) / 1000).toFixed(1)}s` }); }
  catch (e) { results.push({ name, ok: false, note: String(e?.stack ?? e).split('\n').slice(0, 3).join(' | ') }); }
  const r = results.at(-1);
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${name} (${r.note})`);
}
/** a later step that needs the result of an earlier one fails with a clear note instead of a TypeError */
const need = (cond, what) => { if (!cond) throw new Error(`skipped: ${what} is missing (an earlier step failed)`); };

// ---- children and cleanup ------------------------------------------------------------------------------------------
const cleanups = [];
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of cleanups.reverse()) { try { await c(); } catch { /* best effort */ } }
}
process.on('SIGINT', () => { void cleanup().then(() => process.exit(130)); });

// ---- devnet RPC and time travel (CRT's scenario, unchanged in substance) -------------------------------------------
async function rpc(method, params = []) {
  const r = await fetch(opt.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
  return j.result;
}
const tipMs = async () => Number(BigInt((await rpc('get_tip_header')).timestamp));
async function medianSeconds() { return Number(BigInt((await rpc('get_blockchain_info')).median_time) / 1000n); }
async function mine(n = 3) { for (let i = 0; i < n; i++) await rpc('generate_block'); }
async function mineAt(ms) {
  const t = await rpc('get_block_template', [null, null, null]);
  t.current_time = '0x' + BigInt(ms).toString(16);
  await rpc('generate_block_with_template', [t]);
}
async function mineAccel(n) { for (let i = 0; i < n; i++) await mineAt((await tipMs()) + Math.round(ACCEL * 1000)); }
/** chain time passes: blocks ACCEL seconds apart until the median time reaches `unixSeconds` */
async function advanceTo(unixSeconds) {
  for (let i = 0; i < 20000 && (await medianSeconds()) < unixSeconds; i++) await mineAt((await tipMs()) + Math.round(ACCEL * 1000));
  assert((await medianSeconds()) >= unixSeconds, 'median time did not reach the target');
}
async function waitFor(what, fn, { timeoutS = 600, accel = 0, mineBlocks = true, pollMs = 2500 } = {}) {
  const end = Date.now() + timeoutS * 1000;
  for (;;) {
    const v = await fn(); if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`);
    if (accel) await mineAccel(accel); else if (mineBlocks) await mine(2);
    await sleep(pollMs);
  }
}
/** the later of tip timestamp and median time (the client measures terms from the tip, the contracts from the median) */
const chainNow = async () => Math.max(Math.ceil((await tipMs()) / 1000), await medianSeconds());

// ---- the CRT devnet (three runners) ----------------------------------------------------------------------------------
if (opt.devnet) {
  console.log('starting the CRT devnet: bash .refs/crt/scripts/devnet-e2e.sh --runners 3');
  const args = [DEVNET_E2E, '--runners', '3', '--state', opt.state, ...(opt.csr ? ['--csr', opt.csr] : [])];
  const r = spawnSync('bash', args, { stdio: 'inherit', cwd: CRT_DIR });
  if (r.status !== 0) { console.error('FAIL devnet-e2e.sh did not finish'); process.exit(1); }
}
if (opt.down) cleanups.unshift(() => { spawnSync('bash', [DEVNET_E2E, '--down', '--state', opt.state], { stdio: 'inherit', cwd: CRT_DIR }); });

// ---- libraries: CRT, CCC, the app core (sources, through tsx) ------------------------------------------------------
const crt = await import(pathToFileURL(resolve(CRT_DIR, 'client/src/index.ts')).href);
const cccMod = createRequire(resolve(CRT_DIR, 'client/package.json'))('@ckb-ccc/core');
const ccc = cccMod.ccc ?? cccMod;
const core = (m) => import(pathToFileURL(resolve(ROOT, `app/src/core/${m}.ts`)).href);
const { encryptBundle, openBundle } = await core('bundle');
const { encryptLink } = await core('links');
const { buildVault, parseVault, setOpenerScript, vaultFileName } = await core('vault');
const { MessengerClient, buildRecord, newOwnerCode } = await core('messenger');
const { toBase64, fromBase64 } = await core('bytes');
const { simpleParser } = requireHere('mailparser');
const { SMTPServer } = requireHere('smtp-server');

// The opener inlined into every vault: the built `app/dist/opener.js` (made here when missing).
const OPENER_JS = resolve(ROOT, 'app/dist/opener.js');
if (!existsSync(OPENER_JS)) execFileSync('npm', ['run', 'build:opener'], { cwd: resolve(ROOT, 'app'), stdio: 'inherit' });
setOpenerScript(readFileSync(OPENER_JS, 'utf8'));

const deploymentFile = resolve(CRT_DIR, 'deployments/devnet.json');
const deployment = crt.parseDeployment(readFileSync(deploymentFile, 'utf8'));
// devnet system scripts for CCC (genesis dep groups), as in CRT's scenario
const genesis = await rpc('get_block_by_number', ['0x0']);
const depGroup = (index) => [{ cellDep: { outPoint: { txHash: genesis.transactions[1].hash, index }, depType: 'depGroup' } }];
const DAO_CODE_HASH = '0x82d76d1b75fe2fd9a27dfbaa65a039221a380d76c926f378d3f81cf3e7e13f2e';
const daoIndex = genesis.transactions[0].outputs.findIndex((o) => o.type && ccc.Script.from({ codeHash: o.type.code_hash, hashType: o.type.hash_type, args: o.type.args }).hash() === DAO_CODE_HASH);
const cccScripts = {
  [ccc.KnownScript.NervosDao]: { codeHash: DAO_CODE_HASH, hashType: 'type', cellDeps: [{ cellDep: { outPoint: { txHash: genesis.transactions[0].hash, index: '0x' + Math.max(daoIndex, 0).toString(16) }, depType: 'code' } }] },
  [ccc.KnownScript.Secp256k1Blake160]: { codeHash: '0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8', hashType: 'type', cellDeps: depGroup(0) },
  [ccc.KnownScript.Secp256k1Multisig]: { codeHash: '0x5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8', hashType: 'type', cellDeps: depGroup(1) },
  [ccc.KnownScript.AnyoneCanPay]: { codeHash: '0x3419a1c09eb2567f6552ee7a8ecffd64155cffe0f1796e6e61ec088d740c1356', hashType: 'type', cellDeps: depGroup(0) },
};
const cccClient = new ccc.ClientPublicTestnet({ url: opt.rpc, scripts: cccScripts });
const csrDir = opt.csr || resolve(CRT_DIR, '.refs/csr');
const ownerKey = opt.key || JSON.parse(readFileSync(resolve(csrDir, 'devtools/devnet-keys.json'), 'utf8')).genesis.privkey;
const signer = new ccc.SignerCkbPrivateKey(cccClient, ownerKey);
const ctx = { signer, deployment, blockSeconds: ACCEL };
const swCtx = { rpc: new crt.RpcClient(opt.rpc), deployment };
const runners = [1, 2, 3].map((i) => JSON.parse(execFileSync(resolve(opt.state, `runner${i}`, 'csr'), ['identity', '--json'], { encoding: 'utf8' })));
const createRunners = runners.map((r) => ({ R: r.runner_lock_hash, servicePubkey: r.service_pubkey }));
const planNodes = () => runners.map((r, i) => ({ runner_lock_hash: r.runner_lock_hash, service_pubkey: r.service_pubkey, label: `guardian ${i + 1}` }));
const tree2of3 = { kind: 'threshold', t: 2, n: 3, leaves: [{ node: 0 }, { node: 1 }, { node: 2 }] };
const send = async (tx) => { const h = await signer.sendTransaction(tx); await mine(4); return h; };

// ---- SMTP sink: every message as .devnet/mail/<n>.eml ----------------------------------------------------------------
rmSync(MAIL_DIR, { recursive: true, force: true });
mkdirSync(MAIL_DIR, { recursive: true });
const tlsDir = resolve(DEVNET_DIR, 'smtp-tls');
mkdirSync(tlsDir, { recursive: true });
if (!existsSync(join(tlsDir, 'key.pem'))) {
  // a throwaway certificate for the local sink only (the notifier requires STARTTLS on 587)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-subj', '/CN=127.0.0.1',
    '-keyout', join(tlsDir, 'key.pem'), '-out', join(tlsDir, 'cert.pem')], { stdio: 'ignore' });
}
let mailSeq = 0;
const sink = new SMTPServer({
  secure: false, key: readFileSync(join(tlsDir, 'key.pem')), cert: readFileSync(join(tlsDir, 'cert.pem')),
  name: '127.0.0.1', banner: 'dms-e2e sink', disabledCommands: [], authMethods: ['PLAIN', 'LOGIN'],
  onAuth(auth, _session, cb) { cb(null, { user: auth.username }); },
  onData(stream, _session, cb) {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      writeFileSync(join(MAIL_DIR, `${String(++mailSeq).padStart(4, '0')}.eml`), Buffer.concat(chunks));
      cb();
    });
  },
});
await new Promise((res, rej) => { sink.once('error', rej); sink.listen(opt.smtpPort, '127.0.0.1', res); });
cleanups.push(() => new Promise((res) => sink.close(res)));

/** every message in the sink: {file, to[], subject, text} */
async function mails() {
  const out = [];
  for (const f of readdirSync(MAIL_DIR).filter((x) => x.endsWith('.eml')).sort()) {
    const m = await simpleParser(readFileSync(join(MAIL_DIR, f)));
    const to = (Array.isArray(m.to) ? m.to : m.to ? [m.to] : []).flatMap((a) => a.value.map((v) => v.address.toLowerCase()));
    out.push({ file: f, to, subject: m.subject ?? '', text: m.text ?? '', headers: m.headers });
  }
  return out;
}
const mailsTo = async (addr) => (await mails()).filter((m) => m.to.includes(addr.toLowerCase()));
/** waits until a message to `addr` matches `pred`; the notifier's watcher ticks every 5 minutes (wall clock) */
async function waitMail(what, addr, pred, timeoutS = TICK_WAIT_S) {
  return waitFor(what, async () => (await mailsTo(addr)).find(pred) ?? null, { timeoutS, mineBlocks: false, pollMs: 5000 });
}
const confirmUrlIn = (text) => /https?:\/\/\S+\/api\/v1\/confirm\/[A-Za-z0-9_-]{43}/.exec(text)?.[0] ?? null;
async function clickConfirm(text) {
  const url = confirmUrlIn(text);
  assert(url, 'the email carries a confirm link');
  const res = await fetch(url);
  assert(res.ok, `confirm link answered ${res.status}`);
  return url;
}

// The notifier's own strings, so the subjects are checked in each recipient's language.
const notifierText = Object.fromEntries(['en', 'fr', 'de'].map((l) => [l, JSON.parse(readFileSync(resolve(ROOT, `notifier/src/i18n/${l}.json`), 'utf8'))]));
const tr = (lang, key, vars = {}) => notifierText[lang][key].replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const utcDate = (lang, at) => new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(at * 1000));

// ---- the notifier as a child process ---------------------------------------------------------------------------------
rmSync(NOTIFIER_DIR, { recursive: true, force: true });
mkdirSync(join(NOTIFIER_DIR, 'deployments'), { recursive: true });
copyFileSync(deploymentFile, join(NOTIFIER_DIR, 'deployments', `${NETWORK}.json`));
const notifierTsx = pathToFileURL(createRequire(resolve(ROOT, 'notifier/package.json')).resolve('tsx')).href;
const notifierLog = [];
const notifier = spawn(process.execPath, ['--import', notifierTsx, 'src/main.ts'], {
  cwd: resolve(ROOT, 'notifier'),
  env: {
    PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
    NOTIFIER_DATA_KEY: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex'),
    SMTP_HOST: '127.0.0.1', SMTP_PORT: String(opt.smtpPort),
    SMTP_USER: 'dead-man-switch_noreply@devnet.example.org', SMTP_PASS: 'devnet-sink',
    MAIL_FROM: 'dead-man-switch <dead-man-switch_noreply@devnet.example.org>',
    // the sink's certificate is self-signed; this only affects this child process talking to 127.0.0.1
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    APP_URL, NETWORKS: NETWORK, RPC_TESTNET: opt.rpc,
    PORT: String(opt.port), DATA_DIR: join(NOTIFIER_DIR, 'data'), CRT_DEPLOYMENTS_DIR: join(NOTIFIER_DIR, 'deployments'),
    LOG_LEVEL: 'debug',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
for (const s of [notifier.stdout, notifier.stderr]) s.on('data', (d) => { notifierLog.push(String(d)); writeFileSync(join(NOTIFIER_DIR, 'notifier.log'), notifierLog.join('')); });
process.on('exit', () => { if (notifier.exitCode === null) notifier.kill('SIGTERM'); });
cleanups.push(() => new Promise((res) => { if (notifier.exitCode !== null) return res(); notifier.once('exit', res); notifier.kill('SIGTERM'); }));
await waitFor('notifier /health', async () => {
  if (notifier.exitCode !== null) throw new Error(`notifier exited (${notifier.exitCode}): ${notifierLog.join('').slice(-800)}`);
  try { return (await fetch(`${API}/health`)).ok; } catch { return false; }
}, { timeoutS: 60, mineBlocks: false, pollMs: 1000 });
const messenger = new MessengerClient(API);

// ---- shared helpers for both switches ----------------------------------------------------------------------------
/** claim T at the notifier, then send Create (2-of-3, deadline = chain + rhythm + 10 min) */
async function claimAndCreate() {
  const deadline = (await chainNow()) + DAY + 600;
  const built = await crt.buildCreate({ signer, deployment, deadline, runners: createRunners, params: { ...crt.defaultSwitchParams(), heartbeatBlocks: HB }, validation: { t: 2 }, blockSeconds: ACCEL });
  const owner = newOwnerCode(NETWORK, built.T);
  await messenger.claim(NETWORK, built.T, owner.adminHash);
  await send(built.tx);
  return { T: built.T.toLowerCase(), I: built.I.toLowerCase(), deadline, owner };
}
/** commits -> verify (hard fail) -> descriptor -> Arm */
async function commitAndArm(sw, K) {
  await waitFor('the commits of the three guardians', async () => (await crt.readSwitch(sw.T, swCtx)).state === 'committed');
  await crt.verifyNodes(sw.T, { type_id: sw.T, nodes: planNodes() }, swCtx);
  const descriptor = await crt.buildVerifiedDescriptor({ K, access_tree: tree2of3, nodes: planNodes(), created_at: Math.floor(Date.now() / 1000) }, sw.T, swCtx);
  await waitFor('the owner client sees all Node Cells committed', async () => (await crt.liveNodeCells(sw.T, ctx)).every((n) => n.data.state === 1), { timeoutS: 90 });
  await send(await crt.buildArm(sw.T, crt.descriptorHash(descriptor), { ...ctx, params: { heartbeatBlocks: HB } }));
  await waitFor('armed', async () => (await crt.readSwitch(sw.T, swCtx)).state === 'armed');
  return descriptor;
}
/** Seal: one encrypted bundle and one vault per recipient, written to .devnet/vaults/ */
async function seal(sw, K, descriptor, letters, recipients) {
  const envelopes = await crt.wrapKeyAnchored(K, descriptor, swCtx);
  const createdAt = Math.floor(Date.now() / 1000);
  const vaults = [];
  for (const r of recipients) {
    const sealed = await encryptBundle(K, sw.I, r.index, letters[r.index]);
    const html = buildVault({
      descriptor, envelopes, deadline: sw.deadline, recipient: { index: r.index, name: r.name }, sealed,
      meta: { network: NETWORK, language: r.language, sender_label: SENDER, drill: false, created_at: createdAt, app_url: APP_URL },
      rpcUrls: [opt.rpc],
    });
    const file = resolve(VAULT_DIR, vaultFileName(SENDER, r.name, sw.T, false));
    writeFileSync(file, html);
    vaults.push({ index: r.index, file, html });
  }
  return { envelopes, vaults };
}

// ---- headless Chromium for the opener ----------------------------------------------------------------------------
let browser = null;
async function chromium() {
  if (browser) return browser;
  const { chromium: pw } = requireHere('playwright-core');
  browser = await pw.launch({ headless: true, ...(opt.chromium ? { executablePath: opt.chromium } : {}) });
  cleanups.push(() => browser.close());
  return browser;
}
/** opens a vault from file:// and lets its opener read the devnet; returns what the page shows */
async function openVault(file, { recover }) {
  const page = await (await chromium()).newPage();
  try {
    await page.goto(pathToFileURL(file).href);
    await page.waitForFunction(() => !!window.__dmsOpener && !!window.CRT_KIT?.api, null, { timeout: 30_000 });
    // the opener reads the chain on mount; read it again explicitly and wait for the answer
    await page.evaluate(() => window.__dmsOpener.checkChain());
    await page.waitForFunction(() => ['status', 'offline'].includes(window.__dmsOpener.state.chain.kind), null, { timeout: 60_000 });
    const status = await page.evaluate(() => {
      const c = window.__dmsOpener.state.chain;
      if (c.kind !== 'status') return { kind: c.kind };
      const s = c.status;
      return { kind: c.kind, alive: s.alive, released: s.released, descriptorHashMatches: s.descriptorHashMatches, deadline: s.deadline === null ? null : Number(s.deadline) };
    });
    let recoverError = null;
    let opened = null;
    if (recover) {
      recoverError = await page.evaluate(async () => {
        try { await window.CRT_KIT.api.recover(); return null; } catch (e) { return String(e?.message ?? e); }
      });
      if (!recoverError) {
        await page.waitForFunction(() => !!window.__dmsOpener.state.opened || !!window.__dmsOpener.state.error, null, { timeout: 60_000 });
        opened = await page.evaluate(async () => {
          const o = window.__dmsOpener.state.opened;
          if (!o) return null;
          const files = [];
          for (let i = 0; i < o.letter.files.length; i++) {
            const bytes = new Uint8Array(await (await fetch(o.urls[i])).arrayBuffer());
            let bin = '';
            for (const b of bytes) bin += String.fromCharCode(b);
            files.push({ name: o.letter.files[i].name, b64: btoa(bin) });
          }
          return { text: o.letter.text_markdown, note: o.letter.note_markdown, recipient: o.letter.recipient, files };
        });
      }
    }
    const shown = await page.evaluate(() => document.body.innerText);
    const openedAfter = await page.evaluate(() => !!window.__dmsOpener.state.opened);
    return { status, recoverError, opened, openedAfter, shown };
  } finally {
    await page.close();
  }
}

// ---- the data of switch A --------------------------------------------------------------------------------------------
const s = {};
const enc = new TextEncoder();
const fileOf = (name, mime, bytes) => ({ name, mime, size: bytes.length, data_b64: toBase64(bytes) });
const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

await step('0 precondition: devnet clock near the wall clock, notifier healthy', async () => {
  const skew = Math.round((await tipMs()) / 1000 - Date.now() / 1000);
  assert(Math.abs(skew) < 600, `chain clock is ${skew} s away from the wall clock; reset the devnet: bash .refs/crt/scripts/devnet-e2e.sh --reset`);
  const h = await (await fetch(`${API}/health`)).json();
  assert(h.ok === true, `notifier /health ok (${JSON.stringify(h)})`);
});

await step('1 letters: two recipients (en, de), one text and two files each, recipient 1 with a link', async () => {
  mkdirSync(VAULT_DIR, { recursive: true });
  s.recipients = [
    { index: 1, name: 'Anna', language: 'en', email: 'anna@example.org', tell_now: true, link: LINK_1 },
    { index: 2, name: 'Bernd Müller', language: 'de', email: 'bernd@example.org', tell_now: false, link: null },
  ];
  s.letters = {};
  for (const r of s.recipients) {
    s.letters[r.index] = {
      version: 2, language: r.language, created_at: Math.floor(Date.now() / 1000), sender_label: SENDER,
      recipient: { index: r.index, name: r.name }, drill: false,
      text_markdown: r.index === 1 ? '# For Anna\n\nThe garden key is under the blue pot. LETTER-ONE-MARKER'
        : '# Für Bernd\n\nDie Unterlagen liegen im Schrank. LETTER-TWO-MARKER',
      note_markdown: r.index === 1 ? 'A personal note for Anna.' : 'Eine persönliche Notiz für Bernd.',
      files: [
        fileOf(`notes-${r.index}.txt`, 'text/plain', enc.encode(`file one of recipient ${r.index}\n`)),
        fileOf(`photo-${r.index}.bin`, 'application/octet-stream', randomBytes(4096 + r.index)),
      ],
    };
  }
  assert(Object.keys(s.letters).length === 2, 'two letters');
});

await step('2 claim -> create (2-of-3) -> commits -> arm -> seal -> both vaults in .devnet/ -> put the record', async () => {
  need(s.letters, 'letters');
  s.A = await claimAndCreate();
  s.K = randomBytes(32);
  s.descriptor = await commitAndArm(s.A, s.K);
  const sealed = await seal(s.A, s.K, s.descriptor, s.letters, s.recipients);
  s.envelopes = sealed.envelopes;
  s.vaults = sealed.vaults;
  for (const v of s.vaults) {
    const p = parseVault(readFileSync(v.file, 'utf8'));
    assert(p.application?.payload.recipient.index === v.index, `vault ${v.index} carries only its own recipient`);
  }
  const recipients = [];
  for (const r of s.recipients) {
    recipients.push({ index: r.index, name: r.name, language: r.language, email: r.email, tell_now: r.tell_now,
      link: r.link ? await encryptLink(s.K, s.A.I, r.index, r.link) : null });
  }
  s.record = buildRecord({ network: NETWORK, T: s.A.T, I: s.A.I, drill: false, sender_label: SENDER, rhythm: RHYTHM,
    descriptor: s.descriptor, envelopes: s.envelopes, owner: { email: OWNER_EMAIL, language: 'en', reminders: true }, recipients });
  assert(!JSON.stringify(s.record).includes(LINK_1), 'the record carries no link in clear');
  await messenger.put(s.record, s.A.owner.A);
  const got = await messenger.get(NETWORK, s.A.T, s.A.owner.A);
  assert(got && typeof got === 'object', 'GET returns the stored record');
});

await step('3 the "told now" email reached the sink; recipient 1 (and the owner) confirm through the link', async () => {
  need(s.record, 'the record');
  const told = await waitMail('the told-now email to recipient 1', 'anna@example.org',
    (m) => m.subject === tr('en', 'told_now_subject', { sender: SENDER }));
  assert(!told.text.includes(LINK_1) && !/\.html\b/.test(told.text), 'the told-now email has no vault link');
  await clickConfirm(told.text);
  const ownerMail = await waitMail('the owner confirmation email', OWNER_EMAIL, (m) => m.subject === tr('en', 'owner_confirm_subject') && m.text.includes(s.A.T.slice(0, 10)));
  await clickConfirm(ownerMail.text); // reminders and alarms go to a confirmed owner only
  assert((await mailsTo('bernd@example.org')).length === 0, 'recipient 2 (no "tell now") got nothing yet');
  const view = JSON.stringify(await messenger.get(NETWORK, s.A.T, s.A.owner.A));
  assert(/confirmed/.test(view), `the record shows the confirmation (${view.slice(0, 300)})`);
});

await step('4 check in once: deadline moves, I unchanged, vaults still valid; the next reminder follows', async () => {
  need(s.descriptor, 'switch A');
  const before = await crt.readSwitch(s.A.T, swCtx);
  assert((await mailsTo(OWNER_EMAIL)).every((m) => !m.subject.startsWith(tr('en', 'reminder_drill_subject', { deadline: '' }).trim())), 'no reminder before the check-in');
  s.deadline = (await chainNow()) + DAY + 1200;
  await send(await crt.buildRenew(s.A.T, s.deadline, undefined, ctx));
  let after = await crt.readSwitch(s.A.T, swCtx);
  for (let i = 0; i < 20 && after.deadline !== BigInt(s.deadline); i++) { await mine(2); after = await crt.readSwitch(s.A.T, swCtx); }
  assert(after.state === 'armed', `armed after the check-in (state ${after.state})`);
  assert(after.deadline === BigInt(s.deadline), `the deadline moved (expected ${s.deadline}, got ${after.deadline})`);
  assert(after.descriptorHash === before.descriptorHash, 'descriptor hash unchanged');
  assert(crt.bytesToHex(crt.identity(deployment.network_id, s.A.T)).toLowerCase() === s.A.I, 'I unchanged');
  for (const v of s.vaults) {
    const p = parseVault(readFileSync(v.file, 'utf8'));
    assert(crt.descriptorHash(p.descriptor).toLowerCase() === String(after.descriptorHash).toLowerCase(), `vault ${v.index} still matches the Node Cells`);
  }
  // short term (1 day): the reminder is due at half of the term before the (new) deadline
  await advanceTo(s.deadline - DAY / 2 + 60);
  const expected = tr('en', 'deadline_utc', { date: utcDate('en', s.deadline) });
  const reminder = await waitMail('the reminder for the new deadline', OWNER_EMAIL, (m) => m.text.includes(expected) || m.subject.includes(expected));
  assert(/\/app\/#\/checkin\?network=/.test(reminder.text), 'the reminder carries the phone check-in link');
  const stale = (await mailsTo(OWNER_EMAIL)).filter((m) => m.text.includes(tr('en', 'deadline_utc', { date: utcDate('en', s.A.deadline) })));
  assert(stale.length === 0, 'no reminder for the old deadline');
});

await step('5 deadline -> first grace alarm; past deadline + 24 h -> the guardians release', async () => {
  need(s.deadline, 'the checked-in switch');
  await advanceTo(s.deadline + 60);
  const alarm = await waitMail('the first grace alarm', OWNER_EMAIL, (m) => m.subject === tr('en', 'alarm_subject', { hours: 24 }) || m.subject === tr('en', 'alarm_subject', { hours: 23 }));
  assert(/\/app\/#\/checkin\?/.test(alarm.text), 'the alarm carries the phone check-in link');
  await advanceTo(s.deadline + GRACE + 60);
  const rel = await waitFor('threshold releases', async () => {
    const r = await crt.collectReleases(s.A.T, opt.rpc, { nodeLockCodeHash: deployment.node_lock.code_hash });
    return r.size >= 2 ? r : null;
  }, { timeoutS: 300, accel: 100 });
  const K = await crt.recoverOnline(s.descriptor, s.envelopes, opt.rpc);
  assert(Buffer.from(K).equals(Buffer.from(s.K)), `the chain gives back K (${rel.size} releases)`);
  s.released = true;
});

await step('6 release emails: recipient 1 gets the decrypted link, recipient 2 exactly one email', async () => {
  need(s.released, 'the release');
  const r1 = await waitMail('the release email to recipient 1', 'anna@example.org', (m) => m.subject === tr('en', 'release_subject', { sender: SENDER }));
  assert(r1.text.includes(LINK_1), 'recipient 1\'s release email carries the decrypted link');
  const r2 = await waitMail('the release email to recipient 2', 'bernd@example.org', (m) => m.subject === tr('de', 'release_subject', { sender: SENDER }));
  assert(!r2.text.includes(LINK_1), 'recipient 2\'s email carries no other recipient\'s link');
  assert(r2.text.includes(tr('de', 'release_no_link', { sender: SENDER })), 'recipient 2 (no link) is told to open the vault the sender gave');
  await waitMail('the owner\'s delivery report', OWNER_EMAIL, (m) => m.subject === tr('en', 'report_subject'));
  await sleep(15_000); // nothing else may follow
  const all2 = await mailsTo('bernd@example.org');
  assert(all2.length === 1, `recipient 2 got exactly one email (got ${all2.length})`);
  const report = (await mailsTo(OWNER_EMAIL)).find((m) => m.subject === tr('en', 'report_subject'));
  assert(!report.text.includes(LINK_1), 'the delivery report carries no link');
});

await step('7 open each vault in headless Chromium (file://, devnet RPC): letter and files byte-for-byte', async () => {
  need(s.released && s.vaults, 'the released switch and its vaults');
  for (const v of s.vaults) {
    const want = s.letters[v.index];
    const got = await openVault(v.file, { recover: true });
    assert(got.status.kind === 'status', `vault ${v.index} read the chain (${got.status.kind})`);
    assert(got.status.released >= 2, `vault ${v.index} sees the releases (${got.status.released})`);
    assert(got.status.descriptorHashMatches, `vault ${v.index}: descriptor matches the Node Cells`);
    assert(got.recoverError === null, `vault ${v.index} recovers K (${got.recoverError})`);
    assert(got.opened, `vault ${v.index} opened the letter`);
    assert(got.opened.recipient.index === v.index, `vault ${v.index} shows its own recipient`);
    assert(got.opened.text === want.text_markdown, `vault ${v.index}: the letter text is identical`);
    assert(got.opened.note === want.note_markdown, `vault ${v.index}: the note is identical`);
    assert(got.opened.files.length === want.files.length, `vault ${v.index}: two files`);
    want.files.forEach((f, i) => {
      assert(got.opened.files[i].name === f.name, `vault ${v.index}: file ${f.name} present`);
      assert(Buffer.from(fromBase64(got.opened.files[i].b64)).equals(Buffer.from(fromBase64(f.data_b64))), `vault ${v.index}: ${f.name} byte-for-byte`);
    });
    // and the same through the app core directly (the vault's ciphertext with the K from the chain)
    const p = parseVault(readFileSync(v.file, 'utf8')).application.payload;
    const viaCore = await openBundle(s.K, s.A.I, v.index, crt.hexToBytes(p.nonce), fromBase64(p.ciphertext_b64));
    assert(viaCore.text_markdown === want.text_markdown, `vault ${v.index}: core decryption agrees`);
    if (v.index === 1) {
      assert(got.shown.includes('LETTER-ONE-MARKER'), 'vault 1 shows its letter');
      assert(!got.shown.includes('LETTER-TWO-MARKER') && !got.shown.includes('Bernd'), 'vault 1 does not show recipient 2\'s letter');
    }
  }
});

await step('8 second switch: claim, create, arm, seal, put, cancel -> vault shows cancelled, notifier deleted it and told the owner', async () => {
  const B = await claimAndCreate();
  const K = randomBytes(32);
  const descriptor = await commitAndArm(B, K);
  const rB = [{ index: 1, name: 'Clara', language: 'fr', email: 'clara@example.org', tell_now: false, link: null }];
  const letters = { 1: { version: 2, language: 'fr', created_at: Math.floor(Date.now() / 1000), sender_label: SENDER,
    recipient: { index: 1, name: 'Clara' }, drill: false, text_markdown: 'Lettre annulée. LETTER-B-MARKER', note_markdown: '', files: [] } };
  const { envelopes, vaults } = await seal(B, K, descriptor, letters, rB);
  const record = buildRecord({ network: NETWORK, T: B.T, I: B.I, drill: false, sender_label: SENDER, rhythm: RHYTHM, descriptor, envelopes,
    owner: { email: OWNER_EMAIL, language: 'en', reminders: true }, recipients: rB.map((r) => ({ ...r, link: null })) });
  await messenger.put(record, B.owner.A);
  // the owner confirms for this switch too (the cancel email goes to a confirmed owner)
  const conf = await waitMail('the owner confirmation for switch B', OWNER_EMAIL, (m) => m.subject === tr('en', 'owner_confirm_subject') && m.text.includes(B.T.slice(0, 10)));
  await clickConfirm(conf.text);
  // cancel: one signature (as the app's Cancel), then the watcher notices on its next tick
  await send(await crt.buildCancel(B.T, { reclaimNodeCells: false }, ctx));
  await waitFor('cancelled on chain', async () => ['cancelled', 'absent'].includes((await crt.readSwitch(B.T, swCtx)).state));
  await waitMail('the owner\'s cancel email', OWNER_EMAIL, (m) => m.subject === tr('en', 'cancelled_subject') && m.text.includes(B.T.slice(0, 10)), TICK_WAIT_S * 2);
  let status = 0;
  try { await messenger.get(NETWORK, B.T, B.owner.A); } catch (e) { status = e.status ?? -1; }
  assert(status === 404 || status === 410 || status === 401, `the notifier deleted the record (GET answered ${status || 200})`);
  assert((await mailsTo('clara@example.org')).length === 0, 'the recipient of a cancelled switch got nothing');
  const got = await openVault(vaults[0].file, { recover: true });
  assert(got.status.kind === 'status' && got.status.alive === false, `the vault reads "cancelled" (${JSON.stringify(got.status)})`);
  assert(got.recoverError !== null || !got.openedAfter, 'no decryption after cancel');
  assert(!got.shown.includes('LETTER-B-MARKER'), 'the cancelled letter is not shown');
});

// ---- report --------------------------------------------------------------------------------------------------------
await cleanup();
const failed = results.filter((r) => !r.ok).length;
console.log(`\nmail sink: ${MAIL_DIR} (${mailSeq} messages); notifier log: ${join(NOTIFIER_DIR, 'notifier.log')}; vaults: ${VAULT_DIR}`);
if (!opt.down) console.log('the devnet keeps running; stop it with: bash .refs/crt/scripts/devnet-e2e.sh --down --state ' + opt.state);
console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}: ${results.length - failed}/${results.length} steps`);
process.exit(Math.min(failed, 255));
