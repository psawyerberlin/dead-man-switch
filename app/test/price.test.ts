import { test, expect } from 'vitest';
import { quote } from '../src/core/price';

const within = (actual: number, expected: number, pct = 0.02) => expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(expected * pct);
const YEAR = 365 * 86_400;

test('quote_matches_crt_defaults', () => {
  // CRT §11: 8 runners, 12 months, daily checks (8 000 blocks), organiser fee 50 CKB
  const q = quote({ organiser_fee_ckb: 50 }, {}, { n: 8, t: 5, termSeconds: YEAR, heartbeatBlocks: 8000, heartbeatTip: 0.5 });
  within(q.spentOverTerm, 1530);
  within(q.parked, 4440);
  expect(q.spentNow).toBeCloseTo(51, 5);
  expect(q.runs).toBe(365);
  expect(q.monthly).toBeGreaterThan(100);
  expect(q.detectionDelay).toBe(3 * 8000 * 10.8);
  expect(q.lines.find((l) => l.id === 'organiser_fee')?.ckb).toBe(50);
  for (const l of q.lines) expect(l.key).toMatch(/^price\.line\./);
  // the shipped fee (70 CKB) is spent now; block time from the deployment
  const q70 = quote({ organiser_fee_ckb: 70 }, { block_seconds: 10.8 }, { n: 8, t: 5, termSeconds: YEAR, heartbeatBlocks: 8000, heartbeatTip: 0.5 });
  expect(q70.spentNow - q.spentNow).toBeCloseTo(20, 5);
  expect(() => quote({ organiser_fee_ckb: 50 }, {}, { n: 3, t: 4, termSeconds: YEAR, heartbeatBlocks: 8000, heartbeatTip: 0.5 })).toThrow();
});

test('quote_heartbeat_presets', () => {
  const presets = [1000, 4000, 8000, 56000];
  const tips = presets.map((hb) => quote({ organiser_fee_ckb: 70 }, {}, { n: 8, t: 5, termSeconds: YEAR, heartbeatBlocks: hb, heartbeatTip: 0.5 })
    .lines.find((l) => l.id === 'heartbeat_tips')!.ckb);
  for (let i = 1; i < tips.length; i++) expect(tips[i]!).toBeLessThan(tips[i - 1]!);
  const delays = presets.map((hb) => quote({ organiser_fee_ckb: 70 }, {}, { n: 8, t: 5, termSeconds: YEAR, heartbeatBlocks: hb, heartbeatTip: 0.5 }).detectionDelay);
  for (let i = 1; i < delays.length; i++) expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
});
