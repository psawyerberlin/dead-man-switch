import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { descriptorHash } from '@crt/client';
import { createServer, type ApiDeps } from '../src/api.ts';
import { hexToBytes, sha256Hex } from '../src/crypto.ts';
import type { Chain, MailMessage, SwitchState } from '../src/interfaces.ts';
import { Store } from '../src/store.ts';
import { KEY_HEX, tmp } from './helpers.ts';

const hex = (n: number) => '0x' + randomBytes(n).toString('hex');

class FakeChain implements Chain {
  states = new Map<string, SwitchState>();
  async switchState(network: string, T: string): Promise<SwitchState> {
    return this.states.get(`${network}/${T}`) ?? { state: 'absent', medianTime: 0, releases: 0, t: 0 };
  }
  async recoverK(): Promise<Uint8Array> { throw new Error('not in phase 2'); }
  arm(network: string, T: string, I: string, descriptor: unknown): void {
    this.states.set(`${network}/${T}`, { state: 'armed', deadline: 2_000_000_000, medianTime: 1_700_000_000, releases: 0, t: 1, I, descriptorHash: descriptorHash(descriptor as never) });
  }
}

class FakeMailer { sent: MailMessage[] = []; async send(m: MailMessage) { this.sent.push(m); } }

interface Fixture { T: string; I: string; A: string; adminHash: string; descriptor: Record<string, unknown> }
function fixture(): Fixture {
  const A = randomBytes(32);
  return { T: hex(32), I: hex(32), A: A.toString('base64url'), adminHash: sha256Hex(A), descriptor: { version: 1, nonce: hex(8) } };
}

function record(f: Fixture, over: Record<string, unknown> = {}, recipients?: unknown[]) {
  return {
    version: 1, network: 'testnet', T: f.T, I: f.I, drill: false, sender_label: 'Patrick', rhythm: 'P3M',
    descriptor: f.descriptor, envelopes: [{ e: 1 }],
    owner: { email: `owner-${f.T.slice(2, 8)}@example.org`, language: 'de', reminders: true },
    recipients: recipients ?? [
      { index: 1, name: 'Anna', language: 'fr', email: `anna-${f.T.slice(2, 8)}@example.org`, tell_now: true, link: { nonce: hex(12), ciphertext: hex(40) } },
      { index: 2, name: 'Bert', language: 'en', email: `bert-${f.T.slice(2, 8)}@example.org`, tell_now: false, link: null },
    ],
    ...over,
  };
}

async function setup(opts: { trustProxy?: boolean } = {}) {
  const clock = { t: 1_700_000_000, now() { return this.t; } };
  const store = new Store(join(tmp(), 'api.db'), hexToBytes(KEY_HEX));
  const chain = new FakeChain();
  const mailer = new FakeMailer();
  const deps: ApiDeps = { store, chain, clock, mailer, config: { networks: ['testnet'], appUrl: 'https://dms.example', trustProxy: !!opts.trustProxy } };
  const server = createServer(deps);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const bearer = (A: string) => ({ authorization: `Bearer ${A}` });
  const claim = (f: Fixture, headers: Record<string, string> = {}) => call('POST', '/claim', { network: 'testnet', T: f.T, admin_hash: f.adminHash }, headers);
  const put = (f: Fixture, body: unknown = record(f), A = f.A) => call('PUT', `/switch/testnet/${f.T}`, body, bearer(A));
  const close = async () => { await new Promise<void>((r) => server.close(() => r())); store.close(); };
  return { clock, store, chain, mailer, server, call, bearer, claim, put, close };
}

const tokenFrom = (m: MailMessage, kind: 'confirm' | 'stop') => new RegExp(`/api/v1/${kind}/([A-Za-z0-9_-]{43})`).exec(m.text)![1]!;

