// Letter bundle (SPEC.md §4.1) and its encryption (§4.2): one bundle per recipient, AES-256-GCM with
// K_letter(r), nonce 12 random bytes, aad = "DMS-v2" ‖ I ‖ u8(r).
import { aesGcmDecrypt, aesGcmEncrypt, NONCE_BYTES } from './aead';
import { type BytesLike, type Rng, concat, defaultRng, fromUtf8, utf8 } from './bytes';
import { check32, letterKey, recipientByte } from './keys';

export const BUNDLE_VERSION = 2;
export const LETTER_AAD_PREFIX = 'DMS-v2';
/** `max_vault_bytes` of SPEC.md §4.6, used when the caller passes no limit. */
export const DEFAULT_MAX_VAULT_BYTES = 26_214_400;
/** AES-GCM tag */
export const TAG_BYTES = 16;

export type Language = 'en' | 'fr' | 'de';
export const LANGUAGES: readonly Language[] = ['en', 'fr', 'de'];

export interface LetterFile { name: string; mime: string; size: number; data_b64: string }
export interface Letter {
  version: 2;
  language: Language;
  created_at: number;
  sender_label: string;
  recipient: { index: number; name: string };
  drill: boolean;
  text_markdown: string;
  note_markdown: string;
  files: LetterFile[];
}

export interface SealedBundle { nonce: Uint8Array; ciphertext: Uint8Array }

export class BundleError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'version' | 'size' = 'invalid') { super(message); this.name = 'BundleError'; }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Validates a parsed bundle; throws `BundleError` (code `version` for any version other than 2). */
export function validateLetter(v: unknown): Letter {
  if (!isObj(v)) throw new BundleError('bundle is not an object');
  if (v.version !== BUNDLE_VERSION) throw new BundleError(`unknown bundle version ${String(v.version)}`, 'version');
  const bad = (k: string): never => { throw new BundleError(`bundle.${k} is invalid`); };
  if (!LANGUAGES.includes(v.language as Language)) bad('language');
  if (typeof v.created_at !== 'number' || !Number.isSafeInteger(v.created_at) || v.created_at < 0) bad('created_at');
  if (typeof v.sender_label !== 'string') bad('sender_label');
  const r = v.recipient;
  if (!isObj(r) || typeof r.index !== 'number' || !Number.isInteger(r.index) || r.index < 1 || r.index > 10 || typeof r.name !== 'string') bad('recipient');
  if (typeof v.drill !== 'boolean') bad('drill');
  if (typeof v.text_markdown !== 'string') bad('text_markdown');
  if (typeof v.note_markdown !== 'string') bad('note_markdown');
  if (!Array.isArray(v.files)) bad('files');
  for (const f of v.files as unknown[]) {
    if (!isObj(f) || typeof f.name !== 'string' || f.name.length === 0 || typeof f.mime !== 'string' ||
      typeof f.size !== 'number' || !Number.isSafeInteger(f.size) || f.size < 0 || typeof f.data_b64 !== 'string' || !B64.test(f.data_b64)) bad('files');
  }
  const rr = r as Obj;
  return {
    version: 2, language: v.language as Language, created_at: v.created_at as number, sender_label: v.sender_label as string,
    recipient: { index: rr.index as number, name: rr.name as string }, drill: v.drill as boolean,
    text_markdown: v.text_markdown as string, note_markdown: v.note_markdown as string,
    files: (v.files as LetterFile[]).map((f) => ({ name: f.name, mime: f.mime, size: f.size, data_b64: f.data_b64 })),
  };
}

/** UTF-8 JSON of a validated bundle (fixed key order, so the same letter gives the same bytes). */
export function encodeBundle(letter: Letter): Uint8Array {
  return utf8(JSON.stringify(validateLetter(letter)));
}

export function decodeBundle(bytes: Uint8Array): Letter {
  let parsed: unknown;
  try { parsed = JSON.parse(fromUtf8(bytes)); } catch { throw new BundleError('bundle is not UTF-8 JSON'); }
  return validateLetter(parsed);
}

export function letterAad(I: BytesLike, r: number): Uint8Array {
  return concat(utf8(LETTER_AAD_PREFIX), check32(I, 'I'), recipientByte(r));
}

/** Encrypted size of a plaintext of `plaintextBytes` bytes. */
export const sealedSize = (plaintextBytes: number): number => plaintextBytes + TAG_BYTES;

/** Throws `BundleError` (code `size`) when the encrypted bundle would exceed `maxBytes`. */
export function checkBundleSize(plaintextBytes: number, maxBytes: number = DEFAULT_MAX_VAULT_BYTES): void {
  if (sealedSize(plaintextBytes) > maxBytes) {
    throw new BundleError(`the letter is ${sealedSize(plaintextBytes)} bytes encrypted, above the limit of ${maxBytes}`, 'size');
  }
}

export interface EncryptOptions { maxBytes?: number }

/**
 * Encrypts a bundle (a `Letter`, or its already encoded bytes) for recipient `r` of the switch with identity `I`.
 * `rng` supplies the nonce only. The size limit (`max_vault_bytes`) is checked before encrypting.
 */
export async function encryptBundle(K: BytesLike, I: BytesLike, r: number, bundle: Letter | Uint8Array, rng: Rng = defaultRng,
  opts: EncryptOptions = {}): Promise<SealedBundle> {
  const plaintext = bundle instanceof Uint8Array ? bundle : encodeBundle(bundle);
  checkBundleSize(plaintext.length, opts.maxBytes);
  const nonce = rng(NONCE_BYTES);
  if (nonce.length !== NONCE_BYTES) throw new BundleError('rng returned a nonce of the wrong length');
  const ciphertext = await aesGcmEncrypt(letterKey(K, I, r), nonce, letterAad(I, r), plaintext);
  return { nonce: new Uint8Array(nonce), ciphertext };
}

/** Decrypts to the bundle bytes (use `decodeBundle`, or `openBundle` for both). Throws `DecryptError`. */
export async function decryptBundle(K: BytesLike, I: BytesLike, r: number, nonce: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  return aesGcmDecrypt(letterKey(K, I, r), nonce, letterAad(I, r), ciphertext);
}

/** Decrypts and decodes; also checks that the bundle is addressed to recipient `r`. */
export async function openBundle(K: BytesLike, I: BytesLike, r: number, nonce: Uint8Array, ciphertext: Uint8Array): Promise<Letter> {
  const letter = decodeBundle(await decryptBundle(K, I, r, nonce, ciphertext));
  if (letter.recipient.index !== r) throw new BundleError('the bundle is for another recipient');
  return letter;
}
