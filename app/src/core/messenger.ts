// Messenger (notifier) record and client (SPEC.md §4.4, §5.2). The record never holds K, a letter or a clear link.
import { sha256 } from '@noble/hashes/sha256';
import type { Descriptor, Envelope } from '@crt/client';
import type { Language } from './bundle';
import { LANGUAGES } from './bundle';
import { type Rng, bytesToHex, defaultRng, fromBase64, hexToBytes, toBase64Url } from './bytes';
import type { Network } from './config';
import type { SealedLink } from './links';

export const OWNER_CODE_PREFIX = 'dms1';
export const RECORD_VERSION = 1;

export class MessengerError extends Error {
  constructor(message: string, readonly status = 0, readonly body: unknown = null) { super(message); this.name = 'MessengerError'; }
}

export interface OwnerCode { code: string; A: Uint8Array; adminHash: string }
export interface ParsedOwnerCode { network: Network; T8: string; A: Uint8Array; adminHash: string }

const hex8 = (T: string): string => {
  const t = T.replace(/^0x/i, '').toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(t)) throw new MessengerError('T must be 32 bytes of hex');
  return t.slice(0, 8);
};

export const adminHashOf = (A: Uint8Array): string => bytesToHex(sha256(A));

/** `dms1-<network>-<T first 8 hex>-<A base64url>`; the notifier stores only SHA-256(A). */
export function newOwnerCode(network: Network, T: string, rng: Rng = defaultRng): OwnerCode {
  if (network !== 'testnet' && network !== 'mainnet') throw new MessengerError('unknown network');
  const A = new Uint8Array(rng(32));
  if (A.length !== 32) throw new MessengerError('rng returned the wrong length');
  return { code: `${OWNER_CODE_PREFIX}-${network}-${hex8(T)}-${toBase64Url(A)}`, A, adminHash: adminHashOf(A) };
}

export function parseOwnerCode(code: string): ParsedOwnerCode {
  const m = /^dms1-(testnet|mainnet)-([0-9a-f]{8})-([A-Za-z0-9_-]{43})$/.exec(code.trim());
  if (!m) throw new MessengerError('not an owner code');
  const A = fromBase64(m[3]!);
  if (A.length !== 32) throw new MessengerError('not an owner code');
  return { network: m[1] as Network, T8: m[2]!, A, adminHash: adminHashOf(A) };
}

/** The bearer token sent to the notifier: A in base64url (as in the owner code). */
export const bearerOf = (A: Uint8Array): string => toBase64Url(A);

export interface RecordRecipient {
  index: number;
  name: string;
  language: Language;
  email: string | null;
  tell_now: boolean;
  link: SealedLink | null;
}
export interface RecordOwner { email: string | null; language: Language; reminders: boolean }
export interface MessengerRecord {
  version: 1;
  network: Network;
  T: string;
  I: string;
  drill: boolean;
  sender_label: string;
  rhythm: string;
  descriptor: Descriptor;
  envelopes: Envelope[];
  owner: RecordOwner;
  recipients: RecordRecipient[];
}

export interface BuildRecordInput {
  network: Network;
  T: string;
  I: string;
  drill: boolean;
  sender_label: string;
  rhythm: string;
  descriptor: Descriptor;
  envelopes: Envelope[];
  owner: RecordOwner;
  recipients: RecordRecipient[];
}

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
const HEX32 = /^0x[0-9a-f]{64}$/;
const HEX = /^0x(?:[0-9a-f]{2})+$/;

function email(v: string | null, what: string): string | null {
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > 254 || !EMAIL.test(v)) throw new MessengerError(`${what}: not an email address`);
  return v;
}
function lang(v: string, what: string): Language {
  if (!LANGUAGES.includes(v as Language)) throw new MessengerError(`${what}: unknown language`);
  return v as Language;
}

/**
 * Builds the record of SPEC.md §4.4 from explicitly listed fields only (anything else in the input, such as a key
 * or a letter, is never copied). Links must already be sealed (`encryptLink`).
 */
