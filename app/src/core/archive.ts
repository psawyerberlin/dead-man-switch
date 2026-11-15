// Owner archive (SPEC.md §4.5): scrypt(passphrase, salt, N = 2^17, r = 8, p = 1, 32) → AES-256-GCM,
// aad = "DMS-v2/archive", over the UTF-8 JSON of the contents.
import { scryptAsync } from '@noble/hashes/scrypt';
import { aesGcmDecrypt, aesGcmEncrypt, NONCE_BYTES } from './aead';
import type { Language, Letter } from './bundle';
import { type Rng, bytesToHex, defaultRng, fromBase64, fromUtf8, hexToBytes, toBase64, utf8 } from './bytes';
import type { Network } from './config';
import type { SealedLink } from './links';

export const ARCHIVE_FORMAT = 'dms-owner-archive';
export const ARCHIVE_AAD = 'DMS-v2/archive';
export const ARCHIVE_KDF = { N: 131_072, r: 8, p: 1 } as const;
/** Below this strength (`passphraseStrength`) the UI keeps the "create archive" button disabled. */
export const ARCHIVE_MIN_STRENGTH = 3;

export interface ArchiveRecipient { index: number; name: string; language: Language; email: string | null; link: string | SealedLink | null }
export interface ArchiveContents {
  network: Network;
  T: string;
  I: string;
  /** CRT's 32-byte secret, 0x hex */
  K: string;
  sender_label: string;
  rhythm: string;
  letters: Letter[];
  recipients: ArchiveRecipient[];
}
export interface ArchiveFile {
  format: typeof ARCHIVE_FORMAT;
  version: 1;
  kdf: 'scrypt';
  N: number;
  r: number;
  p: number;
  salt: string;
  nonce: string;
  ciphertext_b64: string;
}

export class ArchiveError extends Error {
  constructor(message: string, readonly code: 'format' | 'passphrase' = 'format') { super(message); this.name = 'ArchiveError'; }
}

async function deriveKey(passphrase: string, salt: Uint8Array, N: number, r: number, p: number): Promise<Uint8Array> {
  // NFC so the same passphrase typed on another system gives the same key
  return scryptAsync(utf8(passphrase.normalize('NFC')), salt, { N, r, p, dkLen: 32, maxmem: 2 ** 30 });
}

export async function sealArchive(contents: ArchiveContents, passphrase: string, rng: Rng = defaultRng): Promise<ArchiveFile> {
  if (typeof passphrase !== 'string' || passphrase.length === 0) throw new ArchiveError('empty passphrase', 'passphrase');
  if (!/^0x[0-9a-fA-F]{64}$/.test(contents.K)) throw new ArchiveError('K must be 32 bytes of hex');
  const salt = new Uint8Array(rng(16));
  const nonce = new Uint8Array(rng(NONCE_BYTES));
  if (salt.length !== 16 || nonce.length !== NONCE_BYTES) throw new ArchiveError('rng returned the wrong length');
  const { N, r, p } = ARCHIVE_KDF;
  const key = await deriveKey(passphrase, salt, N, r, p);
  const ct = await aesGcmEncrypt(key, nonce, utf8(ARCHIVE_AAD), utf8(JSON.stringify(contents)));
  key.fill(0);
  return { format: ARCHIVE_FORMAT, version: 1, kdf: 'scrypt', N, r, p, salt: bytesToHex(salt), nonce: bytesToHex(nonce), ciphertext_b64: toBase64(ct) };
}

function parseFile(file: ArchiveFile | string): ArchiveFile {
  let f: unknown = file;
  if (typeof file === 'string') {
    try { f = JSON.parse(file); } catch { throw new ArchiveError('not an owner archive (not JSON)'); }
  }
  const a = f as Partial<ArchiveFile> | null;
  if (!a || typeof a !== 'object' || a.format !== ARCHIVE_FORMAT) throw new ArchiveError('not an owner archive');
  if (a.version !== 1 || a.kdf !== 'scrypt') throw new ArchiveError('unsupported owner archive version');
  // bounded so a crafted file cannot make the browser allocate gigabytes
  const pow2 = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 2 ** 14 && n <= 2 ** 20 && (n & (n - 1)) === 0;
  if (!pow2(a.N) || a.r !== 8 || a.p !== 1) throw new ArchiveError('unsupported scrypt parameters');
  if (typeof a.salt !== 'string' || typeof a.nonce !== 'string' || typeof a.ciphertext_b64 !== 'string') throw new ArchiveError('malformed owner archive');
  return a as ArchiveFile;
}

/** Throws `ArchiveError` with code `passphrase` when the passphrase is wrong (or the file was altered). */
export async function openArchive(file: ArchiveFile | string, passphrase: string): Promise<ArchiveContents> {
  const a = parseFile(file);
  let salt: Uint8Array, nonce: Uint8Array, ct: Uint8Array;
  try { salt = hexToBytes(a.salt); nonce = hexToBytes(a.nonce); ct = fromBase64(a.ciphertext_b64); } catch { throw new ArchiveError('malformed owner archive'); }
  if (salt.length !== 16 || nonce.length !== NONCE_BYTES) throw new ArchiveError('malformed owner archive');
  const key = await deriveKey(passphrase, salt, a.N, a.r, a.p);
  let pt: Uint8Array;
  try { pt = await aesGcmDecrypt(key, nonce, utf8(ARCHIVE_AAD), ct); } catch { throw new ArchiveError('wrong passphrase', 'passphrase'); } finally { key.fill(0); }
  try { return JSON.parse(fromUtf8(pt)) as ArchiveContents; } catch { throw new ArchiveError('malformed owner archive contents'); }
}

/**
 * 0..4 from length and character classes (lower, upper, digit, other); no dictionary. Long passphrases of several
 * words score high even without classes; repetitive strings are marked down.
 */
export function passphraseStrength(p: string): 0 | 1 | 2 | 3 | 4 {
  const chars = [...p];
  const len = chars.length;
  if (len < 8) return 0;
  const classes = [/\p{Ll}/u, /\p{Lu}/u, /\p{Nd}/u, /[^\p{Ll}\p{Lu}\p{Nd}]/u].filter((re) => re.test(p)).length;
  let score = len >= 20 ? 4 : len >= 16 ? 3 : len >= 12 ? 2 : 1;
  if (score < 4 && classes >= 3) score += 1;
  const unique = new Set(chars).size;
  if (unique < Math.max(4, len / 3)) score -= 2;
  else if (/(.{1,3})\1{3,}/u.test(p)) score -= 1;
  return Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
}
