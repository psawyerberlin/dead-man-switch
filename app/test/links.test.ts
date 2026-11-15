import { test, expect } from 'vitest';
import { decryptLink, encryptLink, LinkError, linkAad } from '../src/core/links';
import { bytesToHex, hexToBytes } from '../src/core/bytes';
import { DecryptError } from '../src/core/aead';
import { K, seeded, vectors } from './helpers';

const I = '0x' + 'a5'.repeat(32);

test('link_roundtrip', async () => {
  const url = 'https://cloud.example.org/s/AbC123?dl=1#x';
  const sealed = await encryptLink(K, I, 3, url, seeded(9));
  expect(sealed.nonce).toMatch(/^0x[0-9a-f]{24}$/);
  expect(sealed.ciphertext).not.toContain(Buffer.from(url).toString('hex'));
  expect(await decryptLink(K, I, 3, sealed)).toBe(url);
  await expect(decryptLink(K, I, 4, sealed)).rejects.toThrow(DecryptError);
  const long = 'https://example.org/' + 'a'.repeat(2048 - 20);
  expect(await decryptLink(K, I, 1, await encryptLink(K, I, 1, long, seeded(1)))).toBe(long);
  await expect(encryptLink(K, I, 1, long + 'a', seeded(1))).rejects.toThrow(LinkError);
});

test('link_matches_vectors', async () => {
  const v = vectors();
  for (const c of v.cases) {
    expect(bytesToHex(linkAad(v.I, c.r))).toBe(c.link.aad);
    const nonce = hexToBytes(c.link.nonce);
    const sealed = await encryptLink(v.K, v.I, c.r, c.link.plaintext, () => nonce.slice());
    expect(sealed).toEqual({ nonce: c.link.nonce, ciphertext: c.link.ciphertext });
    expect(await decryptLink(v.K, v.I, c.r, { nonce: c.link.nonce, ciphertext: c.link.ciphertext })).toBe(c.link.plaintext);
  }
});

test('link_rejects_non_https', async () => {
  for (const bad of ['http://example.org/v.html', 'ftp://example.org/v', 'javascript:alert(1)', 'data:text/html,hi', 'example.org/v', '', 'https://exa mple.org/', '//example.org/v']) {
    await expect(encryptLink(K, I, 1, bad, seeded(1))).rejects.toThrow(LinkError);
  }
});