export function buildRecord(input: BuildRecordInput): MessengerRecord {
  const T = input.T.toLowerCase(), I = input.I.toLowerCase();
  if (!HEX32.test(T)) throw new MessengerError('T must be 32 bytes of hex');
  if (!HEX32.test(I)) throw new MessengerError('I must be 32 bytes of hex');
  if (input.network !== 'testnet' && input.network !== 'mainnet') throw new MessengerError('unknown network');
  if (input.descriptor.type_id?.toLowerCase() !== T) throw new MessengerError('descriptor is for another switch');
  if (input.descriptor.identity?.toLowerCase() !== I) throw new MessengerError('descriptor identity differs from I');
  if (!/^P(?:\d+[YMWD])+(?:T(?:\d+[HMS])+)?$|^PT(?:\d+[HMS])+$/.test(input.rhythm)) throw new MessengerError('rhythm must be an ISO 8601 duration');
  if (!Array.isArray(input.recipients) || input.recipients.length < 1 || input.recipients.length > 10) throw new MessengerError('1 to 10 recipients');
  const seen = new Set<number>();
  const recipients = input.recipients.map((r, i): RecordRecipient => {
    const what = `recipients[${i}]`;
    if (!Number.isInteger(r.index) || r.index < 1 || r.index > 10 || seen.has(r.index)) throw new MessengerError(`${what}: invalid index`);
    seen.add(r.index);
    if (typeof r.name !== 'string' || r.name.length === 0 || r.name.length > 200) throw new MessengerError(`${what}: invalid name`);
    let link: SealedLink | null = null;
    if (r.link !== null && r.link !== undefined) {
      const nonce = String(r.link.nonce).toLowerCase(), ciphertext = String(r.link.ciphertext).toLowerCase();
      if (!HEX.test(nonce) || hexToBytes(nonce).length !== 12 || !HEX.test(ciphertext) || hexToBytes(ciphertext).length < 17) {
        throw new MessengerError(`${what}: link must be sealed ({nonce, ciphertext} hex)`);
      }
      link = { nonce, ciphertext };
    }
    return { index: r.index, name: r.name, language: lang(r.language, what), email: email(r.email, what), tell_now: r.tell_now === true, link };
  });
  return {
    version: RECORD_VERSION, network: input.network, T, I, drill: input.drill === true,
    sender_label: String(input.sender_label), rhythm: input.rhythm,
    descriptor: structuredClone(input.descriptor), envelopes: structuredClone(input.envelopes),
    owner: { email: email(input.owner.email, 'owner'), language: lang(input.owner.language, 'owner'), reminders: input.owner.reminders === true },
    recipients,
  };
}

// ---- client ------------------------------------------------------------------------------------------------------

export type MessengerFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RecordPatch {
  owner?: Partial<RecordOwner>;
  recipients?: Array<Pick<RecordRecipient, 'index'> & Partial<Pick<RecordRecipient, 'email' | 'language' | 'tell_now'>>>;
}

/** Small typed client of `/api/v1` (SPEC.md §5.2). Errors are `MessengerError` with the HTTP status. */
export class MessengerClient {
  private readonly base: string;
  constructor(baseUrl: string, private readonly fetchFn: MessengerFetch = (u, i) => globalThis.fetch(u, i)) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  private async req<T>(method: string, path: string, body?: unknown, A?: Uint8Array): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (A) headers.authorization = `Bearer ${bearerOf(A)}`;
    let res;
    try {
      res = await this.fetchFn(this.base + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    } catch (e) {
      throw new MessengerError(`messenger unreachable: ${(e as Error).message}`);
    }
    let data: unknown = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const msg = data && typeof data === 'object' && 'error' in data ? String((data as { error: unknown }).error) : `HTTP ${res.status}`;
      throw new MessengerError(`${method} ${path}: ${msg}`, res.status, data);
    }
    return data as T;
  }

  private path(network: Network, T: string): string {
    hex8(T);
    return `/switch/${network}/${T.toLowerCase()}`;
  }

  /** Reserves `T` before Create is sent; a 409 means it is already claimed. */
  claim(network: Network, T: string, adminHash: string): Promise<unknown> {
    hex8(T);
    return this.req('POST', '/claim', { network, T: T.toLowerCase(), admin_hash: adminHash });
  }
  put(record: MessengerRecord, A: Uint8Array): Promise<unknown> {
    return this.req('PUT', this.path(record.network, record.T), record, A);
  }
  get<T = unknown>(network: Network, T: string, A: Uint8Array): Promise<T> {
    return this.req('GET', this.path(network, T), undefined, A);
  }
  patch(network: Network, T: string, A: Uint8Array, patch: RecordPatch): Promise<unknown> {
    return this.req('PATCH', this.path(network, T), patch, A);
  }
  remove(network: Network, T: string, A: Uint8Array): Promise<unknown> {
    return this.req('DELETE', this.path(network, T), undefined, A);
  }
}
