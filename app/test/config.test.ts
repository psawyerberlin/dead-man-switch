import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadConfig, organiserFeeCheck, loadCrtFiles, ConfigError, type FetchFn } from '../src/core/config';

const file = (n: string) => JSON.parse(readFileSync(new URL(`../../config/${n}.json`, import.meta.url), 'utf8'));
const mk = (map: Record<string, unknown>): FetchFn => async (url) => {
  const hit = url in map;
  return { ok: hit, status: hit ? 200 : 404, json: async () => map[url] };
};

test('loads and validates both shipped configs', async () => {
  const t = await loadConfig('testnet', mk({ '/app/config/testnet.json': file('testnet') }));
  expect(t.drill?.min_minutes).toBe(30);
  const m = await loadConfig('mainnet', mk({ '/app/config/mainnet.json': file('mainnet') }));
  expect(m.drill).toBeNull();
});

test('rejects invalid values', async () => {
  const bad = { ...file('testnet'), n_max: 99 };
  await expect(loadConfig('testnet', mk({ '/app/config/testnet.json': bad }))).rejects.toThrow(ConfigError);
});

test('organiser fee and placeholder', async () => {
  const c = await loadConfig('testnet', mk({ '/app/config/testnet.json': file('testnet') }));
  organiserFeeCheck(c, { occupiedSize: 53 });
  expect(() => organiserFeeCheck({ ...c, organiser_fee_ckb: 50 }, { occupiedSize: 53 })).toThrow(ConfigError);
  expect(() => organiserFeeCheck({ ...c, organiser_address: 'ckt1placeholder' }, { occupiedSize: 53 })).toThrow(ConfigError);
});

test('crt files: array, wrapped and missing runner list', async () => {
  const c = await loadConfig('testnet', mk({ '/app/config/testnet.json': file('testnet') }));
  const r = [{ runner_lock_hash: '0x00' }];
  const dep = { '/app/deployments/testnet.json': {} };
  expect((await loadCrtFiles(c, mk({ ...dep, '/app/deployments/testnet-runners.json': r }))).runners).toHaveLength(1);
  expect((await loadCrtFiles(c, mk({ ...dep, '/app/deployments/testnet-runners.json': { runners: r } }))).runners).toHaveLength(1);
  expect((await loadCrtFiles(c, mk(dep))).runners).toEqual([]);
});
