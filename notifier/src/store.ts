// SQLite store (node:sqlite). Personal fields and the record JSON are sealed with AES-256-GCM under NOTIFIER_DATA_KEY,
// one random nonce per value; tokens are kept as SHA-256 hashes; looked-up addresses as HMACs.
import { DatabaseSync } from 'node:sqlite';
import { hexToBytes, hmac, open, seal, sha256Hex } from './crypto.ts';

export type Role = 'owner' | 'recipient';
export type Confirmation = 'none' | 'asked' | 'confirmed' | 'stopped';

export interface AddressRow {
  id: number; network: string; T: string; role: Role; idx: number;
  email: string; name: string; language: string;
  confirmation: Confirmation; confirmSentAt: number | null;
}
export interface EventRow { id: number; at: number; kind: string; detail: string }
export interface OutboxRow { id: number; network: string; T: string; kind: string; addressId: number; step: string; status: 'pending' | 'done'; attempts: number; createdAt: number }
export interface ClaimRow { network: string; T: string; adminHash: string; createdAt: number }
export interface TombstoneRow { network: string; T: string; state: string; createdAt: number; endedAt: number }

export const SCHEMA_VERSION = 2;

/** The address-HMAC key is kept in `meta`, sealed under the data key, so rotating the data key leaves address
 * HMACs, the never list and stop links valid. Its value is the v1 derivation, so v1 databases keep working. */
const HMAC_KEY_AAD = 'meta/hmac_key';

const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE claims (network TEXT NOT NULL, T TEXT NOT NULL, admin_hash TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (network, T))`,
    `CREATE TABLE switches (network TEXT NOT NULL, T TEXT NOT NULL, drill INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'armed',
       record TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_mail_at INTEGER, ended_at INTEGER, PRIMARY KEY (network, T))`,
    `CREATE TABLE addresses (id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT NOT NULL, T TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner','recipient')),
       idx INTEGER NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, email_hmac TEXT NOT NULL, language TEXT NOT NULL,
       confirmation TEXT NOT NULL DEFAULT 'none', confirm_hash TEXT, stop_hash TEXT, confirm_sent_at INTEGER,
       UNIQUE (network, T, role, idx))`,
    `CREATE INDEX addresses_hmac ON addresses (email_hmac)`,
    `CREATE INDEX addresses_confirm ON addresses (confirm_hash)`,
    `CREATE INDEX addresses_stop ON addresses (stop_hash)`,
    `CREATE TABLE outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT NOT NULL, T TEXT NOT NULL, kind TEXT NOT NULL, address_id INTEGER NOT NULL,
       step TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, done_at INTEGER,
       UNIQUE (network, T, kind, address_id, step))`,
    `CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, network TEXT NOT NULL, T TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`,
    `CREATE INDEX events_switch ON events (network, T, at)`,
    `CREATE TABLE never (hmac TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
    `CREATE TABLE tombstones (network TEXT NOT NULL, T TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, ended_at INTEGER NOT NULL, PRIMARY KEY (network, T))`,
  ],
  [
    `CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`,
  ],
];

export class Store {
  readonly db: DatabaseSync;
  private readonly key: Uint8Array;
  private readonly hmacKey: Uint8Array;

  constructor(path: string, dataKey: Uint8Array) {
    if (dataKey.length !== 32) throw new Error('data key must be 32 bytes');
    this.key = dataKey;
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
    this.hmacKey = this.loadHmacKey();
  }

  private loadHmacKey(): Uint8Array {
    const row = this.db.prepare('SELECT v FROM meta WHERE k = ?').get('hmac_key') as { v: string } | undefined;
    if (row) return hexToBytes(open(this.key, row.v, HMAC_KEY_AAD));
    const k = new Uint8Array(hmac(this.key, 'dms-notifier/address-hmac/v1'));
    this.db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('hmac_key', seal(this.key, Buffer.from(k).toString('hex'), HMAC_KEY_AAD));
    return k;
  }

  close(): void { this.db.close(); }