test('api_claim_then_put', async () => {
  const s = await setup();
  try {
    const f = fixture();
    assert.equal((await s.claim(f)).status, 201);
    s.chain.arm('testnet', f.T, f.I, f.descriptor);
    const r = await s.put(f);
    assert.equal(r.status, 201, r.text);
    assert.equal(r.json.state, 'armed');
    // the owner's confirmation and one "told now" (recipient 2 has tell_now off)
    assert.equal(s.mailer.sent.length, 2);
    const owner = s.mailer.sent.find((m) => m.to.startsWith('owner-'))!;
    const anna = s.mailer.sent.find((m) => m.to.startsWith('anna-'))!;
    assert.match(owner.subject, /Bestätigen|bestätigen/i);
    assert.match(anna.subject, /Patrick/);
    assert.ok(anna.headers['List-Unsubscribe']?.includes('/api/v1/stop/'));
    assert.doesNotMatch(anna.text + anna.html, /vault\b|ciphertext/i);
    // the full owner code form is accepted too, and replacing keeps confirmation of unchanged addresses
    await s.call('GET', `/confirm/${tokenFrom(anna, 'confirm')}`);
    const code = `dms1-testnet-${f.T.slice(2, 10)}-${f.A}`;
    const rec2 = record(f, { rhythm: 'P6M' });
    const r2 = await s.put(f, rec2, code);
    assert.equal(r2.status, 200, r2.text);
    const conf = r2.json.confirmations as { role: string; index: number; confirmation: string }[];
    assert.equal(conf.find((c) => c.role === 'recipient' && c.index === 1)?.confirmation, 'confirmed');
    assert.equal(s.mailer.sent.length, 2, 'unchanged addresses are not asked again');
    // a changed email is asked again
    const rec3 = record(f);
    (rec3.recipients[0] as { email: string }).email = 'anna-new@example.org';
    await s.put(f, rec3);
    assert.equal(s.mailer.sent.length, 3);
    assert.equal(s.mailer.sent[2]!.to, 'anna-new@example.org');
    // GET returns the record, states and timeline
    const g = await s.call('GET', `/switch/testnet/${f.T}`, undefined, s.bearer(f.A));
    assert.equal(g.status, 200);
    assert.equal((g.json.record as { rhythm: string }).rhythm, 'P3M');
    assert.ok((g.json.events as { kind: string }[]).some((e) => e.kind === 'confirmed'));
    // PATCH: only the allowed fields
    const p = await s.call('PATCH', `/switch/testnet/${f.T}`, { owner: { reminders: false }, recipients: [{ index: 2, tell_now: true }] }, s.bearer(f.A));
    assert.equal(p.status, 200, p.text);
    assert.equal((p.json.record as { owner: { reminders: boolean } }).owner.reminders, false);
    assert.equal(s.mailer.sent.at(-1)!.to, `bert-${f.T.slice(2, 8)}@example.org`);
    assert.equal((await s.call('PATCH', `/switch/testnet/${f.T}`, { sender_label: 'Eve' }, s.bearer(f.A))).json.error, 'bad_request');
    assert.equal((await s.call('PATCH', `/switch/testnet/${f.T}`, { recipients: [{ index: 1, name: 'Eve' }] }, s.bearer(f.A))).json.error, 'bad_request');
    // DELETE removes everything and leaves a tombstone
    assert.equal((await s.call('DELETE', `/switch/testnet/${f.T}`, undefined, s.bearer(f.A))).status, 200);
    assert.equal(s.store.getSwitchMeta('testnet', f.T), undefined);
    assert.equal((await s.put(f)).json.error, 'conflict');
    assert.equal((await s.claim(f)).status, 409);
    // health, body limit, bad JSON
    const h = await s.call('GET', '/health');
    assert.deepEqual(h.json, { ok: true, networks: { testnet: { tip: null, lag_s: null } } });
    const big = await s.call('POST', '/claim', JSON.stringify({ pad: 'x'.repeat(300 * 1024) }));
    assert.equal(big.status, 413); assert.equal(big.json.error, 'too_large');
    assert.equal((await s.call('POST', '/claim', '{nope')).json.error, 'bad_request');
  } finally { await s.close(); }
});

test('api_rejects_wrong_admin_token', async () => {
  const s = await setup();
  try {
    const f = fixture();
    await s.claim(f);
    s.chain.arm('testnet', f.T, f.I, f.descriptor);
    const wrong = randomBytes(32).toString('base64url');
    const r = await s.put(f, record(f), wrong);
    assert.equal(r.status, 401); assert.equal(r.json.error, 'unauthorized');
    assert.equal((await s.call('PUT', `/switch/testnet/${f.T}`, record(f))).json.error, 'unauthorized');
    assert.equal((await s.call('PUT', `/switch/testnet/${f.T}`, record(f), { authorization: 'Bearer nonsense' })).json.error, 'unauthorized');
    assert.equal(s.store.getSwitchMeta('testnet', f.T), undefined);
    assert.equal((await s.put(f)).status, 201);
    for (const m of ['GET', 'PATCH', 'DELETE']) {
      const x = await s.call(m, `/switch/testnet/${f.T}`, m === 'PATCH' ? {} : undefined, s.bearer(wrong));
      assert.equal(x.status, 401, m);
    }
    assert.ok(s.store.getSwitchMeta('testnet', f.T));
    // the admin hash must be 32 bytes hex
    assert.equal((await s.call('POST', '/claim', { network: 'testnet', T: hex(32), admin_hash: 'abcd' })).json.error, 'bad_request');
    assert.equal((await s.call('POST', '/claim', { network: 'regtest', T: hex(32), admin_hash: hex(32) })).json.error, 'bad_request');
  } finally { await s.close(); }
});

