import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Store } from '../src/store.ts';
import { decryptLink, hexToBytes, linkKey, bytesToHex, open, seal } from '../src/crypto.ts';
import { EnvError, loadConfig } from '../src/env.ts';
import { KEY_HEX, VECTORS, goodEnv, tmp } from './helpers.ts';

test('store_encrypts_at_rest', () => {
  const dir = tmp(); const file = join(dir, 'n.db');
  const key = hexToBytes(KEY_HEX);
  const s = new Store(file, key);
  const record = { owner: { email: 'owner-zed@example.org' }, recipients: [{ name: 'Annabelle Quux', email: 'anna.quux@example.net', link: 'https://vault.example.com/secret-link-42' }] };
  assert.ok(s.addClaim('testnet', '0xaa', 'ab'.repeat(32), 1));
  s.putSwitch('testnet', '0xaa', record, false, 10);
  s.syncAddresses('testnet', '0xaa', [
    { role: 'owner', idx: 0, email: 'owner-zed@example.org', name: 'Olaf Zed', language: 'de' },
    { role: 'recipient', idx: 1, email: 'anna.quux@example.net', name: 'Annabelle Quux', language: 'fr' },
  ]);
  s.addNever('never.person@example.com', 5);
  const addrs = s.listAddresses('testnet', '0xaa');
  assert.equal(addrs[1]?.email, 'anna.quux@example.net');
  assert.deepEqual(s.getSwitch('testnet', '0xaa')?.record, record);
  assert.ok(s.isNever('NEVER.person@example.com'));
  s.close();
  for (const f of readdirSync(dir)) {
    const raw = readFileSync(join(dir, f)).toString('latin1');
    for (const needle of ['owner-zed', 'example.net', 'Annabelle', 'Olaf', 'secret-link', 'vault.example.com', 'never.person']) assert.ok(!raw.includes(needle), `${f} contains ${needle}`);
  }
  // wrong key cannot read
  const bad = new Store(file, hexToBytes('11'.repeat(32)));
  assert.throws(() => bad.getSwitch('testnet', '0xaa'));
  bad.close();
});

test('store keeps confirmation of unchanged addresses and enforces outbox uniqueness', () => {
  const s = new Store(':memory:', hexToBytes(KEY_HEX));
  const a = { role: 'recipient' as const, idx: 1, email: 'a@example.org', name: 'A', language: 'en' };
  const [x] = s.syncAddresses('testnet', '0x01', [a]);
  s.setTokens(x!.id, 'c', 's', 1); s.setConfirmation(x!.id, 'confirmed');
  const [y] = s.syncAddresses('testnet', '0x01', [{ ...a, name: 'B' }]);
  assert.equal(y?.id, x!.id); assert.equal(y?.confirmation, 'confirmed');
  assert.equal(s.findByConfirmToken('c')?.id, x!.id);
  assert.ok(s.enqueue('testnet', '0x01', 'told_now', x!.id, '', 1));
  assert.equal(s.enqueue('testnet', '0x01', 'told_now', x!.id, '', 2), undefined);
  assert.equal(s.schemaVersion, 1);
  s.close();
});

test('crypto_matches_vectors', () => {
  for (const c of VECTORS.cases) {
    assert.equal(bytesToHex(linkKey(VECTORS.K, VECTORS.I, c.r)), c.K_link);
    const nonce = c.link.nonce, ciphertext = c.link.ciphertext;
    assert.equal(decryptLink(VECTORS.K, VECTORS.I, c.r, { nonce, ciphertext }), c.link.plaintext);
    assert.throws(() => decryptLink(VECTORS.K, VECTORS.I, c.r === 1 ? 2 : 1, { nonce, ciphertext }));
  }
  const key = hexToBytes(KEY_HEX);
  const a = seal(key, 'hello'), b = seal(key, 'hello');
  assert.notEqual(a, b); assert.equal(open(key, a), 'hello');
  assert.throws(() => open(key, a, 'other-aad'));
});

test('i18n_same_keys_in_all_languages', () => {
  const [en, fr, de] = ['en', 'fr', 'de'].map((l) => JSON.parse(readFileSync(new URL(`../src/i18n/${l}.json`, import.meta.url), 'utf8')) as Record<string, string>);
  const k = (j: Record<string, string>) => Object.keys(j).sort().join('\n');
  assert.equal(k(en!), k(fr!)); assert.equal(k(en!), k(de!));
  const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const key of Object.keys(en!)) { assert.equal(ph(fr![key]!), ph(en![key]!), key); assert.equal(ph(de![key]!), ph(en![key]!), key); }
});

test('env_rejects_missing_key', () => {
  const ok = loadConfig(goodEnv());
  assert.equal(ok.smtp.secure, true);
  assert.equal(loadConfig({ ...goodEnv(), SMTP_PORT: '587' }).smtp.requireTLS, true);
  const e = goodEnv(); delete (e as Record<string, string | undefined>).NOTIFIER_DATA_KEY;
  assert.throws(() => loadConfig(e), EnvError);
  assert.throws(() => loadConfig({ ...goodEnv(), NOTIFIER_DATA_KEY: 'abcd' }), EnvError);
  assert.throws(() => loadConfig({ ...goodEnv(), SMTP_PORT: '25' }), EnvError);
});

test('env_rejects_foreign_sender', () => {
  assert.throws(() => loadConfig({ ...goodEnv(), MAIL_FROM: 'dms <other@example.org>' }), /MAIL_FROM/);
  assert.doesNotThrow(() => loadConfig({ ...goodEnv(), MAIL_FROM: 'box@example.org' }));
});
