import { test, expect } from 'vitest';
import { BundleError, decodeBundle, decryptBundle, encodeBundle, encryptBundle, letterAad, openBundle } from '../src/core/bundle';
import { bytesToHex, fromUtf8, hexToBytes, utf8 } from '../src/core/bytes';
import { DecryptError } from '../src/core/aead';
import { K, letter, seeded, vectors } from './helpers';

const I = '0x' + 'a5'.repeat(32);

test('bundle_roundtrip', async () => {
  const l = letter(1, 'Anna');
  expect(decodeBundle(encodeBundle(l))).toEqual(l);
  const sealed = await encryptBundle(K, I, 1, l, seeded(1));
  expect(sealed.nonce).toHaveLength(12);
  expect(await openBundle(K, I, 1, sealed.nonce, sealed.ciphertext)).toEqual(l);
  expect(() => decodeBundle(utf8(JSON.stringify({ ...l, version: 1 })))).toThrow(/version/);
  expect(() => decodeBundle(utf8(JSON.stringify({ ...l, version: 3 })))).toThrow(BundleError);
});

test('bundle_matches_vectors', async () => {
  const v = vectors();
  for (const c of v.cases) {
    const L = c.letter;
    expect(bytesToHex(letterAad(v.I, c.r))).toBe(L.aad);
    const nonce = hexToBytes(L.nonce);
    const sealed = await encryptBundle(v.K, v.I, c.r, utf8(L.plaintext_utf8), () => nonce.slice());
    expect(bytesToHex(sealed.ciphertext)).toBe(L.ciphertext);
    expect(fromUtf8(await decryptBundle(v.K, v.I, c.r, nonce, hexToBytes(L.ciphertext)))).toBe(L.plaintext_utf8);
  }
});

test('bundle_wrong_identity_fails', async () => {
  const sealed = await encryptBundle(K, I, 1, letter(1, 'Anna'), seeded(2));
  await expect(decryptBundle(K, '0x' + 'a6'.repeat(32), 1, sealed.nonce, sealed.ciphertext)).rejects.toThrow(DecryptError);
  await expect(decryptBundle('0x' + '4c'.repeat(32), I, 1, sealed.nonce, sealed.ciphertext)).rejects.toThrow(DecryptError);
  const tampered = sealed.ciphertext.slice(); tampered[0]! ^= 1;
  await expect(decryptBundle(K, I, 1, sealed.nonce, tampered)).rejects.toThrow(DecryptError);
});

test('bundle_wrong_recipient_fails', async () => {
  const sealed = await encryptBundle(K, I, 1, letter(1, 'Anna'), seeded(3));
  await expect(decryptBundle(K, I, 2, sealed.nonce, sealed.ciphertext)).rejects.toThrow(DecryptError);
  // a bundle addressed to 2 but encrypted for 1 is refused after decryption
  const odd = await encryptBundle(K, I, 1, letter(2, 'Ben'), seeded(4));
  await expect(openBundle(K, I, 1, odd.nonce, odd.ciphertext)).rejects.toThrow(BundleError);
});

test('bundle_size_limit', async () => {
  const l = letter(1, 'Anna', { text_markdown: 'x'.repeat(5000) });
  const size = encodeBundle(l).length + 16;
  await expect(encryptBundle(K, I, 1, l, seeded(5), { maxBytes: size - 1 })).rejects.toMatchObject({ code: 'size' });
  const ok = await encryptBundle(K, I, 1, l, seeded(5), { maxBytes: size });
  expect(ok.ciphertext.length).toBe(size);
});