test('api_rejects_duplicate_claim', async () => {
  const s = await setup();
  try {
    const f = fixture();
    assert.equal((await s.claim(f)).status, 201);
    const again = await s.call('POST', '/claim', { network: 'testnet', T: f.T.toUpperCase().replace('0X', '0x'), admin_hash: hex(32) });
    assert.equal(again.status, 409); assert.equal(again.json.error, 'conflict');
    // a tombstone also blocks a claim
    const g = fixture();
    s.store.addClaim('testnet', g.T, g.adminHash, s.clock.now());
    s.store.deleteSwitch('testnet', g.T, { state: 'released', now: s.clock.now() });
    assert.equal((await s.claim(g)).status, 409);
  } finally { await s.close(); }
});

test('api_claim_expires', async () => {
  const s = await setup();
  try {
    const f = fixture();
    assert.equal((await s.claim(f)).status, 201);
    const thief = { ...f, adminHash: sha256Hex(randomBytes(32)) };
    s.clock.t += 3600;
    assert.equal((await s.claim(thief)).status, 409, 'still within 2 h');
    s.clock.t += 3601;
    // T is live on chain (pending): the claim stays
    s.chain.states.set(`testnet/${f.T}`, { state: 'pending', medianTime: 0, releases: 0, t: 1 });
    assert.equal((await s.claim(thief)).status, 409, 'T is live on chain');
    // T never appeared on chain: the claim expires
    s.chain.states.delete(`testnet/${f.T}`);
    assert.equal(await s.server.api.expireClaims(), 1);
    assert.equal(s.store.getClaim('testnet', f.T), undefined);
    assert.equal((await s.put(f)).json.error, 'unauthorized');
    // lazily on a new claim as well
    const g = fixture();
    await s.claim(g);
    s.clock.t += 7201;
    assert.equal((await s.claim({ ...g, adminHash: sha256Hex(randomBytes(32)) })).status, 201);
  } finally { await s.close(); }
});

test('api_put_checks_chain', async () => {
  const s = await setup();
  try {
    const f = fixture();
    await s.claim(f);
    const unknown = await s.put(f);
    assert.equal(unknown.status, 422); assert.equal(unknown.json.error, 'not_on_chain');
    s.chain.states.set(`testnet/${f.T}`, { state: 'committed', medianTime: 0, releases: 0, t: 1, I: f.I, descriptorHash: descriptorHash(f.descriptor as never) });
    assert.equal((await s.put(f)).json.error, 'not_on_chain', 'not armed yet');
    s.chain.arm('testnet', f.T, f.I, { other: 'descriptor' });
    const wrong = await s.put(f);
    assert.equal(wrong.status, 422); assert.equal(wrong.json.error, 'mismatch');
    s.chain.arm('testnet', f.T, hex(32), f.descriptor);
    assert.equal((await s.put(f)).json.error, 'mismatch', 'I differs');
    assert.equal(s.mailer.sent.length, 0);
    s.chain.arm('testnet', f.T, f.I, f.descriptor);
    assert.equal((await s.put(f)).status, 201);
  } finally { await s.close(); }
});

