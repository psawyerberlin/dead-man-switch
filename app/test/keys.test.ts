import { test, expect } from 'vitest';
import { letterKey, linkKey } from '../src/core/keys';
import { bytesToHex } from '../src/core/bytes';
import { vectors } from './helpers';

test('keys_match_vectors', () => {
  const v = vectors();
  expect(v.cases.length).toBeGreaterThanOrEqual(3);
  for (const c of v.cases) {
    expect(bytesToHex(letterKey(v.K, v.I, c.r))).toBe(c.K_letter);
    expect(bytesToHex(linkKey(v.K, v.I, c.r))).toBe(c.K_link);
  }
  expect(() => letterKey(v.K, v.I, 0)).toThrow();
  expect(() => letterKey(v.K, v.I, 11)).toThrow();
  expect(() => letterKey('0x00', v.I, 1)).toThrow();
});