  private migrate(): void {
    const cur = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (cur > SCHEMA_VERSION) throw new Error(`database schema ${cur} is newer than this program (${SCHEMA_VERSION})`);
    for (let v = cur; v < SCHEMA_VERSION; v++) {
      this.db.exec('BEGIN');
      try {
        for (const sql of MIGRATIONS[v]!) this.db.exec(sql);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    }
  }

  get schemaVersion(): number { return (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version; }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  private aad(network: string, T: string, field: string): string { return `${network}/${T}/${field}`; }

  /** HMAC of a normalised address, for the never list and rate limits; not reversible without the key. */
  addressHmac(email: string): string { return hmac(this.hmacKey, email.trim().toLowerCase()).toString('hex'); }

  // ---- claims
  addClaim(network: string, T: string, adminHash: string, now: number): boolean {
    if (this.getClaim(network, T) || this.getTombstone(network, T) || this.getSwitchMeta(network, T)) return false;
    this.db.prepare('INSERT INTO claims (network, T, admin_hash, created_at) VALUES (?,?,?,?)').run(network, T, adminHash, now);
    return true;
  }
  getClaim(network: string, T: string): ClaimRow | undefined {
    const r = this.db.prepare('SELECT admin_hash, created_at FROM claims WHERE network = ? AND T = ?').get(network, T) as { admin_hash: string; created_at: number } | undefined;
    return r && { network, T, adminHash: r.admin_hash, createdAt: r.created_at };
  }
  /** Claims older than `before` that have no switch record. */
  expiredClaims(before: number): ClaimRow[] {
    const rows = this.db.prepare(`SELECT network, T, admin_hash, created_at FROM claims c WHERE created_at < ?
      AND NOT EXISTS (SELECT 1 FROM switches s WHERE s.network = c.network AND s.T = c.T)`).all(before) as { network: string; T: string; admin_hash: string; created_at: number }[];
    return rows.map((r) => ({ network: r.network, T: r.T, adminHash: r.admin_hash, createdAt: r.created_at }));
  }
  deleteClaim(network: string, T: string): void { this.db.prepare('DELETE FROM claims WHERE network = ? AND T = ?').run(network, T); }

  // ---- switches
  putSwitch(network: string, T: string, record: unknown, drill: boolean, now: number): void {
    const sealed = seal(this.key, JSON.stringify(record), this.aad(network, T, 'record'));
    this.db.prepare(`INSERT INTO switches (network, T, drill, record, created_at, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT (network, T) DO UPDATE SET drill = excluded.drill, record = excluded.record, updated_at = excluded.updated_at`)
      .run(network, T, drill ? 1 : 0, sealed, now, now);
  }
  getSwitch(network: string, T: string): { record: unknown; drill: boolean; state: string; createdAt: number; updatedAt: number; lastMailAt: number | null; endedAt: number | null } | undefined {
    const r = this.db.prepare('SELECT * FROM switches WHERE network = ? AND T = ?').get(network, T) as SwitchRow | undefined;
    if (!r) return undefined;
    return { record: JSON.parse(open(this.key, r.record, this.aad(network, T, 'record'))), drill: !!r.drill, state: r.state, createdAt: r.created_at, updatedAt: r.updated_at, lastMailAt: r.last_mail_at, endedAt: r.ended_at };
  }
  getSwitchMeta(network: string, T: string): { drill: boolean; state: string } | undefined {
    const r = this.db.prepare('SELECT drill, state FROM switches WHERE network = ? AND T = ?').get(network, T) as { drill: number; state: string } | undefined;
    return r && { drill: !!r.drill, state: r.state };
  }
  listSwitches(network: string): { T: string; drill: boolean; state: string; lastMailAt: number | null; endedAt: number | null }[] {
    const rows = this.db.prepare('SELECT T, drill, state, last_mail_at, ended_at FROM switches WHERE network = ? ORDER BY T').all(network) as { T: string; drill: number; state: string; last_mail_at: number | null; ended_at: number | null }[];
    return rows.map((r) => ({ T: r.T, drill: !!r.drill, state: r.state, lastMailAt: r.last_mail_at, endedAt: r.ended_at }));
  }
  setSwitchState(network: string, T: string, state: string, endedAt?: number | null): void {
    this.db.prepare('UPDATE switches SET state = ?, ended_at = COALESCE(?, ended_at) WHERE network = ? AND T = ?').run(state, endedAt ?? null, network, T);
  }
  touchLastMail(network: string, T: string, at: number): void {
    this.db.prepare('UPDATE switches SET last_mail_at = ? WHERE network = ? AND T = ?').run(at, network, T);
  }
  /** Deletes the switch, its addresses, outbox, events and claim; optionally leaves a tombstone. */
  deleteSwitch(network: string, T: string, tombstone?: { state: string; now: number }): void {
    this.tx(() => {
      const sw = this.db.prepare('SELECT created_at FROM switches WHERE network = ? AND T = ?').get(network, T) as { created_at: number } | undefined;
      for (const t of ['addresses', 'outbox', 'events', 'switches', 'claims']) this.db.prepare(`DELETE FROM ${t} WHERE network = ? AND T = ?`).run(network, T);
      if (tombstone) this.db.prepare('INSERT OR REPLACE INTO tombstones (network, T, state, created_at, ended_at) VALUES (?,?,?,?,?)').run(network, T, tombstone.state, sw?.created_at ?? tombstone.now, tombstone.now);
    });
  }

  // ---- addresses
  /** Replaces the addresses of a switch; unchanged ones (same role, index and email) keep id, tokens and confirmation. Returns them in order. */
  syncAddresses(network: string, T: string, list: { role: Role; idx: number; email: string; name: string; language: string }[]): AddressRow[] {
    return this.tx(() => {
      const existing = this.listAddresses(network, T);
      const keep = new Set<number>();
      for (const a of list) {
        const old = existing.find((e) => e.role === a.role && e.idx === a.idx);
        const h = this.addressHmac(a.email);
        const e = seal(this.key, a.email, this.aad(network, T, `email/${a.role}/${a.idx}`));
        const n = seal(this.key, a.name, this.aad(network, T, `name/${a.role}/${a.idx}`));
        if (old) {
          keep.add(old.id);
          if (old.email.toLowerCase() === a.email.toLowerCase()) this.db.prepare('UPDATE addresses SET email = ?, name = ?, language = ? WHERE id = ?').run(e, n, a.language, old.id);
          else this.db.prepare(`UPDATE addresses SET email = ?, name = ?, email_hmac = ?, language = ?, confirmation = 'none', confirm_hash = NULL, stop_hash = NULL, confirm_sent_at = NULL WHERE id = ?`).run(e, n, h, a.language, old.id);
        } else {
          const r = this.db.prepare('INSERT INTO addresses (network, T, role, idx, email, name, email_hmac, language) VALUES (?,?,?,?,?,?,?,?)').run(network, T, a.role, a.idx, e, n, h, a.language);
          keep.add(Number(r.lastInsertRowid));
        }
      }
      for (const e of existing) if (!keep.has(e.id)) this.db.prepare('DELETE FROM addresses WHERE id = ?').run(e.id);
      return this.listAddresses(network, T);
    });
  }
  private rowToAddress(r: AddrDb): AddressRow {
    const f = `${r.role}/${r.idx}`;
    return { id: r.id, network: r.network, T: r.T, role: r.role, idx: r.idx, email: open(this.key, r.email, this.aad(r.network, r.T, `email/${f}`)),
      name: open(this.key, r.name, this.aad(r.network, r.T, `name/${f}`)), language: r.language, confirmation: r.confirmation, confirmSentAt: r.confirm_sent_at };
  }
  listAddresses(network: string, T: string): AddressRow[] {
    return (this.db.prepare('SELECT * FROM addresses WHERE network = ? AND T = ? ORDER BY role ASC, idx').all(network, T) as unknown as AddrDb[]).map((r) => this.rowToAddress(r));
  }
  getAddress(id: number): AddressRow | undefined {
    const r = this.db.prepare('SELECT * FROM addresses WHERE id = ?').get(id) as AddrDb | undefined;
    return r && this.rowToAddress(r);
  }
  /** Stores new confirm and stop tokens (as SHA-256 hashes) and marks the address "asked". */
  setTokens(id: number, confirmToken: string, stopToken: string, now: number): void {
    this.db.prepare(`UPDATE addresses SET confirm_hash = ?, stop_hash = ?, confirm_sent_at = ?, confirmation = CASE confirmation WHEN 'none' THEN 'asked' ELSE confirmation END WHERE id = ?`)
      .run(sha256Hex(confirmToken), sha256Hex(stopToken), now, id);
  }
  findByConfirmToken(token: string): AddressRow | undefined {
    const r = this.db.prepare('SELECT * FROM addresses WHERE confirm_hash = ?').get(sha256Hex(token)) as AddrDb | undefined;
    return r && this.rowToAddress(r);
  }
  findByStopToken(token: string): AddressRow | undefined {
    const r = this.db.prepare('SELECT * FROM addresses WHERE stop_hash = ?').get(sha256Hex(token)) as AddrDb | undefined;
    return r && this.rowToAddress(r);
  }
  /**
   * The stop token of an address: derived from the server key, the address id and the address HMAC, so every email
   * to the address carries the same working stop link (only its SHA-256 is stored, as for random tokens).
   */
  stopToken(a: AddressRow): string {
    const token = hmac(this.hmacKey, `stop/${a.id}/${a.network}/${a.T}/${a.role}/${a.idx}/${this.addressHmac(a.email)}`).subarray(0, 32).toString('base64url');
    this.db.prepare('UPDATE addresses SET stop_hash = ? WHERE id = ?').run(sha256Hex(token), a.id);
    return token;
  }
  setConfirmation(id: number, c: Confirmation): void { this.db.prepare('UPDATE addresses SET confirmation = ? WHERE id = ?').run(c, id); }
  /** Confirmation emails sent to this address (any switch) since `since`; for the 3-per-7-days limit. */
  confirmationsSince(email: string, since: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM addresses WHERE email_hmac = ? AND confirm_sent_at >= ?').get(this.addressHmac(email), since) as { n: number }).n;
  }

  // ---- never list
  addNever(email: string, now: number): void { this.db.prepare('INSERT OR IGNORE INTO never (hmac, created_at) VALUES (?,?)').run(this.addressHmac(email), now); }
  isNever(email: string): boolean { return !!this.db.prepare('SELECT 1 FROM never WHERE hmac = ?').get(this.addressHmac(email)); }

  // ---- outbox: recorded before the mailer is called, marked done after
  /** Records an intended send. Returns the row, or `undefined` when this (network, T, kind, address, step) was already recorded. */
  enqueue(network: string, T: string, kind: string, addressId: number, step: string, now: number): OutboxRow | undefined {
    const r = this.db.prepare('INSERT OR IGNORE INTO outbox (network, T, kind, address_id, step, created_at) VALUES (?,?,?,?,?,?)').run(network, T, kind, addressId, step, now);
    if (Number(r.changes) === 0) return undefined;
    return this.outboxRow(Number(r.lastInsertRowid));
  }
  outboxRow(id: number): OutboxRow | undefined {
    const r = this.db.prepare('SELECT * FROM outbox WHERE id = ?').get(id) as OutboxDb | undefined;
    return r && toOutbox(r);
  }
  findOutbox(network: string, T: string, kind: string, addressId: number, step: string): OutboxRow | undefined {
    const r = this.db.prepare('SELECT * FROM outbox WHERE network = ? AND T = ? AND kind = ? AND address_id = ? AND step = ?').get(network, T, kind, addressId, step) as OutboxDb | undefined;
    return r && toOutbox(r);
  }
  /** Pending rows that were attempted fewer than twice (a crash between record and send is retried once, never more). */
  pendingOutbox(network: string): OutboxRow[] {
    return (this.db.prepare(`SELECT * FROM outbox WHERE network = ? AND status = 'pending' AND attempts < 2 ORDER BY id`).all(network) as unknown as OutboxDb[]).map(toOutbox);
  }
  markAttempt(id: number): void { this.db.prepare('UPDATE outbox SET attempts = attempts + 1 WHERE id = ?').run(id); }
  markDone(id: number, now: number): void { this.db.prepare(`UPDATE outbox SET status = 'done', done_at = ? WHERE id = ?`).run(now, id); }

  // ---- events (timeline shown to the owner; no personal data in `detail`)
  addEvent(network: string, T: string, at: number, kind: string, detail = ''): void {
    this.db.prepare('INSERT INTO events (network, T, at, kind, detail) VALUES (?,?,?,?,?)').run(network, T, at, kind, detail);
  }
  listEvents(network: string, T: string): EventRow[] {
    return this.db.prepare('SELECT id, at, kind, detail FROM events WHERE network = ? AND T = ? ORDER BY at, id').all(network, T) as unknown as EventRow[];
  }

  // ---- tombstones
  getTombstone(network: string, T: string): TombstoneRow | undefined {
    const r = this.db.prepare('SELECT state, created_at, ended_at FROM tombstones WHERE network = ? AND T = ?').get(network, T) as { state: string; created_at: number; ended_at: number } | undefined;
    return r && { network, T, state: r.state, createdAt: r.created_at, endedAt: r.ended_at };
  }
}

interface SwitchRow { drill: number; state: string; record: string; created_at: number; updated_at: number; last_mail_at: number | null; ended_at: number | null }
interface AddrDb { id: number; network: string; T: string; role: Role; idx: number; email: string; name: string; language: string; confirmation: Confirmation; confirm_sent_at: number | null }
interface OutboxDb { id: number; network: string; T: string; kind: string; address_id: number; step: string; status: 'pending' | 'done'; attempts: number; created_at: number }
const toOutbox = (r: OutboxDb): OutboxRow => ({ id: r.id, network: r.network, T: r.T, kind: r.kind, addressId: r.address_id, step: r.step, status: r.status, attempts: r.attempts, createdAt: r.created_at });
