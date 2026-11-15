// The messenger record of SPEC.md §4.4 and the PATCH body of §5.2: strict validation, nothing else is accepted.
import { MAX_LINK_CIPHERTEXT, hexToBytes } from './crypto.ts';
import { isLanguage, type Language } from './i18n.ts';

export const MAX_RECIPIENTS = 10;
const MAX_NAME = 100;

export interface RecipientRecord {
  index: number; name: string; language: Language; email: string; tell_now: boolean;
  link: { nonce: string; ciphertext: string } | null;
}
export interface MessengerRecord {
  version: 1; network: string; T: string; I: string; drill: boolean; sender_label: string; rhythm: string;
  descriptor: Record<string, unknown>; envelopes: unknown[];
  owner: { email: string; language: Language; reminders: boolean };
  recipients: RecipientRecord[];
}
export interface RecordPatch {
  owner?: { email?: string; language?: Language; reminders?: boolean };
  recipients?: { index: number; email?: string; language?: Language; tell_now?: boolean }[];
}

export class ValidationError extends Error {
  constructor(message: string) { super(message); this.name = 'ValidationError'; }
}
const fail = (m: string): never => { throw new ValidationError(m); };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
function onlyKeys(o: Record<string, unknown>, allowed: string[], where: string): void {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(`${where}: unknown field ${k}`);
}

/** `0x` + 64 hex, returned lower-case; also accepts it without `0x`. */
export function hex32(x: unknown, what: string): string {
  if (typeof x !== 'string' || !/^(0x)?[0-9a-fA-F]{64}$/.test(x)) return fail(`${what} must be 32 bytes hex`);
  return '0x' + x.replace(/^0x/, '').toLowerCase();
}

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const isEmail = (x: unknown): x is string => typeof x === 'string' && x.length <= 254 && EMAIL.test(x) && !x.includes('..');

function email(x: unknown, what: string): string { return isEmail(x) ? x : fail(`${what} is not a valid email address`); }
function lang(x: unknown, what: string): Language { return isLanguage(x) ? x : fail(`${what} must be en, fr or de`); }
function bool(x: unknown, what: string): boolean { return typeof x === 'boolean' ? x : fail(`${what} must be true or false`); }
function label(x: unknown, what: string): string {
  // eslint-disable-next-line no-control-regex
  if (typeof x !== 'string' || x.trim() === '' || x.length > MAX_NAME || /[\u0000-\u001f\u007f]/.test(x)) return fail(`${what} must be 1..${MAX_NAME} characters without control characters`);
  return x;
}
const DURATION = /^P(?=\d|T\d)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/;

function link(x: unknown, what: string): RecipientRecord['link'] {
  if (x === null) return null;
  if (!isObj(x)) return fail(`${what} must be {nonce, ciphertext} or null`);
  onlyKeys(x, ['nonce', 'ciphertext'], what);
  let n: Uint8Array, c: Uint8Array;
  try { n = hexToBytes(String(x.nonce)); c = hexToBytes(String(x.ciphertext)); } catch { return fail(`${what} must be hex`); }
  if (typeof x.nonce !== 'string' || n.length !== 12) fail(`${what}.nonce must be 12 bytes`);
  if (typeof x.ciphertext !== 'string' || c.length < 16 || c.length > MAX_LINK_CIPHERTEXT) fail(`${what}.ciphertext must be 16..${MAX_LINK_CIPHERTEXT} bytes`);
  return { nonce: (x.nonce as string).toLowerCase(), ciphertext: (x.ciphertext as string).toLowerCase() };
}

