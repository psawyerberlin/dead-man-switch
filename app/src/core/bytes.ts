// Small byte helpers shared by the core modules (no dependency, so the opener stays small).

export type Rng = (n: number) => Uint8Array;
export type BytesLike = Uint8Array | string;

export const defaultRng: Rng = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(h)) throw new TypeError('invalid hex string');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let s = '0x';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

/** Hex strings (with or without `0x`) or bytes → bytes (a copy is not made for bytes). */
export function toBytes(x: BytesLike): Uint8Array {
  return typeof x === 'string' ? hexToBytes(x) : x;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export const utf8 = (s: string): Uint8Array => enc.encode(s);
export const fromUtf8 = (b: Uint8Array): string => dec.decode(b);

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 with padding (works on large inputs, no `btoa` needed). */
export function toBase64(b: Uint8Array): string {
  const out: string[] = [];
  let chunk = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i]! << 16) | ((b[i + 1] ?? 0) << 8) | (b[i + 2] ?? 0);
    chunk += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! +
      (i + 1 < b.length ? B64[(n >> 6) & 63]! : '=') + (i + 2 < b.length ? B64[n & 63]! : '=');
    if (chunk.length >= 8192) { out.push(chunk); chunk = ''; }
  }
  out.push(chunk);
  return out.join('');
}

const B64_INDEX: Record<string, number> = Object.fromEntries([...B64].map((c, i) => [c, i]));

/** Standard or URL-safe base64, padding optional. */
export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (/[^A-Za-z0-9+/]/.test(clean) || clean.length % 4 === 1) throw new TypeError('invalid base64');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_INDEX[clean[i]!]!, b = B64_INDEX[clean[i + 1]!]!;
    const c = i + 2 < clean.length ? B64_INDEX[clean[i + 2]!]! : 0, d = i + 3 < clean.length ? B64_INDEX[clean[i + 3]!]! : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out;
}

export const toBase64Url = (b: Uint8Array): string => toBase64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** Copies into a fresh ArrayBuffer-backed array (what WebCrypto's types want). */
export const buf = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);
