import { test, expect } from 'vitest';
import { unzipSync } from 'fflate';
import { buildVault, parseVault, vaultFileName, zipVaults, type BuildVaultInput } from '../src/core/vault';
import { encryptBundle, openBundle } from '../src/core/bundle';
import { fromBase64, hexToBytes } from '../src/core/bytes';
import { descriptor, envelopes, K, letter, seeded } from './helpers';

const d = descriptor();
const I = d.identity;
const T = d.type_id;
const SCRIPT = 'window.crtApplication = { onKey: function (K) { window.__k = K; } };';

async function input(index: number, name: string, seed = 7): Promise<BuildVaultInput> {
  const sealed = await encryptBundle(K, I, index, letter(index, name), seeded(seed + index));
  return {
    descriptor: d, envelopes: envelopes(d), deadline: 1_900_000_000, recipient: { index, name }, sealed, script: SCRIPT,
    meta: { network: 'testnet', language: 'fr', sender_label: 'Patrick', drill: false, created_at: 1_763_000_000, app_url: 'https://dead-man-switch.chainsolution.net' },
  };
}

test('vault_deterministic', async () => {
  const a = buildVault(await input(1, 'Anna'));
  const b = buildVault(structuredClone(await input(1, 'Anna')));
  expect(a).toBe(b);
  expect(buildVault(await input(1, 'Anna', 99))).not.toBe(a); // another nonce
  expect(zipVaults([{ name: 'a.html', content: a }])).toEqual(zipVaults([{ name: 'a.html', content: b }]));
});

test('vault_self_contained', async () => {
  const html = buildVault(await input(1, 'Anna'));
  expect(html).toMatch(/^<!doctype html>/i);
  expect(html).not.toMatch(/<script[^>]+src=/i);
  expect(html).not.toMatch(/<link[^>]+href=/i);
  expect(html).not.toMatch(/@import|url\(\s*['"]?https?:/i);
  expect(html).not.toMatch(/<img[^>]+src=["']?https?:/i);
  expect(html).toContain(SCRIPT);
  expect(html).toContain('id="crt-application"');
  expect(html).toContain('dead-man-switch');
});

test('vault_roundtrip_parse', async () => {
  const inp = await input(2, 'Ben');
  const v = parseVault(buildVault(inp));
  expect(v.descriptor).toEqual(d);
  expect(v.envelopes).toEqual(envelopes(d));
  expect(v.application?.name).toBe('dead-man-switch');
  expect(v.application?.version).toBe('2');
  const p = v.application!.payload;
  expect(p).toMatchObject({ network: 'testnet', language: 'fr', sender_label: 'Patrick', recipient: { index: 2, name: 'Ben' },
    drill: false, created_at: 1_763_000_000, cipher: 'AES-256-GCM', size: inp.sealed.ciphertext.length, app_url: 'https://dead-man-switch.chainsolution.net' });
  const l = await openBundle(K, v.descriptor.identity, p.recipient.index, hexToBytes(p.nonce), fromBase64(p.ciphertext_b64));
  expect(l.recipient.name).toBe('Ben');
  expect(() => parseVault('<html></html>')).toThrow();
  const files = unzipSync(zipVaults([{ name: 'x.html', content: 'abc' }, { name: 'y.html', content: new Uint8Array([1, 2]) }]));
  expect(Object.keys(files).sort()).toEqual(['x.html', 'y.html']);
});

test('vault_filename', () => {
  const T8 = T.slice(2, 10);
  expect(vaultFileName('Patrick', 'Anna', T, false)).toBe(`vault-patrick-for-anna-${T8}.html`);
  expect(vaultFileName('Zoë Müller-Straße', 'Søren Æble', T, false)).toBe(`vault-zoe-muller-strasse-for-soren-aeble-${T8}.html`);
  expect(vaultFileName('Patrick', 'Anna', T, true)).toBe(`drill-vault-patrick-for-anna-${T8}.html`);
  expect(vaultFileName('  ', '日本', T, false)).toBe(`vault-sender-for-recipient-${T8}.html`);
  expect(vaultFileName('../etc', 'a/b\\c', T, false)).toMatch(/^vault-[a-z0-9-]+-for-[a-z0-9-]+-[0-9a-f]{8}\.html$/);
});

test('vault_contains_only_own_letter', async () => {
  const names = ['Anna', 'Bérénice', 'Carlos'];
  const inputs = await Promise.all(names.map((n, i) => input(i + 1, n)));
  const vaults = inputs.map(buildVault);
  const b64 = inputs.map((x) => Buffer.from(x.sealed.ciphertext).toString('base64'));
  vaults.forEach((html, i) => {
    const p = parseVault(html).application!.payload;
    expect(p.recipient).toEqual({ index: i + 1, name: names[i] });
    expect((html.match(/"ciphertext_b64"/g) ?? []).length).toBe(1);
    b64.forEach((c, j) => expect(html.includes(c)).toBe(i === j));
    names.forEach((n, j) => expect(html.includes(n)).toBe(i === j));
    expect(html).not.toContain('Lettre secrète'); // no plaintext
  });
});
