import { test, expect } from 'vitest';
import { buildRecord, MessengerClient, newOwnerCode, parseOwnerCode, type MessengerFetch } from '../src/core/messenger';
import { encryptLink } from '../src/core/links';
import { encodeBundle } from '../src/core/bundle';
import { bytesToHex } from '../src/core/bytes';
import { descriptor, envelopes, K, letter, seeded } from './helpers';

const d = descriptor();

test('record_has_no_secrets', async () => {
  const url1 = 'https://cloud.example.org/s/secret-share-anna';
  const url2 = 'https://nas.example.net/vault-ben.html';
  const l1 = letter(1, 'Anna');
  const input = {
    network: 'testnet' as const, T: d.type_id, I: d.identity, drill: false, sender_label: 'Patrick', rhythm: 'P3M',
    descriptor: d, envelopes: envelopes(d),
    owner: { email: 'owner@example.org', language: 'de' as const, reminders: true },
    recipients: [
      { index: 1, name: 'Anna', language: 'fr' as const, email: 'anna@example.org', tell_now: true, link: await encryptLink(K, d.identity, 1, url1, seeded(1)) },
      { index: 2, name: 'Ben', language: 'en' as const, email: null, tell_now: false, link: await encryptLink(K, d.identity, 2, url2, seeded(2)) },
      { index: 3, name: 'Cleo', language: 'de' as const, email: 'cleo@example.org', tell_now: false, link: null },
    ],
    // things that must never be copied into the record
    K, letters: [l1], url: url1,
  };
  const record = buildRecord(input);
  const json = JSON.stringify(record);
  expect(record.version).toBe(1);
  expect(json.toLowerCase()).not.toContain(K.slice(2));
  expect(json).not.toContain(l1.text_markdown.slice(0, 20));
  expect(json).not.toContain('Lettre secrète');
  expect(json).not.toContain(Buffer.from(encodeBundle(l1)).toString('base64').slice(0, 40));
  for (const u of [url1, url2, 'secret-share-anna', 'nas.example.net']) expect(json).not.toContain(u);
  expect(json).not.toContain(Buffer.from(url1).toString('hex'));
  expect(Object.keys(record).sort()).toEqual(['I', 'T', 'descriptor', 'drill', 'envelopes', 'network', 'owner', 'recipients', 'rhythm', 'sender_label', 'version']);
  expect(record.recipients[2]!.link).toBeNull();
  expect(() => buildRecord({ ...input, recipients: [{ ...input.recipients[0]!, link: url1 as never }] })).toThrow();
  expect(() => buildRecord({ ...input, T: '0x' + '22'.repeat(32) })).toThrow();
});

test('owner_code_roundtrip', async () => {
  const oc = newOwnerCode('testnet', d.type_id, seeded(5));
  expect(oc.code).toMatch(/^dms1-testnet-11111111-[A-Za-z0-9_-]{43}$/);
  const p = parseOwnerCode(oc.code);
  expect(p).toEqual({ network: 'testnet', T8: '11111111', A: oc.A, adminHash: oc.adminHash });
  expect(oc.adminHash).toMatch(/^0x[0-9a-f]{64}$/);
  expect(oc.adminHash).not.toBe(bytesToHex(oc.A));
  expect(() => parseOwnerCode(oc.code.slice(0, -1))).toThrow();
  expect(() => parseOwnerCode(oc.code.replace('testnet', 'devnet'))).toThrow();

  // the client sends A as bearer and never the hash in a PUT
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; body?: string }> = [];
  const fetchFn: MessengerFetch = async (url, init) => {
    calls.push({ url, ...init });
    if (init.method === 'POST' && calls.filter((c) => c.method === 'POST').length > 1) return { ok: false, status: 409, json: async () => ({ error: 'claimed' }) };
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const c = new MessengerClient('/api/v1/', fetchFn);
  await c.claim('testnet', d.type_id, oc.adminHash);
  await expect(c.claim('testnet', d.type_id, oc.adminHash)).rejects.toMatchObject({ status: 409 });
  await c.get('testnet', d.type_id, p.A);
  await c.patch('testnet', d.type_id, p.A, { owner: { reminders: false } });
  await c.remove('testnet', d.type_id, p.A);
  expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([
    'POST /api/v1/claim', 'POST /api/v1/claim', `GET /api/v1/switch/testnet/${d.type_id}`,
    `PATCH /api/v1/switch/testnet/${d.type_id}`, `DELETE /api/v1/switch/testnet/${d.type_id}`]);
  expect(JSON.parse(calls[0]!.body!)).toEqual({ network: 'testnet', T: d.type_id, admin_hash: oc.adminHash });
  expect(calls[2]!.headers.authorization).toBe(`Bearer ${oc.code.split('-').slice(3).join('-')}`);
});
