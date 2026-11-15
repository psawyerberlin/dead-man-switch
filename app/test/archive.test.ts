import { test, expect } from 'vitest';
import { ArchiveError, openArchive, passphraseStrength, sealArchive, type ArchiveContents } from '../src/core/archive';
import { descriptor, K, letter, seeded } from './helpers';

const d = descriptor();
const contents: ArchiveContents = {
  network: 'testnet', T: d.type_id, I: d.identity, K, sender_label: 'Patrick', rhythm: 'P3M',
  letters: [letter(1, 'Anna'), letter(2, 'Ben')],
  recipients: [
    { index: 1, name: 'Anna', language: 'fr', email: 'anna@example.org', link: 'https://cloud.example.org/a' },
    { index: 2, name: 'Ben', language: 'en', email: null, link: null },
  ],
};
const PASS = 'correct horse battery staple 42';
let sealed: Awaited<ReturnType<typeof sealArchive>> | undefined;
const getSealed = async () => (sealed ??= await sealArchive(contents, PASS, seeded(11)));

test('archive_roundtrip', async () => {
  const a = await getSealed();
  expect(a).toMatchObject({ format: 'dms-owner-archive', version: 1, kdf: 'scrypt', N: 131072, r: 8, p: 1 });
  expect(a.salt).toMatch(/^0x[0-9a-f]{32}$/);
  expect(a.nonce).toMatch(/^0x[0-9a-f]{24}$/);
  expect(JSON.stringify(a)).not.toContain('Anna');
  expect(await openArchive(JSON.stringify(a), PASS)).toEqual(contents);
  expect(passphraseStrength('')).toBe(0);
  expect(passphraseStrength('abc12')).toBe(0);
  expect(passphraseStrength('aaaaaaaaaaaaaaaaaaaaaaaa')).toBeLessThan(3);
  expect(passphraseStrength('password')).toBe(1);
  expect(passphraseStrength(PASS)).toBe(4);
  expect(passphraseStrength('Tr0ub4dor&3xyz')).toBe(3);
  const levels = ['short', 'longer one', 'quite a bit longer', 'a much longer passphrase here'].map(passphraseStrength);
  expect([...levels].sort()).toEqual(levels);
}, 120_000);

test('archive_wrong_passphrase', async () => {
  const a = await getSealed();
  await expect(openArchive(a, PASS + '!')).rejects.toMatchObject({ name: 'ArchiveError', code: 'passphrase' });
  await expect(openArchive({ ...a, format: 'x' } as never, PASS)).rejects.toThrow(ArchiveError);
  await expect(openArchive({ ...a, N: 2 ** 30 }, PASS)).rejects.toThrow(/scrypt/);
}, 120_000);
