import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateConfig } from '../src/core/config';
import { drillBounds, drillOpensAt, DrillError, validateDrillTerm } from '../src/core/drill';

const file = (n: string) => JSON.parse(readFileSync(new URL(`../../config/${n}.json`, import.meta.url), 'utf8'));

test('drill_bounds', () => {
  const c = validateConfig(file('testnet'), 'testnet');
  const b = drillBounds(c);
  expect(b.minSeconds).toBe(30 * 60);
  expect(b.maxSeconds).toBe(48 * 3600);
  expect(b.presets).toEqual([30, 60, 180, 720, 1440, 2880].map((m) => m * 60));
  expect(b.heartbeatBlocks).toBe(50); // ≈ 9 min on CRT's rehearsal deployment (testnet client minimum 50)
  expect(validateDrillTerm(c, 1800)).toBe(1800);
  expect(validateDrillTerm(c, 48 * 3600)).toBe(48 * 3600);
  expect(() => validateDrillTerm(c, 1799)).toThrow(DrillError);
  expect(() => validateDrillTerm(c, 48 * 3600 + 1)).toThrow(DrillError);
  expect(() => validateDrillTerm(c, Number.NaN)).toThrow(DrillError);
  const o = drillOpensAt(1_800_000_000, 1000);
  expect(o).toEqual({ earliest: 1_800_000_000 + 86_400, latest: 1_800_000_000 + 86_400 + 10_800 });
});

test('drill_refused_on_mainnet', () => {
  const m = validateConfig(file('mainnet'), 'mainnet');
  expect(() => drillBounds(m)).toThrow(DrillError);
  expect(() => validateDrillTerm(m, 3600)).toThrow(/no fire drill/);
  // even a mainnet config object that carries drill settings is refused
  const t = validateConfig(file('testnet'), 'testnet');
  expect(() => validateDrillTerm({ ...t, network: 'mainnet' }, 3600)).toThrow(DrillError);
  expect(() => validateConfig({ ...file('mainnet'), drill: file('testnet').drill }, 'mainnet')).toThrow();
});

test('drill uses the rehearsal deployment', async () => {
  const { drillView } = await import('../src/core/config');
  const c = validateConfig(file('testnet'), 'testnet');
  const d = drillView(c);
  expect(d.crt_deployment_url).toBe('/app/deployments/testnet-drill.json');
  expect(d.crt_runners_url).toBe('/app/deployments/testnet-drill-runners.json');
  expect(d.default_heartbeat_blocks).toBe(50);
  expect(c.crt_deployment_url).toBe('/app/deployments/testnet.json'); // the normal config is unchanged
  // dates: deadline + the deployment's grace (10 min), plus one check of 50 blocks
  const o = drillOpensAt(1_000_000, 50, 10, 600);
  expect(o).toEqual({ earliest: 1_000_600, latest: 1_001_100 });
  expect(drillOpensAt(1_000_000, 50, 10).earliest).toBe(1_000_000 + 86_400); // default stays 24 h
});