/** Validates a PUT body against SPEC.md §4.4 for the switch `network`/`T` of the path. */
export function validateRecord(body: unknown, network: string, T: string): MessengerRecord {
  if (!isObj(body)) return fail('the record must be a JSON object');
  onlyKeys(body, ['version', 'network', 'T', 'I', 'drill', 'sender_label', 'rhythm', 'descriptor', 'envelopes', 'owner', 'recipients'], 'record');
  if (body.version !== 1) fail('version must be 1');
  if (body.network !== network) fail('network does not match the path');
  if (hex32(body.T, 'T') !== T) fail('T does not match the path');
  const I = hex32(body.I, 'I');
  const drill = bool(body.drill, 'drill');
  if (drill && network !== 'testnet') fail('a fire drill exists only on testnet');
  const sender_label = label(body.sender_label, 'sender_label');
  if (typeof body.rhythm !== 'string' || body.rhythm.length > 32 || !DURATION.test(body.rhythm)) fail('rhythm must be an ISO 8601 duration');
  if (!isObj(body.descriptor)) fail('descriptor must be an object');
  if (!Array.isArray(body.envelopes)) fail('envelopes must be an array');
  const o = body.owner;
  if (!isObj(o)) return fail('owner must be an object');
  onlyKeys(o, ['email', 'language', 'reminders'], 'owner');
  const owner = { email: email(o.email, 'owner.email'), language: lang(o.language, 'owner.language'), reminders: bool(o.reminders, 'owner.reminders') };
  if (!Array.isArray(body.recipients) || body.recipients.length < 1) return fail('recipients must be a non-empty array');
  if (body.recipients.length > MAX_RECIPIENTS) fail(`at most ${MAX_RECIPIENTS} recipients`);
  const seen = new Set<number>();
  const recipients = body.recipients.map((r: unknown, i: number): RecipientRecord => {
    const w = `recipients[${i}]`;
    if (!isObj(r)) return fail(`${w} must be an object`);
    onlyKeys(r, ['index', 'name', 'language', 'email', 'tell_now', 'link'], w);
    const index = r.index;
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1 || index > MAX_RECIPIENTS) return fail(`${w}.index must be 1..${MAX_RECIPIENTS}`);
    if (seen.has(index)) fail(`${w}.index ${index} is used twice`);
    seen.add(index);
    return { index, name: label(r.name, `${w}.name`), language: lang(r.language, `${w}.language`), email: email(r.email, `${w}.email`),
      tell_now: drill ? true : bool(r.tell_now, `${w}.tell_now`), link: link(r.link, `${w}.link`) };
  });
  return { version: 1, network, T, I, drill, sender_label, rhythm: body.rhythm as string, descriptor: body.descriptor as Record<string, unknown>,
    envelopes: body.envelopes as unknown[], owner, recipients };
}

/** Validates a PATCH body (SPEC.md §5.2: emails, languages, reminders, tell_now) and applies it to a copy of `rec`. */
export function applyPatch(rec: MessengerRecord, body: unknown): MessengerRecord {
  if (!isObj(body)) return fail('the patch must be a JSON object');
  onlyKeys(body, ['owner', 'recipients'], 'patch');
  const next: MessengerRecord = structuredClone(rec);
  if (body.owner !== undefined) {
    const o = body.owner;
    if (!isObj(o)) return fail('owner must be an object');
    onlyKeys(o, ['email', 'language', 'reminders'], 'owner');
    if (o.email !== undefined) next.owner.email = email(o.email, 'owner.email');
    if (o.language !== undefined) next.owner.language = lang(o.language, 'owner.language');
    if (o.reminders !== undefined) next.owner.reminders = bool(o.reminders, 'owner.reminders');
  }
  if (body.recipients !== undefined) {
    if (!Array.isArray(body.recipients) || body.recipients.length > MAX_RECIPIENTS) return fail('recipients must be an array');
    const seen = new Set<number>();
    body.recipients.forEach((p: unknown, i: number) => {
      const w = `recipients[${i}]`;
      if (!isObj(p)) return fail(`${w} must be an object`);
      onlyKeys(p, ['index', 'email', 'language', 'tell_now'], w);
      const r = next.recipients.find((x) => x.index === p.index);
      if (!r || seen.has(r.index)) return fail(`${w}.index is not a recipient of this switch or is used twice`);
      seen.add(r.index);
      if (p.email !== undefined) r.email = email(p.email, `${w}.email`);
      if (p.language !== undefined) r.language = lang(p.language, `${w}.language`);
      if (p.tell_now !== undefined) r.tell_now = next.drill ? true : bool(p.tell_now, `${w}.tell_now`);
    });
  }
  return next;
}
