#!/usr/bin/env node
// Re-encrypts the messenger database in place under a new NOTIFIER_DATA_KEY.
// Stop the service first and back up /data.
//   OLD_NOTIFIER_DATA_KEY=<hex> NEW_NOTIFIER_DATA_KEY=<hex> node scripts/rotate-key.mjs /data/notifier.db
//
// Re-sealed: switch records, addresses' emails and names, and the address-HMAC key in `meta`. Unchanged on purpose:
// address HMACs, the never list and stop-link hashes, which all depend on the HMAC key, not on the data key, so the
// never list keeps matching and stop links already in people's mailboxes keep working.
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const fail = (msg, code) => { process.stderr.write(msg + '\n'); process.exit(code); };
const hex = (n) => {
  const v = (process.env[n] ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(v)) fail(`${n} must be 64 hex characters`, 2);
  return Buffer.from(v, 'hex');
};
const path = process.argv[2];
if (!path) fail('usage: rotate-key.mjs <path to notifier.db>', 2);
const oldK = hex('OLD_NOTIFIER_DATA_KEY'), newK = hex('NEW_NOTIFIER_DATA_KEY');
if (oldK.equals(newK)) fail('the keys are equal', 2);

// Same format as src/crypto.ts seal/open: "v1." + base64(nonce ‖ ciphertext ‖ tag), AES-256-GCM.
const open = (key, s, aad) => {
  const raw = Buffer.from(s.slice(3), 'base64');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(aad)); d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8');
};
const seal = (key, text, aad) => {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([nonce, ct, c.getAuthTag()]).toString('base64');
};

const db = new DatabaseSync(path);
const version = db.prepare('PRAGMA user_version').get().user_version;
if (version < 2) fail(`database schema ${version}: start the notifier once with the old key to migrate it, then rotate`, 2);
db.exec('BEGIN');
try {
  const meta = db.prepare('SELECT v FROM meta WHERE k = ?').get('hmac_key');
  if (!meta) throw new Error('meta.hmac_key missing');
  db.prepare('UPDATE meta SET v = ? WHERE k = ?').run(seal(newK, open(oldK, meta.v, 'meta/hmac_key'), 'meta/hmac_key'), 'hmac_key');
  let nSwitches = 0, nAddresses = 0;
  for (const r of db.prepare('SELECT network, T, record FROM switches').all()) {
    const aad = `${r.network}/${r.T}/record`;
    db.prepare('UPDATE switches SET record = ? WHERE network = ? AND T = ?').run(seal(newK, open(oldK, r.record, aad), aad), r.network, r.T);
    nSwitches++;
  }
  for (const a of db.prepare('SELECT id, network, T, role, idx, email, name FROM addresses').all()) {
    const f = `${a.role}/${a.idx}`;
    const ea = `${a.network}/${a.T}/email/${f}`, na = `${a.network}/${a.T}/name/${f}`;
    db.prepare('UPDATE addresses SET email = ?, name = ? WHERE id = ?')
      .run(seal(newK, open(oldK, a.email, ea), ea), seal(newK, open(oldK, a.name, na), na), a.id);
    nAddresses++;
  }
  db.exec('COMMIT');
  process.stdout.write(JSON.stringify({ switches: nSwitches, addresses: nAddresses }) + '\n');
} catch (e) {
  db.exec('ROLLBACK');
  fail(`rotation failed, nothing changed: ${e.message}`, 1);
}
