import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Store } from '../src/store.ts';
import { hexToBytes, hmac } from '../src/crypto.ts';
import { tmp } from './helpers.ts';

const OLD = '11'.repeat(32), NEW = '22'.repeat(32);
const rotate = (file: string, env: Record<string, string>) =>
  spawnSync(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'rotate-key.mjs'), file], { env: { ...process.env, ...env }, encoding: 'utf8' });

test('rotate_keeps_never_list_and_stop_links', () => {
  const file = join(tmp(), 'n.db');
  let s = new Store(file, hexToBytes(OLD));
  s.putSwitch('testnet', '0x01', { hello: 'world' }, false, 1);
  const [a] = s.syncAddresses('testnet', '0x01', [{ role: 'recipient', idx: 1, email: 'Anna@Example.org', name: 'Anna', language: 'fr' }]);
  const stop = s.stopToken(a!);
  s.addNever('never@example.org', 1);
  s.close();

  const r = rotate(file, { OLD_NOTIFIER_DATA_KEY: OLD, NEW_NOTIFIER_DATA_KEY: NEW });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { switches: 1, addresses: 1 });

  s = new Store(file, hexToBytes(NEW));
  assert.deepEqual(s.getSwitch('testnet', '0x01')?.record, { hello: 'world' });
  assert.equal(s.listAddresses('testnet', '0x01')[0]?.email, 'Anna@Example.org');
  assert.equal(s.findByStopToken(stop)?.id, a!.id, 'a stop link sent before the rotation still works');
  assert.ok(s.isNever('never@example.org'), 'the never list still matches');
  assert.ok(s.isNever(' NEVER@example.org '), 'normalised');
  s.close();
  assert.throws(() => new Store(file, hexToBytes(OLD)), 'the old key no longer opens the database');
});

test('rotate_refuses_wrong_old_key_and_changes_nothing', () => {
  const file = join(tmp(), 'n.db');
  const s = new Store(file, hexToBytes(OLD));
  s.putSwitch('testnet', '0x02', { a: 1 }, false, 1);
  s.close();
  const before = new DatabaseSync(file).prepare('SELECT record FROM switches').get();
  const r = rotate(file, { OLD_NOTIFIER_DATA_KEY: '33'.repeat(32), NEW_NOTIFIER_DATA_KEY: NEW });
  assert.equal(r.status, 1);
  assert.deepEqual(new DatabaseSync(file).prepare('SELECT record FROM switches').get(), before);
});

test('v1_database_keeps_its_address_hmacs', () => {
  // A database created before schema 2 has HMACs from the v1 derivation; the stored key must be that same value.
  const file = join(tmp(), 'n.db');
  const s = new Store(file, hexToBytes(OLD));
  const expected = hmac(hmac(hexToBytes(OLD), 'dms-notifier/address-hmac/v1'), 'a@example.org').toString('hex');
  assert.equal(s.addressHmac('a@example.org'), expected);
  s.close();
});
