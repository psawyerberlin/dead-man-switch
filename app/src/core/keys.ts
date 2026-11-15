// Per-recipient keys (SPEC.md §4.2): HKDF-SHA256(ikm = K, salt = I, info = "DMS-v2/<purpose>" ‖ u8(r), 32).
import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha256';
import { type BytesLike, concat, toBytes, utf8 } from './bytes';

export const LETTER_INFO = 'DMS-v2/letter';
export const LINK_INFO = 'DMS-v2/link';
export const MAX_RECIPIENT_INDEX = 10;

export class KeyError extends Error {
  constructor(message: string) { super(message); this.name = 'KeyError'; }
}

/** Checks `r` (1–10) and returns it as one byte. */
export function recipientByte(r: number): Uint8Array {
  if (!Number.isInteger(r) || r < 1 || r > MAX_RECIPIENT_INDEX) throw new KeyError(`recipient index must be 1..${MAX_RECIPIENT_INDEX}`);
  return Uint8Array.of(r);
}

export function check32(x: BytesLike, what: string): Uint8Array {
  let b: Uint8Array;
  try { b = toBytes(x); } catch { throw new KeyError(`${what} is not hex`); }
  if (b.length !== 32) throw new KeyError(`${what} must be 32 bytes`);
  return b;
}

function derive(K: BytesLike, I: BytesLike, r: number, purpose: string): Uint8Array {
  return hkdf(sha256, check32(K, 'K'), check32(I, 'I'), concat(utf8(purpose), recipientByte(r)), 32);
}

/** `K_letter(r)`: the AES-256-GCM key of recipient `r`'s letter bundle. */
export const letterKey = (K: BytesLike, I: BytesLike, r: number): Uint8Array => derive(K, I, r, LETTER_INFO);

/** `K_link(r)`: the AES-256-GCM key of recipient `r`'s vault link. */
export const linkKey = (K: BytesLike, I: BytesLike, r: number): Uint8Array => derive(K, I, r, LINK_INFO);