test('api_rejects_eleven_recipients', async () => {
  const s = await setup();
  try {
    const f = fixture();
    await s.claim(f);
    s.chain.arm('testnet', f.T, f.I, f.descriptor);
    const r = (i: number, o: Record<string, unknown> = {}) => ({ index: i, name: `R${i}`, language: 'en', email: `r${i}@example.org`, tell_now: false, link: null, ...o });
    const eleven = Array.from({ length: 11 }, (_, i) => r((i % 10) + 1));
    const x = await s.put(f, record(f, {}, eleven));
    assert.equal(x.status, 400); assert.equal(x.json.error, 'bad_request'); assert.match(String(x.json.message), /10/);
    const bads: [string, unknown][] = [
      ['duplicate index', record(f, {}, [r(1), r(1)])],
      ['index 11', record(f, {}, [r(11)])],
      ['language', record(f, {}, [r(1, { language: 'es' })])],
      ['email', record(f, {}, [r(1, { email: 'not an email' })])],
      ['header injection', record(f, {}, [r(1, { email: 'a@example.org\r\nBcc: x@example.org' })])],
      ['short nonce', record(f, {}, [r(1, { link: { nonce: hex(8), ciphertext: hex(40) } })])],
      ['long link', record(f, {}, [r(1, { link: { nonce: hex(12), ciphertext: hex(2048 + 17) } })])],
      ['link in clear', record(f, {}, [r(1, { link: 'https://example.org/vault' })])],
      ['K in the record', record(f, { K: hex(32) })],
      ['drill on mainnet path', { ...record(f, { drill: true }), network: 'mainnet' }],
      ['no recipients', record(f, {}, [])],
      ['owner email', record(f, { owner: { email: 'x', language: 'en', reminders: true } })],
    ];
    for (const [what, body] of bads) assert.equal((await s.put(f, body)).status, 400, what);
    assert.equal((await s.put(f, record(f, {}, Array.from({ length: 10 }, (_, i) => r(i + 1))))).status, 201);
    assert.equal(s.store.listAddresses('testnet', f.T).length, 11);
  } finally { await s.close(); }
});

test('api_rate_limits', async () => {
  const s = await setup({ trustProxy: true });
  try {
    const ip = { 'x-forwarded-for': '198.51.100.7' };
    for (let i = 0; i < 5; i++) assert.equal((await s.claim(fixture(), ip)).status, 201);
    const sixth = await s.claim(fixture(), ip);
    assert.equal(sixth.status, 429); assert.equal(sixth.json.error, 'rate_limited');
    assert.ok(sixth.headers.get('retry-after'));
    // another client is not affected; the right-most X-Forwarded-For entry counts (the proxy's)
    assert.equal((await s.claim(fixture(), { 'x-forwarded-for': '198.51.100.7, 203.0.113.9' })).status, 201);
    // 30 requests per minute
    const other = { 'x-forwarded-for': '192.0.2.1' };
    for (let i = 0; i < 30; i++) assert.equal((await s.call('GET', `/confirm/${'a'.repeat(43)}`, undefined, other)).status, 404);
    assert.equal((await s.call('GET', `/confirm/${'a'.repeat(43)}`, undefined, other)).status, 429);
    assert.equal((await s.call('GET', '/health', undefined, other)).status, 200, 'health is not limited');
    s.clock.t += 61;
    assert.equal((await s.call('GET', `/confirm/${'a'.repeat(43)}`, undefined, other)).status, 404);
    s.clock.t += 3600;
    assert.equal((await s.claim(fixture(), ip)).status, 201, 'the claim window has passed');
  } finally { await s.close(); }
  // without TRUST_PROXY the header is ignored
  const t = await setup();
  try {
    for (let i = 0; i < 5; i++) await t.claim(fixture(), { 'x-forwarded-for': `10.0.0.${i}` });
    assert.equal((await t.claim(fixture(), { 'x-forwarded-for': '10.0.0.99' })).status, 429);
  } finally { await t.close(); }
});

test('api_get_hides_other_switches', async () => {
  const s = await setup();
  try {
    const a = fixture(), b = fixture();
    for (const f of [a, b]) { await s.claim(f); s.chain.arm('testnet', f.T, f.I, f.descriptor); assert.equal((await s.put(f)).status, 201); }
    const ga = await s.call('GET', `/switch/testnet/${a.T}`, undefined, s.bearer(a.A));
    assert.equal(ga.status, 200);
    assert.ok(ga.text.includes(`anna-${a.T.slice(2, 8)}`));
    for (const needle of [b.T.slice(2), `anna-${b.T.slice(2, 8)}`, `owner-${b.T.slice(2, 8)}`, b.I.slice(2)]) assert.ok(!ga.text.includes(needle), needle);
    // A's code does not open B
    assert.equal((await s.call('GET', `/switch/testnet/${b.T}`, undefined, s.bearer(a.A))).status, 401);
    // and the timeline carries no personal data
    for (const e of ga.json.events as { detail: string }[]) assert.doesNotMatch(e.detail, /@/);
  } finally { await s.close(); }
});

