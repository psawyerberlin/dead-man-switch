// Primitives of the messenger: the two link primitives of SPEC.md §4.2 and sealing of data at rest.
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes } from 'node:crypto';

export const LINK_INFO = 'DMS-v2/link';
export const MAX_RECIPIENT_INDEX = 10;
export const MAX_LINK_CIPHERTEXT = 2048 + 16;

export type Bytes = Uint8Array;

export function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith('0x') || h.startsWith('0X') ? h.slice(2) : h;
  if (s.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(s)) throw new Error('not hex');
  return new Uint8Array(Buffer.from(s, 'hex'));
}
export const bytesToHex = (b: Bytes): string => '0x' + Buffer.from(b).toString('hex');

const toBytes = (x: Bytes | string): Uint8Array => (typeof x === 'string' ? hexToBytes(x) : x);

function check(x: Bytes | string, n: number, what: string): Uint8Array {
  let b: Uint8Array;
  try { b = toBytes(x); } catch { throw new Error(`${what} is not hex`); }
  if (b.length !== n) throw new Error(`${what} must be ${n} bytes`);
  return b;
}

function recipientByte(r: number): Uint8Array {
  if (!Number.isInteger(r) || r < 1 || r > MAX_RECIPIENT_INDEX) throw new Error(`recipient index must be 1..${MAX_RECIPIENT_INDEX}`);
  return Uint8Array.of(r);
}

export const sha256 = (data: Bytes | string): Buffer => createHash('sha256').update(data).digest();
export const sha256Hex = (data: Bytes | string): string => sha256(data).toString('hex');
export const hmac = (key: Bytes, data: Bytes | string): Buffer => createHmac('sha256', key).update(data).digest();

/** `K_link(r) = HKDF-SHA256(ikm = K, salt = I, info = "DMS-v2/link" ‖ u8(r), 32)`. */
export function linkKey(K: Bytes | string, I: Bytes | string, r: number): Uint8Array {
  const info = Buffer.concat([Buffer.from(LINK_INFO, 'utf8'), recipientByte(r)]);
  return new Uint8Array(hkdfSync('sha256', check(K, 32, 'K'), check(I, 32, 'I'), info, 32));
}

export interface SealedLink { nonce: string; ciphertext: string }

/** Decrypts a recipient's link; aad = "DMS-v2/link" ‖ I ‖ u8(r). Throws on a wrong key, switch, recipient or altered data. */
export function decryptLink(K: Bytes | string, I: Bytes | string, r: number, sealed: SealedLink): string {
  const nonce = hexToBytes(sealed.nonce);
  const ct = hexToBytes(sealed.ciphertext);
  if (nonce.length !== 12) throw new Error('nonce must be 12 bytes');
  if (ct.length < 16 || ct.length > MAX_LINK_CIPHERTEXT) throw new Error('ciphertext has a wrong length');
  const aad = Buffer.concat([Buffer.from(LINK_INFO, 'utf8'), check(I, 32, 'I'), recipientByte(r)]);
  const d = createDecipheriv('aes-256-gcm', linkKey(K, I, r), nonce);
  d.setAAD(aad);
  d.setAuthTag(Buffer.from(ct.subarray(ct.length - 16)));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return new TextDecoder('utf-8', { fatal: true }).decode(pt);
}

/** Data at rest: AES-256-GCM, one random 12-byte nonce per value. Output `v1.` + base64(nonce ‖ ciphertext ‖ tag). */
export function seal(key: Bytes, plaintext: string, aad = ''): string {
  if (key.length !== 32) throw new Error('data key must be 32 bytes');
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, nonce);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([nonce, ct, c.getAuthTag()]).toString('base64');
}

export function open(key: Bytes, sealed: string, aad = ''): string {
  if (!sealed.startsWith('v1.')) throw new Error('unknown sealed format');
  const raw = Buffer.from(sealed.slice(3), 'base64');
  if (raw.length < 28) throw new Error('sealed value too short');
  const d = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('utf8');
}
