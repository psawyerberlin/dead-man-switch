import { test, expect } from 'vitest';
import { RpcClient, type Deployment, type FetchLike } from '@crt/client';
import { chainMedianTime, checkinHistory } from '../src/core/chain';
import { readJson } from './helpers';

const fx = readJson('./fixtures/checkin-rpc.json');

/** Answers each JSON-RPC request from the recorded fixture (method + params must match exactly). */
const replay: FetchLike = async (_url, init) => {
  const req = JSON.parse(init.body!);
  const hit = (fx.calls as Array<{ method: string; params: unknown[]; result: unknown }>).find((c) => c.method === req.method && JSON.stringify(c.params) === JSON.stringify(req.params));
  const body = hit ? { id: req.id, jsonrpc: '2.0', result: hit.result } : { id: req.id, jsonrpc: '2.0', error: { code: -1, message: `no fixture for ${req.method} ${JSON.stringify(req.params)}` } };
  return { ok: true, status: 200, json: async () => body };
};

test('checkin_history_from_fixture', async () => {
  const ctx = { rpc: new RpcClient('http://fixture.invalid/', { fetch: replay, retries: 0 }), deployment: { node_lock: { code_hash: fx.node_lock_code_hash } } as Deployment };
  const h = await checkinHistory(fx.T, ctx);
  const [D0, D1, D2] = fx.deadlines;
  expect(h.map((e) => [e.kind, e.deadline])).toEqual([['create', D0], ['checkin', D1], ['checkin', D2]]);
  expect(h.map((e) => e.txHash)).toEqual(['0x' + '01'.repeat(32), '0x' + '04'.repeat(32), '0x' + '05'.repeat(32)]);
  expect(h.map((e) => e.blockNumber)).toEqual([100, 5000, 9000]);
  expect(h[1]!.timestamp).toBe(1_769_000_000);
  expect(await chainMedianTime(ctx)).toBe(1_776_000_500);
});
