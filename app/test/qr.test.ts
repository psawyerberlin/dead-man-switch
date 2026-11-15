import { test, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { qrInfo, qrSvg } from '../src/core/qr';

const LINK = 'https://dead-man-switch.chainsolution.net/app/#/open';

test('qr_encodes_link', () => {
  const info = qrInfo(LINK);
  // 52 bytes, byte mode, level M → version 4 (33 × 33)
  expect(info).toEqual({ version: 4, moduleCount: 33 });
  const svg = qrSvg(LINK);
  expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 41 41"/);
  expect(svg).toContain('fill="currentColor"');
  expect(svg).not.toMatch(/#000|black/);
  expect(qrSvg(LINK)).toBe(svg);
  expect(createHash('sha256').update(svg).digest('hex')).toBe(HASH);
  expect(qrInfo('https://example.org/' + 'a'.repeat(300)).version).toBeGreaterThan(4);
  expect(qrSvg('https://example.org/é')).not.toBe(qrSvg('https://example.org/e'));
});

const HASH = 'a306e89bb2c0faca87e9a5b4bffe345d7e848a836e15989cf1d0263666396d3f';
