#!/usr/bin/env node
// Re-encrypts the messenger database in place under a new NOTIFIER_DATA_KEY.
// Stop the service first and back up /data.
//   OLD_NOTIFIER_DATA_KEY=<hex> NEW_NOTIFIER_DATA_KEY=<hex> node scripts/rotate-key.mjs /data/notifier.db
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const hex = (n) => {
  const v = (process.env[n] ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(v)) { console.error(`${n} must be 64 hex characters`); process.exit(2); }
  return Buffer.from(v, 'hex');
};
const path = process.argv[2];
if (!path) { console.error('usage: rotate-key.mjs <path to notifier.db>'); process.exit(2); }
const oldK = hex('OLD_NOTIFIER_DATA_KEY'), newK = hex('NEW_NOTIFIER_DATA_KEY');
if (oldK.equals(newK)) { console.error('the keys are equal'); process.exit(2); }

const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
const sha256Hex = (d) => createHash('sha256').update(d).digest('hex');
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
const oldH = hmac(oldK, 'dms-notifier/address-hmac/v1'), newH = hmac(newK, 'dms-notifier/address-hmac/v1');
const norm = (e) => e.trim().toLowerCase();

const db = new DatabaseSync(path);
db.exec('BEGIN');
try {
  let nSwitches = 0, nAddresses = 0;
  for (const r of db.prepare('SELECT network, T, record FROM switches').all()) {
    const plain = open(oldK, r.record, `${r.network}/${r.T}/record`);
    db.prepare('UPDATE switches SET record = ? WHERE network = ? AND T = ?').run(seal(newK, plain, `${r.network}/${r.T}/record`), r.network, r.T);
    nSwitches++;
  }
  for (const a of db.prepare('SELECT * FROM addresses').all()) {
    const f = `${a.role}/${a.idx}`;
    const email = open(oldK, a.email, `${a.network}/${a.T}/email/${f}`);
    const name = open(oldK, a.name, `${a.network}/${a.T}/name/${f}`);
    const h = hmac(newH, norm(email)).toString('hex');
    const stop = a.stop_hash
      ? sha256Hex(hmac(newH, `stop/${a.id}/${a.network}/${a.T}/${a.role}/${a.idx}/${h}`).subarray(0, 32).toString('base64url'))
      : null;
    db.prepare('UPDATE addresses SET email = ?, name = ?, email_hmac = ?, stop_hash = ? WHERE id = ?')
      .run(seal(newK, email, `${a.network}/${a.T}/email/${f}`), seal(newK, name, `${a.network}/${a.T}/name/${f}`), h, stop, a.id);
    nAddresses++;
  }
  // The never list holds only HMACs: they cannot be re-keyed without the addresses.
  const never = db.prepare('SELECT hmac FROM never').all();
  console.log(JSON.stringify({ switches: nSwitches, addresses: nAddresses, never_entries: never.length }));
  if (never.length) console.warn(`warning: ${never.length} never-list entr${never.length === 1 ? 'y' : 'ies'} are HMACs and cannot be re-keyed; they are kept but will no longer match. Ask those addresses to use the stop link again if needed.`);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  console.error('rotation failed, nothing changed:', e.message);
  process.exit(1);
}
db.close();