test('confirm_and_stop_tokens', async () => {
  const s = await setup();
  try {
    const f = fixture();
    await s.claim(f); s.chain.arm('testnet', f.T, f.I, f.descriptor); await s.put(f);
    const anna = s.mailer.sent.find((m) => m.to.startsWith('anna-'))!;
    const c = await s.call('GET', `/confirm/${tokenFrom(anna, 'confirm')}`);
    assert.equal(c.status, 200);
    assert.match(c.text, /<html lang="fr">/);
    assert.doesNotMatch(c.text, /<script/i);
    assert.match(c.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    const addr = () => s.store.listAddresses('testnet', f.T).find((a) => a.role === 'recipient' && a.idx === 1)!;
    assert.equal(addr().confirmation, 'confirmed');
    // tokens are stored only as hashes
    const raw = JSON.stringify(s.store.db.prepare('SELECT * FROM addresses').all());
    assert.ok(!raw.includes(tokenFrom(anna, 'confirm'))); assert.ok(!raw.includes(tokenFrom(anna, 'stop')));
    const st = await s.call('GET', `/stop/${tokenFrom(anna, 'stop')}`);
    assert.equal(st.status, 200);
    assert.match(st.text, /<form method="post" action="\/api\/v1\/stop\/[A-Za-z0-9_-]{43}">/);
    assert.doesNotMatch(st.text, /<script/i);
    assert.equal(addr().confirmation, 'stopped');
    const owner = s.mailer.sent.find((m) => m.to.startsWith('owner-'))!;
    assert.match((await s.call('GET', `/stop/${tokenFrom(owner, 'stop')}`)).text, /<html lang="de">/);
    // unknown or malformed tokens
    const bad = await s.call('GET', `/confirm/${'b'.repeat(43)}`, undefined, { 'accept-language': 'de-DE,de;q=0.9' });
    assert.equal(bad.status, 404); assert.match(bad.text, /<html lang="de">/);
    assert.equal((await s.call('GET', '/stop/short')).status, 404);
    const ev = s.store.listEvents('testnet', f.T).map((e) => e.kind);
    assert.ok(ev.includes('confirmed') && ev.includes('stopped'));
  } finally { await s.close(); }
});

test('never_list_blocks_future_mail', async () => {
  const s = await setup();
  try {
    const f = fixture();
    await s.claim(f); s.chain.arm('testnet', f.T, f.I, f.descriptor); await s.put(f);
    const anna = s.mailer.sent.find((m) => m.to.startsWith('anna-'))!;
    const never = await s.call('POST', `/stop/${tokenFrom(anna, 'stop')}`, '');
    assert.equal(never.status, 200);
    assert.match(never.text, /<html lang="fr">/);
    assert.ok(s.store.isNever(anna.to));
    // another switch names the same address: no email goes to it
    const g = fixture();
    await s.claim(g); s.chain.arm('testnet', g.T, g.I, g.descriptor);
    const n = s.mailer.sent.length;
    const rec = record(g, {}, [{ index: 1, name: 'Anna', language: 'fr', email: anna.to.toUpperCase(), tell_now: true, link: null }]);
    assert.equal((await s.put(g, rec)).status, 201);
    const after = s.mailer.sent.slice(n);
    assert.equal(after.length, 1, 'only the owner is asked');
    assert.ok(!after.some((m) => m.to.toLowerCase() === anna.to));
    assert.ok(s.store.listEvents('testnet', g.T).some((e) => e.kind === 'confirm_skipped'));
    // the never list holds only an HMAC
    const raw = JSON.stringify(s.store.db.prepare('SELECT * FROM never').all());
    assert.ok(!raw.includes('anna'));
    // at most 3 confirmation emails per address per 7 days across all switches
    const shared = 'shared-person@example.org';
    let sentToShared = 0;
    for (let i = 0; i < 4; i++) {
      const h = fixture();
      await s.claim(h); s.chain.arm('testnet', h.T, h.I, h.descriptor);
      const before = s.mailer.sent.length;
      await s.put(h, record(h, {}, [{ index: 1, name: 'S', language: 'en', email: shared, tell_now: true, link: null }]));
      sentToShared += s.mailer.sent.slice(before).filter((m) => m.to === shared).length;
    }
    assert.equal(sentToShared, 3);
  } finally { await s.close(); }
});
